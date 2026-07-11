import { describe, it, expect } from "vitest";
import { generateIdentityKeyPair } from "../js/identity.js";
import { signProofSet, verifyProofSet, acceptNewerProofSet, addProofToSet, revokeProofFromSet } from "../js/proofSet.js";

const PROOF_A = { url: "https://t.me/username/123?embed=1", label: "telegram", added_at: 1000 };
const PROOF_B = { url: "https://example.com/me", label: "website", added_at: 2000 };

describe("signProofSet / verifyProofSet", () => {
  it("signs a version-1 set with no proofs", async () => {
    const identity = await generateIdentityKeyPair();
    const set = await signProofSet(identity.privateKey, [], [], { version: 1 });

    expect(set.version).toBe(1);
    expect(set.proofs).toEqual([]);
    expect(set.revoked).toEqual([]);
    expect(await verifyProofSet(identity.publicKey, set)).toBe(true);
  });

  it("signs and verifies a set with proofs and revocations", async () => {
    const identity = await generateIdentityKeyPair();
    const set = await signProofSet(identity.privateKey, [PROOF_A], [{ url: "https://old.example/", revoked_at: 500 }], {
      version: 3
    });

    expect(await verifyProofSet(identity.publicKey, set)).toBe(true);
  });

  it("rejects a set signed by a different identity", async () => {
    const identity = await generateIdentityKeyPair();
    const other = await generateIdentityKeyPair();
    const set = await signProofSet(identity.privateKey, [PROOF_A], [], { version: 1 });

    expect(await verifyProofSet(other.publicKey, set)).toBe(false);
  });

  it("rejects a set tampered with after signing", async () => {
    const identity = await generateIdentityKeyPair();
    const set = await signProofSet(identity.privateKey, [PROOF_A], [], { version: 1 });
    const tampered = { ...set, proofs: [{ ...PROOF_A, url: "https://evil.example/" }] };

    expect(await verifyProofSet(identity.publicKey, tampered)).toBe(false);
  });

  it("does NOT let a crafted url/label re-split into a different, still-valid set (canonical encoding must be injective)", async () => {
    // Found in exec review: naive "field:field:field" joining with "|"
    // between entries is not injective once url/label are free-form text
    // that can itself contain ":"/"|" -- these two structurally different
    // proof lists must NOT serialize to the same signed bytes.
    const identity = await generateIdentityKeyPair();
    const twoEntries = await signProofSet(
      identity.privateKey,
      [
        { url: "u1", label: "l1", added_at: 1 },
        { url: "u2", label: "l2", added_at: 2 }
      ],
      [],
      { version: 1 }
    );
    // Same signature bytes, reinterpreted as a single entry with a crafted label.
    const collision = {
      version: 1,
      proofs: [{ url: "u1", label: "l1:1|u2:l2", added_at: 2 }],
      revoked: [],
      signature: twoEntries.signature
    };

    expect(await verifyProofSet(identity.publicKey, collision)).toBe(false);
  });

  it("never throws for malformed input", async () => {
    const identity = await generateIdentityKeyPair();
    expect(await verifyProofSet(identity.publicKey, null)).toBe(false);
    expect(await verifyProofSet(identity.publicKey, {})).toBe(false);
    expect(await verifyProofSet(identity.publicKey, { version: 1, proofs: "not-an-array", revoked: [], signature: "x" })).toBe(
      false
    );
  });
});

describe("acceptNewerProofSet", () => {
  it("accepts the first-ever set (current = null)", async () => {
    const identity = await generateIdentityKeyPair();
    const set = await signProofSet(identity.privateKey, [PROOF_A], [], { version: 1 });

    expect(await acceptNewerProofSet(identity.publicKey, null, set)).toBe(set);
  });

  it("accepts a strictly newer valid set", async () => {
    const identity = await generateIdentityKeyPair();
    const v1 = await signProofSet(identity.privateKey, [PROOF_A], [], { version: 1 });
    const v2 = await signProofSet(identity.privateKey, [PROOF_A, PROOF_B], [], { version: 2 });

    expect(await acceptNewerProofSet(identity.publicKey, v1, v2)).toBe(v2);
  });

  it("keeps the current set when the incoming one has an equal or older version (anti-replay)", async () => {
    const identity = await generateIdentityKeyPair();
    const v2 = await signProofSet(identity.privateKey, [PROOF_A], [], { version: 2 });
    const replayedV1 = await signProofSet(identity.privateKey, [PROOF_A], [], { version: 1 });

    expect(await acceptNewerProofSet(identity.publicKey, v2, replayedV1)).toBe(v2);
    expect(await acceptNewerProofSet(identity.publicKey, v2, v2)).toBe(v2);
  });

  it("keeps the current set when the incoming one fails signature verification", async () => {
    const identity = await generateIdentityKeyPair();
    const attacker = await generateIdentityKeyPair();
    const v1 = await signProofSet(identity.privateKey, [PROOF_A], [], { version: 1 });
    const forged = await signProofSet(attacker.privateKey, [PROOF_A, PROOF_B], [], { version: 2 });

    expect(await acceptNewerProofSet(identity.publicKey, v1, forged)).toBe(v1);
  });
});

describe("addProofToSet / revokeProofFromSet", () => {
  it("adds a proof to an empty (null) set, starting at version 1", async () => {
    const identity = await generateIdentityKeyPair();
    const set = await addProofToSet(identity.privateKey, null, PROOF_A);

    expect(set.version).toBe(1);
    expect(set.proofs).toEqual([PROOF_A]);
    expect(await verifyProofSet(identity.publicKey, set)).toBe(true);
  });

  it("adds a proof to an existing set, incrementing the version", async () => {
    const identity = await generateIdentityKeyPair();
    const v1 = await signProofSet(identity.privateKey, [PROOF_A], [], { version: 1 });
    const v2 = await addProofToSet(identity.privateKey, v1, PROOF_B);

    expect(v2.version).toBe(2);
    expect(v2.proofs).toEqual([PROOF_A, PROOF_B]);
  });

  it("revokes a proof: moves it from proofs to revoked, increments version", async () => {
    const identity = await generateIdentityKeyPair();
    const v1 = await signProofSet(identity.privateKey, [PROOF_A, PROOF_B], [], { version: 1 });

    const v2 = await revokeProofFromSet(identity.privateKey, v1, PROOF_A.url, { now: 9999 });

    expect(v2.version).toBe(2);
    expect(v2.proofs).toEqual([PROOF_B]);
    expect(v2.revoked).toEqual([{ url: PROOF_A.url, revoked_at: 9999 }]);
    expect(await verifyProofSet(identity.publicKey, v2)).toBe(true);
  });
});
