import { bytesToBase64, base64ToBytes } from "./codec.js";

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

const SCALAR_BYTES = 32; // P-256 private scalar size

function derLength(length) {
  if (length < 0x80) {
    return Uint8Array.of(length);
  }
  const bytes = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function derTlv(tag, content) {
  const length = derLength(content.length);
  const out = new Uint8Array(1 + length.length + content.length);
  out.set([tag], 0);
  out.set(length, 1);
  out.set(content, 1 + length.length);
  return out;
}

// ASN.1 OIDs fixed for this project's only curve/key type (id-ecPublicKey, prime256v1).
const OID_EC_PUBLIC_KEY = Uint8Array.of(0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01);
const OID_P256 = Uint8Array.of(0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07);

/**
 * Exports just the 32-byte raw private scalar (the JWK `d` field, base64url-
 * decoded) -- distinct from exportPrivateKeyRaw's full pkcs8 export, which
 * also embeds the public key point and is ~4x larger. Used for the mnemonic
 * backup encoding (docs/accounts.md D8), which needs a fixed, minimal byte
 * count.
 */
export async function exportPrivateKeyScalar(privateKey) {
  const jwk = await crypto.subtle.exportKey("jwk", privateKey);
  const base64 = jwk.d.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const scalar = base64ToBytes(padded);
  if (scalar.length !== SCALAR_BYTES) {
    throw new Error(`Invalid private key scalar length: expected exactly ${SCALAR_BYTES} bytes, got ${scalar.length}`);
  }
  return scalar;
}

/**
 * Reverses exportPrivateKeyScalar. The public key point (x/y) is NOT stored
 * in the scalar-only encoding -- Web Crypto's pkcs8 importer derives it
 * internally from the private scalar when the optional SEC1 public-key
 * field is omitted (verified empirically: Node and browsers built on the
 * same underlying EC implementations support this), so a full working key
 * pair (able to produce a public key via derivePublicKeyFromPrivate) comes
 * back from just the 32 bytes.
 */
export async function importPrivateKeyFromScalar(scalarBytes, algorithm, extractable = false) {
  if (scalarBytes.length !== SCALAR_BYTES) {
    throw new Error(`Invalid private key scalar length: expected exactly ${SCALAR_BYTES} bytes, got ${scalarBytes.length}`);
  }

  // SEC1 ECPrivateKey ::= SEQUENCE { version INTEGER (1), privateKey OCTET STRING } (no public key field)
  const ecPrivateKey = derTlv(0x30, new Uint8Array([
    ...derTlv(0x02, Uint8Array.of(1)),
    ...derTlv(0x04, scalarBytes)
  ]));

  // PKCS8 PrivateKeyInfo ::= SEQUENCE { version INTEGER (0), AlgorithmIdentifier, privateKey OCTET STRING }
  const algorithmIdentifier = derTlv(0x30, new Uint8Array([...OID_EC_PUBLIC_KEY, ...OID_P256]));
  const pkcs8 = derTlv(0x30, new Uint8Array([
    ...derTlv(0x02, Uint8Array.of(0)),
    ...algorithmIdentifier,
    ...derTlv(0x04, ecPrivateKey)
  ]));

  const usages = algorithm.name === "ECDSA" ? ["sign"] : ["deriveBits", "deriveKey"];
  return crypto.subtle.importKey("pkcs8", pkcs8, algorithm, extractable, usages);
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
