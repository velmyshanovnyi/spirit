import { describe, it, expect } from "vitest";
import { deriveVaultKey, encryptForVault, decryptForVault, generateSalt } from "../js/vault.js";

describe("generateSalt", () => {
  it("returns 16 random bytes, different on each call", () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a).toHaveLength(16);
    expect(a).not.toEqual(b);
  });
});

describe("deriveVaultKey", () => {
  it("is deterministic: same passphrase+salt lets two independently derived keys interoperate", async () => {
    const salt = generateSalt();
    const keyA = await deriveVaultKey("correct horse battery staple", salt);
    const keyB = await deriveVaultKey("correct horse battery staple", salt);

    const payload = await encryptForVault(keyA, new TextEncoder().encode("hello vault"));
    const plaintext = await decryptForVault(keyB, payload);

    expect(new TextDecoder().decode(plaintext)).toBe("hello vault");
  });

  it("derives a different key for a different passphrase with the same salt", async () => {
    const salt = generateSalt();
    const keyA = await deriveVaultKey("passphrase-one", salt);
    const keyB = await deriveVaultKey("passphrase-two", salt);

    const payload = await encryptForVault(keyA, new TextEncoder().encode("secret"));
    await expect(decryptForVault(keyB, payload)).rejects.toThrow();
  });

  it("derives a different key for the same passphrase with a different salt", async () => {
    const keyA = await deriveVaultKey("same-passphrase", generateSalt());
    const keyB = await deriveVaultKey("same-passphrase", generateSalt());

    const payload = await encryptForVault(keyA, new TextEncoder().encode("secret"));
    await expect(decryptForVault(keyB, payload)).rejects.toThrow();
  });
});

describe("encryptForVault / decryptForVault", () => {
  it("round-trips arbitrary bytes, including non-ASCII text", async () => {
    const salt = generateSalt();
    const key = await deriveVaultKey("my passphrase", salt);
    const original = new TextEncoder().encode("Привіт, сховище! 🔐");

    const payload = await encryptForVault(key, original);
    const decrypted = await decryptForVault(key, payload);

    expect(decrypted).toEqual(original);
  });

  it("uses a fresh IV on every call, producing different ciphertext for the same plaintext", async () => {
    const key = await deriveVaultKey("pw", generateSalt());
    const plaintext = new TextEncoder().encode("same content");

    const payloadA = await encryptForVault(key, plaintext);
    const payloadB = await encryptForVault(key, plaintext);

    expect(payloadA).not.toEqual(payloadB);
  });

  it("rejects tampered ciphertext instead of returning garbage", async () => {
    const key = await deriveVaultKey("pw", generateSalt());
    const payload = await encryptForVault(key, new TextEncoder().encode("don't touch me"));

    const raw = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    raw[raw.length - 1] ^= 0xff;
    const tampered = btoa(String.fromCharCode(...raw));

    await expect(decryptForVault(key, tampered)).rejects.toThrow();
  });
});
