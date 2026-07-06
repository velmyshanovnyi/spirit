import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createPermanentProfile,
  loadPermanentProfile,
  hasStoredProfile,
  restoreProfileFromMnemonic,
  restoreProfileFromKeyfile,
  exportRawIdentity,
  IncorrectPassphraseError,
  NoStoredProfileError
} from "../js/profile.js";
import { get } from "../js/db.js";
import { exportPrivateKeyRaw, exportPrivateKeyScalar } from "../js/identity.js";
import { bytesToBase64 } from "../js/codec.js";
import { bytesToMnemonic } from "../js/mnemonic.js";
import { createKeyfile } from "../js/keyfile.js";

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

describe("exportRawIdentity", () => {
  it("returns the stored raw private key bytes for the correct passphrase (device-linking needs them)", async () => {
    const created = await createPermanentProfile("my passphrase");
    const expectedRaw = new Uint8Array(await exportPrivateKeyRaw(created.privateKey));

    const raw = await exportRawIdentity("my passphrase");

    expect(new Uint8Array(raw)).toEqual(expectedRaw);
  });

  it("throws IncorrectPassphraseError for a wrong passphrase", async () => {
    await createPermanentProfile("the real passphrase");
    await expect(exportRawIdentity("wrong")).rejects.toThrow(IncorrectPassphraseError);
  });

  it("throws NoStoredProfileError when no profile exists", async () => {
    await expect(exportRawIdentity("anything")).rejects.toThrow(NoStoredProfileError);
  });
});

describe("restoreProfileFromMnemonic", () => {
  it("restores a key pair that can sign/verify against the originally created key pair, and persists it", async () => {
    const created = await createPermanentProfile("original passphrase");
    const scalarBytes = await exportPrivateKeyScalar(created.privateKey);
    const words = await bytesToMnemonic(scalarBytes);

    const restored = await restoreProfileFromMnemonic(words, "new local passphrase");

    const message = new TextEncoder().encode("mnemonic-restore-check");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, restored.privateKey, message);
    const isValid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, created.publicKey, signature, message);
    expect(isValid).toBe(true);

    // Persisted under the new local passphrase -- a subsequent independent
    // load must succeed (proves it was actually saved, not just returned).
    const reloaded = await loadPermanentProfile("new local passphrase");
    const reloadedSignature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, reloaded.privateKey, message);
    const reloadedValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      created.publicKey,
      reloadedSignature,
      message
    );
    expect(reloadedValid).toBe(true);
  });

  it("propagates mnemonic.js's own error for an invalid mnemonic, not a passphrase error", async () => {
    const tooFewWords = Array(24).fill("abandon");
    tooFewWords[0] = "not-a-real-bip39-word";

    await expect(restoreProfileFromMnemonic(tooFewWords, "local passphrase")).rejects.toThrow(
      /not in the BIP39 English wordlist/
    );
  });
});

describe("restoreProfileFromKeyfile", () => {
  it("restores a key pair that can sign/verify against the originally created key pair, and persists it", async () => {
    const created = await createPermanentProfile("original passphrase");
    const rawPrivateKey = await exportPrivateKeyRaw(created.privateKey);
    const keyfile = await createKeyfile(rawPrivateKey, "keyfile passphrase");

    const restored = await restoreProfileFromKeyfile(keyfile, "keyfile passphrase", "new local passphrase");

    const message = new TextEncoder().encode("keyfile-restore-check");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, restored.privateKey, message);
    const isValid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, created.publicKey, signature, message);
    expect(isValid).toBe(true);

    const reloaded = await loadPermanentProfile("new local passphrase");
    const reloadedSignature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, reloaded.privateKey, message);
    const reloadedValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      created.publicKey,
      reloadedSignature,
      message
    );
    expect(reloadedValid).toBe(true);
  });

  it("throws IncorrectPassphraseError for a wrong keyfile passphrase", async () => {
    const created = await createPermanentProfile("original passphrase");
    const rawPrivateKey = await exportPrivateKeyRaw(created.privateKey);
    const keyfile = await createKeyfile(rawPrivateKey, "the real keyfile passphrase");

    await expect(restoreProfileFromKeyfile(keyfile, "wrong keyfile passphrase", "local passphrase")).rejects.toThrow(
      IncorrectPassphraseError
    );
  });
});
