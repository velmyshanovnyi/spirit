import { bytesToBase64, base64ToBytes } from "./codec.js";

const PBKDF2_ITERATIONS = 600_000; // OWASP-recommended floor for PBKDF2-HMAC-SHA256 (2023+)
const SALT_LENGTH_BYTES = 16;
const IV_LENGTH_BYTES = 12;

export function generateSalt() {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
}

/**
 * Derives a per-passphrase AES-256-GCM key for encrypting the local vault
 * (docs/accounts.md). PBKDF2 chosen over Argon2 -- native in Web Crypto API,
 * no WASM dependency, consistent with the project's zero-external-crypto-lib
 * approach so far.
 */
export async function deriveVaultKey(passphrase, salt) {
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    passphraseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptForVault(vaultKey, plaintextBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, vaultKey, plaintextBytes);

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return bytesToBase64(combined);
}

export async function decryptForVault(vaultKey, payload) {
  const combined = base64ToBytes(payload);
  const iv = combined.slice(0, IV_LENGTH_BYTES);
  const ciphertext = combined.slice(IV_LENGTH_BYTES);

  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, vaultKey, ciphertext);
  return new Uint8Array(plaintext);
}
