import { generateSalt, deriveVaultKey, encryptForVault, decryptForVault } from "./vault.js";
import { bytesToBase64, base64ToBytes } from "./codec.js";
import { IncorrectPassphraseError } from "./errors.js";

export { IncorrectPassphraseError };

const KEYFILE_FORMAT_VERSION = 1;

/**
 * Encrypts raw key bytes (e.g. a pkcs8 identity private key) with a
 * passphrase for download/save as a backup file (docs/accounts.md). The
 * same underlying secret as the mnemonic (D8) -- this is just a different,
 * file-based encoding, not a separate derivation.
 */
export async function createKeyfile(rawKeyBytes, passphrase) {
  const salt = generateSalt();
  const vaultKey = await deriveVaultKey(passphrase, salt);
  const ciphertext = await encryptForVault(vaultKey, new Uint8Array(rawKeyBytes));

  return {
    version: KEYFILE_FORMAT_VERSION,
    salt: bytesToBase64(salt),
    ciphertext
  };
}

/**
 * Reverses createKeyfile. Accepts a keyfile object exactly as it comes back
 * from JSON.parse(JSON.stringify(...)) (i.e. after a real save/load
 * round-trip through a file).
 *
 * @throws {IncorrectPassphraseError} for a wrong passphrase or
 *         corrupted ciphertext (indistinguishable at the AES-GCM layer).
 */
export async function restoreFromKeyfile(keyfile, passphrase) {
  if (
    !keyfile ||
    keyfile.version !== KEYFILE_FORMAT_VERSION ||
    typeof keyfile.salt !== "string" ||
    typeof keyfile.ciphertext !== "string"
  ) {
    throw new Error("Unsupported or malformed keyfile format");
  }

  let salt;
  try {
    salt = base64ToBytes(keyfile.salt);
  } catch {
    // Malformed salt is a structural problem with the keyfile itself, not
    // a wrong-passphrase/corrupted-ciphertext situation -- surface it as
    // "malformed keyfile" instead of letting a raw InvalidCharacterError
    // escape, or misreporting it as IncorrectPassphraseError.
    throw new Error("Unsupported or malformed keyfile format");
  }

  const vaultKey = await deriveVaultKey(passphrase, salt);

  try {
    return await decryptForVault(vaultKey, keyfile.ciphertext);
  } catch {
    throw new IncorrectPassphraseError();
  }
}
