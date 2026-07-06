import { generateIdentityKeyPair, exportPrivateKeyRaw, importPrivateKeyRaw, derivePublicKeyFromPrivate } from "./identity.js";
import { generateSalt, deriveVaultKey, encryptForVault, decryptForVault } from "./vault.js";
import { get, put } from "./db.js";
import { bytesToBase64, base64ToBytes } from "./codec.js";

const PROFILE_RECORD_KEY = "identity";
const IDENTITY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" };

export class IncorrectPassphraseError extends Error {
  constructor() {
    super("Incorrect passphrase or corrupted profile data");
    this.name = "IncorrectPassphraseError";
  }
}

export class NoStoredProfileError extends Error {
  constructor() {
    super("No permanent profile is stored on this device");
    this.name = "NoStoredProfileError";
  }
}

export async function hasStoredProfile() {
  const record = await get("profile", PROFILE_RECORD_KEY);
  return record !== undefined;
}

/**
 * Creates a permanent (non-ephemeral) profile: an extractable identity
 * key pair whose private key is encrypted with a passphrase-derived vault
 * key and persisted to IndexedDB. The salt is generated once here and
 * stored alongside the ciphertext -- loadPermanentProfile always reuses
 * this same stored salt (docs/accounts.md); generating a fresh salt per
 * unlock would derive a different key every time and make every load fail,
 * indistinguishable from a wrong passphrase.
 *
 * Not idempotent: if the `put` below fails (quota exceeded, storage
 * disabled), the generated identity is discarded with the failed keypair
 * existing only in memory -- a naive retry generates a genuinely different
 * identity, not a retry of the same one. Callers (UI layer) should treat a
 * rejection here as "profile creation failed, nothing was saved," not as
 * safe-to-retry with an expectation of getting the same identity back.
 */
export async function createPermanentProfile(passphrase) {
  const keyPair = await generateIdentityKeyPair();
  const rawPrivateKey = await exportPrivateKeyRaw(keyPair.privateKey);

  const salt = generateSalt();
  const vaultKey = await deriveVaultKey(passphrase, salt);
  const encryptedPrivateKey = await encryptForVault(vaultKey, new Uint8Array(rawPrivateKey));

  await put("profile", PROFILE_RECORD_KEY, {
    salt: bytesToBase64(salt),
    encryptedPrivateKey
  });

  return keyPair;
}

/**
 * Restores the stored permanent profile's identity key pair. Only raw
 * private key bytes are stored, so the public key is reconstructed via
 * derivePublicKeyFromPrivate (see identity.js) rather than stored
 * separately.
 *
 * @throws {IncorrectPassphraseError} if the passphrase is wrong or the
 *         stored data is corrupted -- these are indistinguishable at the
 *         AES-GCM layer by design (distinguishing them would be an oracle).
 */
export async function loadPermanentProfile(passphrase) {
  const record = await get("profile", PROFILE_RECORD_KEY);
  if (!record) {
    throw new NoStoredProfileError();
  }

  const salt = base64ToBytes(record.salt);
  const vaultKey = await deriveVaultKey(passphrase, salt);

  let rawPrivateKey;
  try {
    rawPrivateKey = await decryptForVault(vaultKey, record.encryptedPrivateKey);
  } catch {
    throw new IncorrectPassphraseError();
  }

  const extractablePrivateKey = await importPrivateKeyRaw(rawPrivateKey, IDENTITY_ALGORITHM, true);
  const publicKey = await derivePublicKeyFromPrivate(extractablePrivateKey, IDENTITY_ALGORITHM);
  const privateKey = await importPrivateKeyRaw(rawPrivateKey, IDENTITY_ALGORITHM, false);

  return { privateKey, publicKey };
}
