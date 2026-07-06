import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createPermanentProfile,
  loadPermanentProfile,
  hasStoredProfile,
  IncorrectPassphraseError,
  NoStoredProfileError
} from "../js/profile.js";
import { get } from "../js/db.js";
import { exportPrivateKeyRaw } from "../js/identity.js";
import { bytesToBase64 } from "../js/codec.js";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

describe("hasStoredProfile", () => {
  it("returns false before any profile is created", async () => {
    expect(await hasStoredProfile()).toBe(false);
  });

  it("returns true after a profile is created", async () => {
    await createPermanentProfile("my passphrase");
    expect(await hasStoredProfile()).toBe(true);
  });
});

describe("createPermanentProfile", () => {
  it("generates an extractable ECDSA identity key pair and stores it encrypted in db", async () => {
    const keyPair = await createPermanentProfile("my passphrase");

    expect(keyPair.privateKey.algorithm.name).toBe("ECDSA");
    expect(keyPair.publicKey.usages).toContain("verify");

    const record = await get("profile", "identity");
    expect(typeof record.salt).toBe("string");
    expect(typeof record.encryptedPrivateKey).toBe("string");
    // The stored ciphertext value itself must not equal the raw exported key
    // material -- i.e. it's genuinely encrypted, not stored as plaintext
    // under a misleadingly-named field.
    const rawPrivateKey = await exportPrivateKeyRaw(keyPair.privateKey);
    expect(record.encryptedPrivateKey).not.toBe(bytesToBase64(new Uint8Array(rawPrivateKey)));
  });
});

describe("loadPermanentProfile", () => {
  it("restores a key pair that can sign/verify against the originally created key pair", async () => {
    const created = await createPermanentProfile("correct horse battery staple");

    const restored = await loadPermanentProfile("correct horse battery staple");

    const message = new TextEncoder().encode("profile-restore-check");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, restored.privateKey, message);
    const isValid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, created.publicKey, signature, message);

    expect(isValid).toBe(true);
  });

  it("reuses the same stored salt across repeated loads (does not derive a fresh, incompatible key each time)", async () => {
    await createPermanentProfile("same passphrase");

    const first = await loadPermanentProfile("same passphrase");
    const second = await loadPermanentProfile("same passphrase");

    const message = new TextEncoder().encode("consistency-check");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, first.privateKey, message);
    const isValid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, second.publicKey, signature, message);

    expect(isValid).toBe(true);
  });

  it("throws IncorrectPassphraseError (a clear domain error) for a wrong passphrase", async () => {
    await createPermanentProfile("the real passphrase");

    await expect(loadPermanentProfile("a wrong passphrase")).rejects.toThrow(IncorrectPassphraseError);
  });

  it("throws a clear error when no profile has been stored yet", async () => {
    await expect(loadPermanentProfile("anything")).rejects.toThrow(NoStoredProfileError);
  });
});
