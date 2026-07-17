// Section PN1 (specs/phase5/push-notifications.md): Web Push payload
// encryption per RFC 8291 ("Message Encryption for Web Push"), built on the
// aes128gcm content-encoding from RFC 8188. Pure crypto core -- no Service
// Worker, no network, no dependency on app.js. `encryptWebPushPayload` is
// what a REAL sender uses; `decryptWebPushPayload` exists only so this
// module's tests can round-trip-verify the scheme itself (a real recipient's
// browser does this decoding natively via PushEvent.data, never this code).

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(base64url) {
  const padded = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function concatBytes(...chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function hkdf(ikmBytes, saltBytes, infoBytes, lengthBytes) {
  const key = await crypto.subtle.importKey("raw", ikmBytes, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: saltBytes, info: infoBytes },
    key,
    lengthBytes * 8
  );
  return new Uint8Array(bits);
}

async function exportRawPublicKey(publicKey) {
  return new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
}

async function importRawP256PublicKey(rawBytes) {
  return crypto.subtle.importKey("raw", rawBytes, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

// RFC 8291 Section 3.3/3.4: derive the aes128gcm CEK/nonce from the ECDH
// shared secret, the receiver's auth secret, both raw public keys, and a
// per-message random salt.
async function deriveContentEncryptionKeys({ sharedSecretBits, authSecret, receiverPublicRaw, senderPublicRaw, salt }) {
  const keyInfo = concatBytes(
    new TextEncoder().encode("WebPush: info"),
    new Uint8Array([0]),
    receiverPublicRaw,
    senderPublicRaw
  );
  const ikm = await hkdf(sharedSecretBits, authSecret, keyInfo, 32);

  const cekInfo = concatBytes(new TextEncoder().encode("Content-Encoding: aes128gcm"), new Uint8Array([0]));
  const nonceInfo = concatBytes(new TextEncoder().encode("Content-Encoding: nonce"), new Uint8Array([0]));
  const cek = await hkdf(ikm, salt, cekInfo, 16);
  const nonce = await hkdf(ikm, salt, nonceInfo, 12);
  return { cek, nonce };
}

const DEFAULT_RECORD_SIZE = 4096;
// Single-record padding delimiter (RFC 8188 Section 2): 0x02 marks "last
// (and only) record", followed by zero or more zero-padding bytes. This
// module never emits more than one record (push payloads are small), so no
// 0x01 "more records follow" case is implemented.
const LAST_RECORD_DELIMITER = 0x02;

/**
 * @param {{p256dh: string, auth: string}} subscriptionKeys base64url, as
 *   returned by PushSubscription.toJSON().keys.
 * @param {string} plaintext
 * @returns {Promise<Uint8Array>} the aes128gcm-encoded binary payload, ready
 *   to be the body of a POST to the subscription's push endpoint.
 */
export async function encryptWebPushPayload(subscriptionKeys, plaintext) {
  const receiverPublicRaw = base64UrlToBytes(subscriptionKeys.p256dh);
  const authSecret = base64UrlToBytes(subscriptionKeys.auth);
  const receiverPublicKey = await importRawP256PublicKey(receiverPublicRaw);

  const senderKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits"
  ]);
  const senderPublicRaw = await exportRawPublicKey(senderKeyPair.publicKey);

  const sharedSecretBits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiverPublicKey }, senderKeyPair.privateKey, 256)
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const { cek, nonce } = await deriveContentEncryptionKeys({
    sharedSecretBits,
    authSecret,
    receiverPublicRaw,
    senderPublicRaw,
    salt
  });

  const plaintextBytes = new TextEncoder().encode(plaintext);
  const padded = concatBytes(plaintextBytes, new Uint8Array([LAST_RECORD_DELIMITER]));

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded)
  );

  const recordSizeBytes = new Uint8Array(4);
  new DataView(recordSizeBytes.buffer).setUint32(0, DEFAULT_RECORD_SIZE, false);
  const header = concatBytes(
    salt,
    recordSizeBytes,
    new Uint8Array([senderPublicRaw.length]),
    senderPublicRaw
  );
  return concatBytes(header, ciphertext);
}

/**
 * Test-only round-trip counterpart -- a real recipient's browser decodes
 * `aes128gcm` natively; this exists purely to verify encryptWebPushPayload
 * produces a spec-correct payload.
 *
 * @param {CryptoKeyPair} receiverKeyPair the ECDH P-256 keypair matching the
 *   `p256dh` public key given to encryptWebPushPayload.
 * @param {string} authSecretBase64Url matching `auth`.
 * @param {Uint8Array} payload as produced by encryptWebPushPayload.
 */
export async function decryptWebPushPayload(receiverKeyPair, authSecretBase64Url, payload) {
  const salt = payload.slice(0, 16);
  const recordSize = new DataView(payload.buffer, payload.byteOffset + 16, 4).getUint32(0, false);
  const idLen = payload[20];
  const senderPublicRaw = payload.slice(21, 21 + idLen);
  const ciphertext = payload.slice(21 + idLen);
  void recordSize; // single-record payloads only; not needed to decode them

  const senderPublicKey = await importRawP256PublicKey(senderPublicRaw);
  const receiverPublicRaw = await exportRawPublicKey(receiverKeyPair.publicKey);
  const authSecret = base64UrlToBytes(authSecretBase64Url);

  const sharedSecretBits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: senderPublicKey }, receiverKeyPair.privateKey, 256)
  );

  const { cek, nonce } = await deriveContentEncryptionKeys({
    sharedSecretBits,
    authSecret,
    receiverPublicRaw,
    senderPublicRaw,
    salt
  });

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext));

  let end = padded.length;
  while (end > 0 && padded[end - 1] === 0) end--;
  if (end === 0 || padded[end - 1] !== LAST_RECORD_DELIMITER) {
    throw new Error("Invalid aes128gcm padding: missing last-record delimiter");
  }
  return new TextDecoder().decode(padded.slice(0, end - 1));
}

export { bytesToBase64Url, base64UrlToBytes };
