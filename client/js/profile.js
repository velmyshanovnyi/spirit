import { generateIdentityKeyPair, exportPrivateKeyRaw, importPrivateKeyRaw, derivePublicKeyFromPrivate, importPrivateKeyFromScalar, fingerprint } from "./identity.js";
import { generateSalt, deriveVaultKey, encryptForVault, decryptForVault } from "./vault.js";
import { get, put, listKeys, remove } from "./db.js";
import { bytesToBase64, base64ToBytes } from "./codec.js";
import { mnemonicToBytes } from "./mnemonic.js";
import { restoreFromKeyfile } from "./keyfile.js";
import { IncorrectPassphraseError, NoStoredProfileError } from "./errors.js";

export { IncorrectPassphraseError, NoStoredProfileError };

// Multi-account layout (Section 15): each profile lives under
// "account:<identity fingerprint>". The pre-multi-account layout stored a
// single record under the bare key "identity"; it is still listed and is
// lazily migrated on first unlock (loadPermanentProfile).
const ACCOUNT_KEY_PREFIX = "account:";
const LEGACY_RECORD_KEY = "identity";
const IDENTITY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" };

function accountRecordKey(profileId) {
  return profileId === LEGACY_RECORD_KEY ? LEGACY_RECORD_KEY : ACCOUNT_KEY_PREFIX + profileId;
}

/**
 * Lists stored profiles as { id } entries. The id is the identity
 * fingerprint (or the literal "identity" for a not-yet-migrated legacy
 * record). Non-account records sharing the "profile" store (e.g. the own
 * device list, "deviceList:*") are excluded by the key prefix.
 */
export async function listProfiles() {
  const keys = await listKeys("profile");
  const profiles = keys
    .filter((key) => key.startsWith(ACCOUNT_KEY_PREFIX))
    .map((key) => ({ id: key.slice(ACCOUNT_KEY_PREFIX.length) }));
  if (keys.includes(LEGACY_RECORD_KEY)) {
    profiles.push({ id: LEGACY_RECORD_KEY });
  }
  return profiles;
}

export async function hasStoredProfile() {
  return (await listProfiles()).length > 0;
}

async function persistRawIdentity(rawPrivateKey, passphrase, profileId) {
  const salt = generateSalt();
  const vaultKey = await deriveVaultKey(passphrase, salt);
  const encryptedPrivateKey = await encryptForVault(vaultKey, new Uint8Array(rawPrivateKey));

  await put("profile", accountRecordKey(profileId), {
    salt: bytesToBase64(salt),
    encryptedPrivateKey
  });

  // The salt above is FRESH, so this vaultKey can never decrypt message rows
  // THIS profile wrote before (re-create/re-adopt of the same identity) --
  // they aren't corrupt, just permanently sealed under a superseded key.
  // Leaving them behind would make every later listMessages call throw, so
  // they go with the profile record they belonged to. Other profiles'
  // histories live under their own id prefix and are untouched; contacts
  // stay too (not encrypted, still valid).
  const staleHistoryPrefix = `${profileId}:`;
  for (const key of await listKeys("messages")) {
    if (key.startsWith(staleHistoryPrefix)) {
      await remove("messages", key);
    }
  }

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
  const profileId = await fingerprint(keyPair.publicKey);
  const vaultKey = await persistRawIdentity(rawPrivateKey, passphrase, profileId);
  // vaultKey stays available for the session: message history (historyStore.js)
  // is encrypted with it. The CryptoKey itself is non-extractable.
  return { ...keyPair, vaultKey, profileId };
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
export async function loadPermanentProfile(profileId, passphrase) {
  const { rawPrivateKey, vaultKey } = await decryptStoredRawIdentity(profileId, passphrase);
  const keyPair = await reconstructKeyPairFromRaw(rawPrivateKey);
  const realProfileId = await fingerprint(keyPair.publicKey);

  if (profileId === LEGACY_RECORD_KEY) {
    // Lazy migration: the legacy record's real id (the fingerprint) is only
    // knowable after decryption. Move it under the account key -- same
    // salt/ciphertext, so the same passphrase keeps working -- and drop the
    // legacy key so this runs exactly once.
    const record = await get("profile", LEGACY_RECORD_KEY);
    await put("profile", ACCOUNT_KEY_PREFIX + realProfileId, record);
    await remove("profile", LEGACY_RECORD_KEY);
  }

  return { ...keyPair, vaultKey, profileId: realProfileId };
}

async function decryptStoredRawIdentity(profileId, passphrase) {
  const record = await get("profile", accountRecordKey(profileId));
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
export async function exportRawIdentity(profileId, passphrase) {
  const { rawPrivateKey } = await decryptStoredRawIdentity(profileId, passphrase);
  return rawPrivateKey;
}

/**
 * Persists an externally-obtained raw identity (device linking: the grant
 * from the primary device) as this device's permanent profile, encrypted
 * under `localPassphrase`. Same overwrite semantics as the restore functions.
 */
export async function adoptIdentity(rawPrivateKey, localPassphrase) {
  const keyPair = await reconstructKeyPairFromRaw(rawPrivateKey);
  const profileId = await fingerprint(keyPair.publicKey);
  const vaultKey = await persistRawIdentity(rawPrivateKey, localPassphrase, profileId);
  // Same contract as create/load: the session vault key comes along, so a
  // just-linked or just-restored device can write history immediately.
  return { ...keyPair, vaultKey, profileId };
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
  return adoptIdentity(rawPrivateKey, localPassphrase);
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
  return adoptIdentity(rawPrivateKey, localPassphrase);
}
