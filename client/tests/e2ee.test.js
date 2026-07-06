import { describe, it, expect } from "vitest";
import { generateEcdhKeyPair } from "../js/identity.js";
import { deriveSessionKey, encryptMessage, decryptMessage } from "../js/e2ee.js";
import { bytesToBase64, base64ToBytes } from "../js/codec.js";

describe("deriveSessionKey", () => {
  it("is symmetric: both parties derive the same AES-GCM key from ECDH", async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();

    const keyAlice = await deriveSessionKey(alice.privateKey, bob.publicKey);
    const keyBob = await deriveSessionKey(bob.privateKey, alice.publicKey);

    const plaintext = "перевірка спільного секрету";
    const payload = await encryptMessage(keyAlice, plaintext);
    const decrypted = await decryptMessage(keyBob, payload);

    expect(decrypted).toBe(plaintext);
  });
});

describe("encryptMessage / decryptMessage", () => {
  it("round-trips UTF-8 text, including non-ASCII", async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();
    const key = await deriveSessionKey(alice.privateKey, bob.publicKey);
    const sameKeyOtherSide = await deriveSessionKey(bob.privateKey, alice.publicKey);

    const plaintext = "Привіт, Spirit! 👋";
    const payload = await encryptMessage(key, plaintext);
    const decrypted = await decryptMessage(sameKeyOtherSide, payload);

    expect(decrypted).toBe(plaintext);
  });

  it("uses a fresh IV on every call, producing different ciphertext for the same plaintext", async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();
    const key = await deriveSessionKey(alice.privateKey, bob.publicKey);

    const payloadA = await encryptMessage(key, "same message");
    const payloadB = await encryptMessage(key, "same message");

    expect(payloadA).not.toBe(payloadB);
  });

  it("rejects tampered ciphertext instead of returning garbage", async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();
    const key = await deriveSessionKey(alice.privateKey, bob.publicKey);
    const sameKeyOtherSide = await deriveSessionKey(bob.privateKey, alice.publicKey);

    const payload = await encryptMessage(key, "не чіпай мене");
    const raw = base64ToBytes(payload);
    raw[raw.length - 1] ^= 0xff; // flip a byte inside the GCM tag/ciphertext
    const tampered = bytesToBase64(raw);

    await expect(decryptMessage(sameKeyOtherSide, tampered)).rejects.toThrow();
  });

  it("handles messages far larger than the JS call-argument limit", async () => {
    const alice = await generateEcdhKeyPair();
    const bob = await generateEcdhKeyPair();
    const key = await deriveSessionKey(alice.privateKey, bob.publicKey);
    const sameKeyOtherSide = await deriveSessionKey(bob.privateKey, alice.publicKey);

    const plaintext = "x".repeat(300_000); // well past typical ~65k-125k spread-arg limits
    const payload = await encryptMessage(key, plaintext);
    const decrypted = await decryptMessage(sameKeyOtherSide, payload);

    expect(decrypted).toBe(plaintext);
  });
});
