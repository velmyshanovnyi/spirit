import { generateIdentityKeyPair, exportPrivateKeyRaw, importPrivateKeyRaw, derivePublicKeyFromPrivate, importPrivateKeyFromScalar } from "./identity.js";
import { generateSalt, deriveVaultKey, encryptForVault, decryptForVault } from "./vault.js";
import { get, put } from "./db.js";
import { bytesToBase64, base64ToBytes } from "./codec.js";
import { mnemonicToBytes } from "./mnemonic.js";
import { restoreFromKeyfile } from "./keyfile.js";
import { IncorrectPassphraseError, NoStoredProfileError } from "./errors.js";

export { IncorrectPassphraseError, NoStoredProfileError };

const PROFILE_RECORD_KEY = "identity";
const IDENTITY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" };

export async function hasStoredProfile() {
  const record = await get("profile", PROFILE_RECORD_KEY);
  return record !== undefined;
}

async function persistRawIdentity(rawPrivateKey, passphrase) {
  const salt = generateSalt();
  const vaultKey = await deriveVaultKey(passphrase, salt);
  const encryptedPrivateKey = await encryptForVault(vaultKey, new Uint8Array(rawPrivateKey));

  await put("profile", PROFILE_RECORD_KEY, {
    salt: bytesToBase64(salt),
    encryptedPrivateKey
  });
  return vaultKey;
}

async function reconstructKeyPairFromRaw(rawPrivateKey) {
  const extractablePrivateKey = await importPrivateKeyRaw(rawPrivateKey, IDENTITY_ALGORITHM, true);
  const publicKey = await derivePublicKeyFromPrivate(extractablePrivateKey, IDENTITY_ALGORITHM);
  const privateKey = await importPrivateKeyRaw(rawPrivateKey, IDENTITY_ALGORITHM, false);
  return { privateKey, publicKey };
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
 * Not idempotent: if persisting fails (quota exceeded, storage disabled),
 * the generated identity is discarded with the failed keypair existing
 * only in memory -- a naive retry generates a genuinely different
 * identity, not a retry of the same one. Callers (UI layer) should treat a
 * rejection here as "profile creation failed, nothing was saved," not as
 * safe-to-retry with an expectation of getting the same identity back.
 */
export async function createPermanentProfile(passphrase) {
  const keyPair = await generateIdentityKeyPair();
  const rawPrivateKey = await exportPrivateKeyRaw(keyPair.privateKey);
  const vaultKey = await persistRawIdentity(rawPrivateKey, passphrase);
  // vaultKey stays available for the session: message history (historyStore.js)
  // is encrypted with it. The CryptoKey itself is non-extractable.
  return { ...keyPair, vaultKey };
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
  const { rawPrivateKey, vaultKey } = await decryptStoredRawIdentity(passphrase);
  const keyPair = await reconstructKeyPairFromRaw(rawPrivateKey);
  return { ...keyPair, vaultKey };
}

async function decryptStoredRawIdentity(passphrase) {
  const record = await get("profile", PROFILE_RECORD_KEY);
  if (!record) {
    throw new NoStoredProfileError();
  }

  const salt = base64ToBytes(record.salt);
  const vaultKey = await deriveVaultKey(passphrase, salt);

  try {
    return { rawPrivateKey: await decryptForVault(vaultKey, record.encryptedPrivateKey), vaultKey };
  } catch {
    throw new IncorrectPassphraseError();
  }
}

/**
 * Returns the stored raw (pkcs8) identity private key bytes after
 * passphrase verification. Needed by device linking (deviceLinking.js):
 * loadPermanentProfile deliberately returns a non-extractable key, so the
 * only way to hand the identity to a new device is to re-derive the raw
 * bytes from the vault -- which also makes linking require the passphrase,
 * a deliberate confirmation step for this high-impact action.
 *
 * @throws {NoStoredProfileError} / {IncorrectPassphraseError} as loadPermanentProfile.
 */
export async function exportRawIdentity(passphrase) {
  const { rawPrivateKey } = await decryptStoredRawIdentity(passphrase);
  return rawPrivateKey;
}

/**
 * Persists an externally-obtained raw identity (device linking: the grant
 * from the primary device) as this device's permanent profile, encrypted
 * under `localPassphrase`. Same overwrite semantics as the restore functions.
 */
export async function adoptIdentity(rawPrivateKey, localPassphrase) {
  const keyPair = await reconstructKeyPairFromRaw(rawPrivateKey);
  await persistRawIdentity(rawPrivateKey, localPassphrase);
  return keyPair;
}

/**
 * Restores an identity from a mnemonic backup (docs/accounts.md) and
 * persists it as this device's permanent profile under `localPassphrase`
 * -- a fresh salt/encryption for THIS device's local storage, independent
 * of the mnemonic itself (which carries no passphrase; its secrecy is
 * physical, per D8). Overwrites any previously stored profile without
 * warning -- callers (UI layer) should check hasStoredProfile() first and
 * confirm with the user if one already exists.
 *
 * @throws whatever mnemonic.js's mnemonicToBytes throws for an invalid
 *         mnemonic (wrong word count, unknown word, bad checksum) --
 *         unrelated to passphrases, so not wrapped as IncorrectPassphraseError.
 */
export async function restoreProfileFromMnemonic(words, localPassphrase) {
  // The mnemonic encodes only the 32-byte private scalar (mnemonic.js),
  // while this module's storage format is the full pkcs8 export (see
  // exportPrivateKeyRaw) -- these are NOT interchangeable byte-for-byte.
  // importPrivateKeyFromScalar reconstructs a full key (public point
  // derived internally by Web Crypto) from just the scalar, which is then
  // re-exported to the same pkcs8 shape everything else here expects.
  const scalarBytes = await mnemonicToBytes(words);
  const extractablePrivateKey = await importPrivateKeyFromScalar(scalarBytes, IDENTITY_ALGORITHM, true);
  const rawPrivateKey = await exportPrivateKeyRaw(extractablePrivateKey);
  const keyPair = await reconstructKeyPairFromRaw(rawPrivateKey);
  await persistRawIdentity(rawPrivateKey, localPassphrase);
  return keyPair;
}

/**
 * Restores an identity from a keyfile backup (docs/accounts.md) and
 * persists it as this device's permanent profile under `localPassphrase`
 * (which may differ from `keyfilePassphrase` -- they protect two
 * independent things: the keyfile at rest vs. this device's local vault).
 * Overwrites any previously stored profile without warning, same as
 * restoreProfileFromMnemonic.
 *
 * @throws {IncorrectPassphraseError} if `keyfilePassphrase` is wrong or the
 *         keyfile is corrupted (propagated from keyfile.js).
 */
export async function restoreProfileFromKeyfile(keyfileJson, keyfilePassphrase, localPassphrase) {
  const rawPrivateKey = await restoreFromKeyfile(keyfileJson, keyfilePassphrase);
  const keyPair = await reconstructKeyPairFromRaw(rawPrivateKey);
  await persistRawIdentity(rawPrivateKey, localPassphrase);
  return keyPair;
}
