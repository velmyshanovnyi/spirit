import { describe, it, expect } from "vitest";
import { generateIdentityKeyPair } from "../js/identity.js";
import { createProofBlock, parseProofBlock, verifyProofBlock } from "../js/proofs.js";
import { bytesToBase64 } from "../js/codec.js";

async function spkiWire(publicKey) {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  return bytesToBase64(new Uint8Array(spki));
}

describe("createProofBlock / parseProofBlock / verifyProofBlock", () => {
  it("creates a block with BEGIN/END markers and all required fields", async () => {
    const identity = await generateIdentityKeyPair();
    const block = await createProofBlock(identity.privateKey, identity.publicKey, "spirit0001deadbeef");

    expect(block).toContain("-----BEGIN SPIRIT PROOF-----");
    expect(block).toContain("-----END SPIRIT PROOF-----");
    expect(block).toMatch(/version: 1/);
    expect(block).toMatch(/statement: .*spirit0001deadbeef/);
    expect(block).toMatch(/nonce: [0-9a-f]{32}/);
    expect(block).toMatch(/timestamp: \d+/);
    expect(block).toMatch(/signature: \S+/);
  });

  it("round-trips: parse then verify against the announcer's own identity succeeds", async () => {
    const identity = await generateIdentityKeyPair();
    const block = await createProofBlock(identity.privateKey, identity.publicKey, "spirit0001deadbeef");
    const wire = await spkiWire(identity.publicKey);

    const parsed = parseProofBlock(block);
    expect(parsed).not.toBeNull();
    expect(parsed.identity).toBe(wire);

    expect(await verifyProofBlock(parsed, wire)).toBe(true);
  });

  it("extracts the block from arbitrary surrounding text (a real post/page)", async () => {
    const identity = await generateIdentityKeyPair();
    const block = await createProofBlock(identity.privateKey, identity.publicKey, "spirit0001deadbeef");
    const page = `<html><body>Hey everyone, here's my proof:\n\n${block}\n\nThanks for reading!</body></html>`;

    const parsed = parseProofBlock(page);
    expect(parsed).not.toBeNull();
    expect(parsed.identity).toBe(await spkiWire(identity.publicKey));
  });

  it("returns null for text with no proof block", () => {
    expect(parseProofBlock("just some random webpage text")).toBeNull();
  });

  it("returns null for a block missing a required field", () => {
    const broken = `-----BEGIN SPIRIT PROOF-----\nversion: 1\nidentity: AAAA\n-----END SPIRIT PROOF-----`;
    expect(parseProofBlock(broken)).toBeNull();
  });

  it("fails verification when the identity field doesn't match the expected contact", async () => {
    const identity = await generateIdentityKeyPair();
    const other = await generateIdentityKeyPair();
    const block = await createProofBlock(identity.privateKey, identity.publicKey, "spirit0001deadbeef");
    const parsed = parseProofBlock(block);

    expect(await verifyProofBlock(parsed, await spkiWire(other.publicKey))).toBe(false);
  });

  it("fails verification when the block was tampered with after signing", async () => {
    const identity = await generateIdentityKeyPair();
    const block = await createProofBlock(identity.privateKey, identity.publicKey, "spirit0001deadbeef");
    const tampered = block.replace("spirit0001deadbeef", "spirit0001evilevil");
    const parsed = parseProofBlock(tampered);
    const wire = await spkiWire(identity.publicKey);

    expect(await verifyProofBlock(parsed, wire)).toBe(false);
  });

  it("never throws for malformed input (parsed=null, garbage fields)", async () => {
    expect(await verifyProofBlock(null, "AAAA")).toBe(false);
    expect(
      await verifyProofBlock({ identity: "AAAA", statement: "x", timestamp: 1, nonce: "n", signature: "!!!not-base64!!!" }, "AAAA")
    ).toBe(false);
  });
});
