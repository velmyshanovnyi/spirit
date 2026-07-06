import { bytesToBase64, base64ToBytes } from "./codec.js";

const HKDF_INFO = new TextEncoder().encode("spirit-e2ee-v1");
const HKDF_SALT = new Uint8Array(0);
const IV_LENGTH_BYTES = 12;

export async function deriveSessionKey(privateKey, publicKey) {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256
  );

  const hkdfKeyMaterial = await crypto.subtle.importKey(
    "raw",
    sharedBits,
    "HKDF",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO },
    hkdfKeyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptMessage(sessionKey, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sessionKey,
    new TextEncoder().encode(plaintext)
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return bytesToBase64(combined);
}

export async function decryptMessage(sessionKey, payload) {
  const combined = base64ToBytes(payload);
  const iv = combined.slice(0, IV_LENGTH_BYTES);
  const ciphertext = combined.slice(IV_LENGTH_BYTES);

  const plaintextBytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    sessionKey,
    ciphertext
  );

  return new TextDecoder().decode(plaintextBytes);
}
