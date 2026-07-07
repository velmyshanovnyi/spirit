import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createPermanentProfile,
  loadPermanentProfile,
  hasStoredProfile,
  restoreProfileFromMnemonic,
  restoreProfileFromKeyfile,
  exportRawIdentity,
  adoptIdentity,
  IncorrectPassphraseError,
  NoStoredProfileError
} from "../js/profile.js";
import { get } from "../js/db.js";
import { exportPrivateKeyRaw, exportPrivateKeyScalar } from "../js/identity.js";
import { bytesToBase64 } from "../js/codec.js";
import { encryptForVault, decryptForVault } from "../js/vault.js";
import { appendMessage, listMessages } from "../js/historyStore.js";
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

describe("session vault key (history encryption, Section 11)", () => {
  it("createPermanentProfile returns a usable vaultKey alongside the key pair", async () => {
    const profile = await createPermanentProfile("my passphrase");

    expect(profile.vaultKey).toBeDefined();
    const plaintext = new TextEncoder().encode("history record");
    const ciphertext = await encryptForVault(profile.vaultKey, plaintext);
    expect(new Uint8Array(await decryptForVault(profile.vaultKey, ciphertext))).toEqual(new Uint8Array(plaintext));
  });

  it("loadPermanentProfile returns the SAME vault key material (can decrypt what create's key encrypted)", async () => {
    const created = await createPermanentProfile("my passphrase");
    const plaintext = new TextEncoder().encode("written at create time");
    const ciphertext = await encryptForVault(created.vaultKey, plaintext);

    const loaded = await loadPermanentProfile("my passphrase");

    expect(new Uint8Array(await decryptForVault(loaded.vaultKey, ciphertext))).toEqual(new Uint8Array(plaintext));
  });
});

describe("vault key after restore/adopt (Section 14 gap from Section 11 review)", () => {
  async function assertVaultKeyWorks(profile) {
    expect(profile.vaultKey).toBeDefined();
    const plaintext = new TextEncoder().encode("post-restore history");
    const ciphertext = await encryptForVault(profile.vaultKey, plaintext);
    expect(new Uint8Array(await decryptForVault(profile.vaultKey, ciphertext))).toEqual(new Uint8Array(plaintext));
  }

  it("adoptIdentity returns a usable vaultKey (a linked device must be able to write history)", async () => {
    const created = await createPermanentProfile("origin pass");
    const raw = await exportPrivateKeyRaw(created.privateKey);

    await assertVaultKeyWorks(await adoptIdentity(raw, "device pass"));
  });

  it("restoreProfileFromMnemonic returns a usable vaultKey", async () => {
    const created = await createPermanentProfile("origin pass");
    const scalar = await exportPrivateKeyScalar(created.privateKey);
    const words = await bytesToMnemonic(scalar);

    await assertVaultKeyWorks(await restoreProfileFromMnemonic(words, "local pass"));
  });

  it("restoreProfileFromKeyfile returns a usable vaultKey", async () => {
    const created = await createPermanentProfile("origin pass");
    const raw = await exportPrivateKeyRaw(created.privateKey);
    const keyfile = await createKeyfile(raw, "kf pass");

    await assertVaultKeyWorks(await restoreProfileFromKeyfile(keyfile, "kf pass", "local pass"));
  });

  it("createPermanentProfile over an old profile also clears its stale history", async () => {
    const contactId = "e".repeat(64);
    const first = await createPermanentProfile("first pass");
    await appendMessage(first.vaultKey, contactId, { direction: "out", text: "first world", timestamp: 1000 });

    const second = await createPermanentProfile("second pass");

    await expect(listMessages(second.vaultKey, contactId)).resolves.toEqual([]);
  });

  it("adoptIdentity clears stale message history (undecryptable under the fresh vault key)", async () => {
    const contactId = "d".repeat(64);
    const created = await createPermanentProfile("origin pass");
    await appendMessage(created.vaultKey, contactId, { direction: "out", text: "old world", timestamp: 1000 });
    const raw = await exportPrivateKeyRaw(created.privateKey);

    // Re-adopting the SAME identity generates a fresh salt -> different vault
    // key; the old rows can never be decrypted again. Keeping them would make
    // every later listMessages call throw on a benign stale-row condition.
    const adopted = await adoptIdentity(raw, "new device pass");

    await expect(listMessages(adopted.vaultKey, contactId)).resolves.toEqual([]);
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
