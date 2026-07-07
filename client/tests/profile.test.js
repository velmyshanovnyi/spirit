import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  createPermanentProfile,
  loadPermanentProfile,
  hasStoredProfile,
  listProfiles,
  restoreProfileFromMnemonic,
  restoreProfileFromKeyfile,
  exportRawIdentity,
  adoptIdentity,
  IncorrectPassphraseError,
  NoStoredProfileError
} from "../js/profile.js";
import { get, put, listKeys } from "../js/db.js";
import { exportPrivateKeyRaw, exportPrivateKeyScalar, fingerprint } from "../js/identity.js";
import { bytesToBase64 } from "../js/codec.js";
import { encryptForVault, decryptForVault, generateSalt, deriveVaultKey } from "../js/vault.js";
import { appendMessage, listMessages } from "../js/historyStore.js";
import { bytesToMnemonic } from "../js/mnemonic.js";
import { createKeyfile } from "../js/keyfile.js";

beforeEach(() => {
  global.indexedDB = new IDBFactory();
});

describe("hasStoredProfile / listProfiles", () => {
  it("reports no profiles before any is created", async () => {
    expect(await hasStoredProfile()).toBe(false);
    expect(await listProfiles()).toEqual([]);
  });

  it("lists every created profile by its identity fingerprint, without overwriting earlier ones", async () => {
    const first = await createPermanentProfile("pass one");
    const second = await createPermanentProfile("pass two");

    expect(await hasStoredProfile()).toBe(true);
    const profiles = await listProfiles();
    expect(profiles.map((p) => p.id).sort()).toEqual([first.profileId, second.profileId].sort());
    expect(first.profileId).not.toBe(second.profileId);
    // The id IS the identity fingerprint.
    expect(first.profileId).toBe(await fingerprint(first.publicKey));
  });

  it("does not confuse non-account records in the profile store (e.g. device lists) with profiles", async () => {
    const created = await createPermanentProfile("pass");
    await put("profile", `deviceList:${created.profileId}`, { version: 1, certificates: [], signature: "S" });

    expect((await listProfiles()).map((p) => p.id)).toEqual([created.profileId]);
  });
});

describe("createPermanentProfile", () => {
  it("generates an extractable ECDSA identity key pair and stores it encrypted in db", async () => {
    const created = await createPermanentProfile("my passphrase");

    expect(created.privateKey.algorithm.name).toBe("ECDSA");
    expect(created.publicKey.usages).toContain("verify");

    const record = await get("profile", `account:${created.profileId}`);
    expect(typeof record.salt).toBe("string");
    expect(typeof record.encryptedPrivateKey).toBe("string");
    const rawPrivateKey = await exportPrivateKeyRaw(created.privateKey);
    expect(record.encryptedPrivateKey).not.toBe(bytesToBase64(new Uint8Array(rawPrivateKey)));
  });
});

describe("loadPermanentProfile", () => {
  it("restores the selected profile's key pair (sign/verify cross-check with the original)", async () => {
    const created = await createPermanentProfile("correct horse battery staple");

    const restored = await loadPermanentProfile(created.profileId, "correct horse battery staple");

    const message = new TextEncoder().encode("profile-restore-check");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, restored.privateKey, message);
    const isValid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, created.publicKey, signature, message);

    expect(isValid).toBe(true);
  });

  // 5 PBKDF2 derivations at 600k iterations -- legitimately slow; the
  // default 5s timeout is flaky under full-suite load.
  it("unlocks the RIGHT profile among several, each under its own passphrase", { timeout: 20000 }, async () => {
    const first = await createPermanentProfile("pass one");
    const second = await createPermanentProfile("pass two");

    const loadedFirst = await loadPermanentProfile(first.profileId, "pass one");
    const loadedSecond = await loadPermanentProfile(second.profileId, "pass two");

    expect(loadedFirst.profileId).toBe(first.profileId);
    expect(loadedSecond.profileId).toBe(second.profileId);
    // Cross-passphrase must fail: profiles are independent vaults.
    await expect(loadPermanentProfile(first.profileId, "pass two")).rejects.toThrow(IncorrectPassphraseError);
  });

  it("reuses the same stored salt across repeated loads", async () => {
    const created = await createPermanentProfile("same passphrase");

    const first = await loadPermanentProfile(created.profileId, "same passphrase");
    const second = await loadPermanentProfile(created.profileId, "same passphrase");

    const message = new TextEncoder().encode("consistency-check");
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, first.privateKey, message);
    const isValid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, second.publicKey, signature, message);

    expect(isValid).toBe(true);
  });

  it("throws IncorrectPassphraseError for a wrong passphrase", async () => {
    const created = await createPermanentProfile("the real passphrase");
    await expect(loadPermanentProfile(created.profileId, "a wrong passphrase")).rejects.toThrow(IncorrectPassphraseError);
  });

  it("throws NoStoredProfileError for an unknown profile id", async () => {
    await expect(loadPermanentProfile("f".repeat(64), "anything")).rejects.toThrow(NoStoredProfileError);
  });
});

describe("legacy single-profile record migration", () => {
  async function plantLegacyRecord(passphrase) {
    // Reproduce the exact pre-Section-15 storage shape under the "identity" key.
    const created = await createPermanentProfile(passphrase);
    const record = await get("profile", `account:${created.profileId}`);
    await put("profile", "identity", record);
    const { remove } = await import("../js/db.js");
    await remove("profile", `account:${created.profileId}`);
    return created;
  }

  it("lists the legacy record and lazily migrates it to a fingerprint key on unlock", async () => {
    const created = await plantLegacyRecord("legacy pass");

    const before = await listProfiles();
    expect(before.map((p) => p.id)).toEqual(["identity"]);

    const loaded = await loadPermanentProfile("identity", "legacy pass");
    expect(loaded.profileId).toBe(created.profileId); // real fingerprint, not "identity"

    // Migrated: now stored under the fingerprint, legacy key gone.
    const after = await listProfiles();
    expect(after.map((p) => p.id)).toEqual([created.profileId]);
    expect(await get("profile", "identity")).toBeUndefined();
    // And still loadable under the new key with the same passphrase.
    await expect(loadPermanentProfile(created.profileId, "legacy pass")).resolves.toBeDefined();
  });
});

describe("session vault key", () => {
  it("createPermanentProfile returns a usable vaultKey alongside the key pair", async () => {
    const profile = await createPermanentProfile("my passphrase");

    expect(profile.vaultKey).toBeDefined();
    const plaintext = new TextEncoder().encode("history record");
    const ciphertext = await encryptForVault(profile.vaultKey, plaintext);
    expect(new Uint8Array(await decryptForVault(profile.vaultKey, ciphertext))).toEqual(new Uint8Array(plaintext));
  });

  it("loadPermanentProfile returns the SAME vault key material", async () => {
    const created = await createPermanentProfile("my passphrase");
    const plaintext = new TextEncoder().encode("written at create time");
    const ciphertext = await encryptForVault(created.vaultKey, plaintext);

    const loaded = await loadPermanentProfile(created.profileId, "my passphrase");

    expect(new Uint8Array(await decryptForVault(loaded.vaultKey, ciphertext))).toEqual(new Uint8Array(plaintext));
  });
});

describe("vault key and history isolation after restore/adopt", () => {
  const CONTACT = "d".repeat(64);

  async function assertVaultKeyWorks(profile) {
    expect(profile.vaultKey).toBeDefined();
    const plaintext = new TextEncoder().encode("post-restore history");
    const ciphertext = await encryptForVault(profile.vaultKey, plaintext);
    expect(new Uint8Array(await decryptForVault(profile.vaultKey, ciphertext))).toEqual(new Uint8Array(plaintext));
  }

  it("adoptIdentity returns a usable vaultKey and profileId", async () => {
    const created = await createPermanentProfile("origin pass");
    const raw = await exportPrivateKeyRaw(created.privateKey);

    const adopted = await adoptIdentity(raw, "device pass");
    await assertVaultKeyWorks(adopted);
    expect(adopted.profileId).toBe(created.profileId); // same identity, same id
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

  it("re-adopting the SAME identity clears its now-undecryptable history rows", async () => {
    const created = await createPermanentProfile("origin pass");
    await appendMessage(created.vaultKey, created.profileId, CONTACT, { direction: "out", text: "old", timestamp: 1000 });
    const raw = await exportPrivateKeyRaw(created.privateKey);

    const adopted = await adoptIdentity(raw, "new device pass");

    await expect(listMessages(adopted.vaultKey, adopted.profileId, CONTACT)).resolves.toEqual([]);
  });

  it("a DIFFERENT profile's history is isolated, not visible and not fatal to another profile", async () => {
    const first = await createPermanentProfile("pass one");
    await appendMessage(first.vaultKey, first.profileId, CONTACT, { direction: "out", text: "first's", timestamp: 1000 });

    const second = await createPermanentProfile("pass two");

    // Second profile sees nothing for the same contact -- and does NOT throw
    // on first's rows (they're outside its namespace).
    await expect(listMessages(second.vaultKey, second.profileId, CONTACT)).resolves.toEqual([]);
    // And first's rows survive the second profile's creation.
    const firstAgain = await loadPermanentProfile(first.profileId, "pass one");
    expect((await listMessages(firstAgain.vaultKey, first.profileId, CONTACT)).map((m) => m.text)).toEqual(["first's"]);
  });
});

describe("exportRawIdentity", () => {
  it("returns the stored raw private key bytes for the correct profile and passphrase", async () => {
    const created = await createPermanentProfile("my passphrase");
    const expectedRaw = new Uint8Array(await exportPrivateKeyRaw(created.privateKey));

    const raw = await exportRawIdentity(created.profileId, "my passphrase");

    expect(new Uint8Array(raw)).toEqual(expectedRaw);
  });

  it("throws IncorrectPassphraseError for a wrong passphrase", async () => {
    const created = await createPermanentProfile("the real passphrase");
    await expect(exportRawIdentity(created.profileId, "wrong")).rejects.toThrow(IncorrectPassphraseError);
  });

  it("throws NoStoredProfileError for an unknown profile id", async () => {
    await expect(exportRawIdentity("f".repeat(64), "anything")).rejects.toThrow(NoStoredProfileError);
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

    const reloaded = await loadPermanentProfile(restored.profileId, "new local passphrase");
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
    const badWords = Array(24).fill("abandon");
    badWords[0] = "not-a-real-bip39-word";

    await expect(restoreProfileFromMnemonic(badWords, "local passphrase")).rejects.toThrow(
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

    const reloaded = await loadPermanentProfile(restored.profileId, "new local passphrase");
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
