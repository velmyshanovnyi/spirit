import { bytesToBase64, base64ToBytes } from "./e2ee.js";

export async function generateIdentityKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
}

export async function generateEcdhKeyPair() {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits", "deriveKey"]
  );
}

export async function exportPrivateKeyRaw(privateKey) {
  return crypto.subtle.exportKey("pkcs8", privateKey);
}

export async function importPrivateKeyRaw(rawKey, algorithm, extractable = false) {
  const usages = algorithm.name === "ECDSA" ? ["sign"] : ["deriveBits", "deriveKey"];
  return crypto.subtle.importKey("pkcs8", rawKey, algorithm, extractable, usages);
}

/**
 * Recovers a usable public CryptoKey from only a private key -- needed when
 * restoring an identity from a backup that stores just the raw private key
 * bytes (docs/accounts.md D8: mnemonic/keyfile encode the private scalar
 * only, not a separately-tracked public key). Web Crypto has no direct
 * "derive public key" operation, but JWK export of an EC private key is
 * REQUIRED by spec (RFC 7518 6.2.2) to include the public x/y coordinates
 * alongside the private scalar `d` -- so exporting to JWK and re-importing
 * without `d` reliably reconstructs the public key, regardless of whether
 * the original import format (e.g. pkcs8) happens to embed it too.
 * `privateKey` must be extractable for this to work.
 */
export async function derivePublicKeyFromPrivate(privateKey, algorithm, keyUsages = algorithm.name === "ECDSA" ? ["verify"] : []) {
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const { d: _privateScalar, ...publicJwk } = jwk;
  publicJwk.key_ops = keyUsages;
  return crypto.subtle.importKey("jwk", publicJwk, algorithm, true, keyUsages);
}

export async function exportEcdhPublicKeyForWire(publicKey) {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  return bytesToBase64(new Uint8Array(spki));
}

export async function importEcdhPublicKeyFromWire(base64) {
  return crypto.subtle.importKey("spki", base64ToBytes(base64), { name: "ECDH", namedCurve: "P-256" }, true, []);
}

export async function fingerprint(publicKey) {
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  const digest = await crypto.subtle.digest("SHA-256", spki);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
