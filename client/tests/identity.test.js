import { describe, it, expect } from "vitest";
import {
  generateIdentityKeyPair,
  generateEcdhKeyPair,
  exportPrivateKeyRaw,
  importPrivateKeyRaw,
  fingerprint,
  exportEcdhPublicKeyForWire,
  importEcdhPublicKeyFromWire
} from "../js/identity.js";

describe("generateIdentityKeyPair", () => {
  it("returns an ECDSA P-256 key pair usable for sign/verify", async () => {
    const keyPair = await generateIdentityKeyPair();
    expect(keyPair.privateKey.algorithm.name).toBe("ECDSA");
    expect(keyPair.privateKey.algorithm.namedCurve).toBe("P-256");
    expect(keyPair.privateKey.usages).toContain("sign");
    expect(keyPair.publicKey.usages).toContain("verify");
  });
});

describe("generateEcdhKeyPair", () => {
  it("returns an ECDH P-256 key pair usable for key derivation", async () => {
    const keyPair = await generateEcdhKeyPair();
    expect(keyPair.privateKey.algorithm.name).toBe("ECDH");
    expect(keyPair.privateKey.algorithm.namedCurve).toBe("P-256");
    expect(keyPair.privateKey.usages).toContain("deriveBits");
  });
});

describe("exportPrivateKeyRaw / importPrivateKeyRaw", () => {
  it("round-trips an identity key pair so the restored key signs verifiably", async () => {
    const original = await generateIdentityKeyPair();
    const raw = await exportPrivateKeyRaw(original.privateKey);

    const restoredPrivateKey = await importPrivateKeyRaw(raw, {
      name: "ECDSA",
      namedCurve: "P-256"
    });

    const message = new TextEncoder().encode("spirit-round-trip-check");
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      restoredPrivateKey,
      message
    );
    const isValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      original.publicKey,
      signature,
      message
    );
    expect(isValid).toBe(true);
  });

  it("restores a non-extractable key by default", async () => {
    const original = await generateIdentityKeyPair();
    const raw = await exportPrivateKeyRaw(original.privateKey);
    const restored = await importPrivateKeyRaw(raw, { name: "ECDSA", namedCurve: "P-256" });
    expect(restored.extractable).toBe(false);
  });

  it("round-trips an ECDH key pair so shared-secret derivation still matches", async () => {
    const partyA = await generateEcdhKeyPair();
    const partyB = await generateEcdhKeyPair();

    const raw = await exportPrivateKeyRaw(partyA.privateKey);
    const restoredA = await importPrivateKeyRaw(raw, { name: "ECDH", namedCurve: "P-256" });
    expect(restoredA.algorithm.name).toBe("ECDH");

    const secretFromOriginal = await crypto.subtle.deriveBits(
      { name: "ECDH", public: partyB.publicKey },
      partyA.privateKey,
      256
    );
    const secretFromRestored = await crypto.subtle.deriveBits(
      { name: "ECDH", public: partyB.publicKey },
      restoredA,
      256
    );
    expect(new Uint8Array(secretFromRestored)).toEqual(new Uint8Array(secretFromOriginal));
  });
});

describe("exportEcdhPublicKeyForWire / importEcdhPublicKeyFromWire", () => {
  it("round-trips an ECDH public key through the wire format so shared-secret derivation still matches", async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();

    const wireForm = await exportEcdhPublicKeyForWire(bob.publicKey);
    expect(typeof wireForm).toBe("string");

    const restoredBobPublicKey = await importEcdhPublicKeyFromWire(wireForm);

    const secretViaOriginal = await crypto.subtle.deriveBits(
      { name: "ECDH", public: bob.publicKey },
      alice.privateKey,
      256
    );
    const secretViaWireRoundTrip = await crypto.subtle.deriveBits(
      { name: "ECDH", public: restoredBobPublicKey },
      alice.privateKey,
      256
    );
    expect(new Uint8Array(secretViaWireRoundTrip)).toEqual(new Uint8Array(secretViaOriginal));
  });
});

describe("fingerprint", () => {
  it("is deterministic for the same public key", async () => {
    const { publicKey } = await generateIdentityKeyPair();
    const a = await fingerprint(publicKey);
    const b = await fingerprint(publicKey);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]+$/);
    expect(a).toHaveLength(64); // SHA-256 hex digest
  });

  it("differs for different public keys", async () => {
    const keyPairA = await generateIdentityKeyPair();
    const keyPairB = await generateIdentityKeyPair();
    const a = await fingerprint(keyPairA.publicKey);
    const b = await fingerprint(keyPairB.publicKey);
    expect(a).not.toBe(b);
  });
});
