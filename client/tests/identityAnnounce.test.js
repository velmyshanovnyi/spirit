import { describe, it, expect } from "vitest";
import { generateIdentityKeyPair, generateEcdhKeyPair, exportEcdhPublicKeyForWire, fingerprint } from "../js/identity.js";
import { createIdentityAnnounce, verifyIdentityAnnounce } from "../js/identityAnnounce.js";

async function sessionSetup() {
  const identity = await generateIdentityKeyPair();
  const ecdhA = await exportEcdhPublicKeyForWire((await generateEcdhKeyPair()).publicKey);
  const ecdhB = await exportEcdhPublicKeyForWire((await generateEcdhKeyPair()).publicKey);
  return { identity, ecdhA, ecdhB };
}

describe("createIdentityAnnounce / verifyIdentityAnnounce", () => {
  it("round-trips: the receiver (with mirrored local/peer ECDH wires) recovers the announcer's identity and fingerprint", async () => {
    const { identity, ecdhA, ecdhB } = await sessionSetup();

    // Announcer's view: local = A, peer = B.
    const announce = await createIdentityAnnounce(identity.privateKey, identity.publicKey, ecdhA, ecdhB);
    expect(announce.type).toBe("identity-announce");
    expect(JSON.parse(JSON.stringify(announce))).toEqual(announce);

    // Receiver's view is mirrored: local = B, peer = A.
    const verified = await verifyIdentityAnnounce(JSON.parse(JSON.stringify(announce)), ecdhB, ecdhA);

    expect(verified).not.toBeNull();
    expect(verified.fingerprint).toBe(await fingerprint(identity.publicKey));
    expect(typeof verified.identityPubkeyWire).toBe("string");
    // The returned CryptoKey is usable to verify the announcer's signatures.
    const message = new TextEncoder().encode("post-announce-check");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, identity.privateKey, message);
    expect(
      await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verified.identityPublicKey, signature, message)
    ).toBe(true);
  });

  it("rejects an announce transplanted into a DIFFERENT session (other ECDH keys)", async () => {
    const { identity, ecdhA, ecdhB } = await sessionSetup();
    const { ecdhA: otherA, ecdhB: otherB } = await sessionSetup();

    const announce = await createIdentityAnnounce(identity.privateKey, identity.publicKey, ecdhA, ecdhB);

    // A MITM (e.g. the signaling node) replaying the announce in a session it
    // controls has different session ECDH keys -- must fail.
    expect(await verifyIdentityAnnounce(announce, otherB, otherA)).toBeNull();
    // Even one swapped side fails.
    expect(await verifyIdentityAnnounce(announce, ecdhB, otherA)).toBeNull();
  });

  it("rejects our OWN announce echoed back to us (reflection attack)", async () => {
    const { identity, ecdhA, ecdhB } = await sessionSetup();

    // We announced with (local=A, peer=B); an attacker echoes it back to us.
    const announce = await createIdentityAnnounce(identity.privateKey, identity.publicKey, ecdhA, ecdhB);

    // Verifying from OUR OWN perspective (local=A, peer=B) mirrors to (B, A),
    // which is not what we signed (A, B) -- must fail, otherwise we'd record
    // ourselves as the verified peer.
    expect(await verifyIdentityAnnounce(announce, ecdhA, ecdhB)).toBeNull();
  });

  it("rejects an announce whose identity key was swapped after signing", async () => {
    const { identity, ecdhA, ecdhB } = await sessionSetup();
    const attacker = await generateIdentityKeyPair();
    const announce = await createIdentityAnnounce(identity.privateKey, identity.publicKey, ecdhA, ecdhB);

    const attackerSpki = new Uint8Array(await crypto.subtle.exportKey("spki", attacker.publicKey));
    const forged = { ...announce, identityPubkey: btoa(String.fromCharCode(...attackerSpki)) };

    expect(await verifyIdentityAnnounce(forged, ecdhB, ecdhA)).toBeNull();
  });

  it("rejects an announce signed by a key other than the announced one", async () => {
    const { identity, ecdhA, ecdhB } = await sessionSetup();
    const other = await generateIdentityKeyPair();

    // Signed with `other`, but announces `identity` -- possession proof fails.
    const spki = new Uint8Array(await crypto.subtle.exportKey("spki", identity.publicKey));
    const mismatched = await createIdentityAnnounce(other.privateKey, identity.publicKey, ecdhA, ecdhB);
    expect(mismatched.identityPubkey).toBe(btoa(String.fromCharCode(...spki)));

    expect(await verifyIdentityAnnounce(mismatched, ecdhB, ecdhA)).toBeNull();
  });

  it("includes the announcer's nickname in the announce and in the verified result (Section 16)", async () => {
    const { identity, ecdhA, ecdhB } = await sessionSetup();

    const announce = await createIdentityAnnounce(identity.privateKey, identity.publicKey, ecdhA, ecdhB, "Оксана");
    expect(announce.nickname).toBe("Оксана");

    const verified = await verifyIdentityAnnounce(announce, ecdhB, ecdhA);
    expect(verified.nickname).toBe("Оксана");
  });

  it("defaults to an empty nickname when none is given, without breaking verification", async () => {
    const { identity, ecdhA, ecdhB } = await sessionSetup();

    const announce = await createIdentityAnnounce(identity.privateKey, identity.publicKey, ecdhA, ecdhB);
    expect(announce.nickname).toBe("");

    const verified = await verifyIdentityAnnounce(announce, ecdhB, ecdhA);
    expect(verified.nickname).toBe("");
  });

  it("rejects an announce whose nickname was changed after signing (not covered by a stale signature)", async () => {
    const { identity, ecdhA, ecdhB } = await sessionSetup();

    const announce = await createIdentityAnnounce(identity.privateKey, identity.publicKey, ecdhA, ecdhB, "Оксана");
    const tampered = { ...announce, nickname: "Не Оксана" };

    expect(await verifyIdentityAnnounce(tampered, ecdhB, ecdhA)).toBeNull();
  });

  it("returns null (never throws) for malformed input", async () => {
    const { ecdhA, ecdhB } = await sessionSetup();

    expect(await verifyIdentityAnnounce(null, ecdhB, ecdhA)).toBeNull();
    expect(await verifyIdentityAnnounce({}, ecdhB, ecdhA)).toBeNull();
    expect(
      await verifyIdentityAnnounce({ type: "identity-announce", identityPubkey: "AAAA", signature: "BBBB" }, ecdhB, ecdhA)
    ).toBeNull();
    expect(
      await verifyIdentityAnnounce(
        { type: "identity-announce", identityPubkey: "!!!not-base64!!!", signature: "BBBB" },
        ecdhB,
        ecdhA
      )
    ).toBeNull();
  });
});
