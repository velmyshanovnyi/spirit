import { bytesToBase64, base64ToBytes } from "./codec.js";

const SIGNING_ALGORITHM = { name: "ECDSA", hash: "SHA-256" };
const DEFAULT_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 60_000; // same tolerance as googleOAuth.js's iat check

// Domain-separation prefix: a signature over this payload can never be
// confused with (or replayed as) a signature over any other Spirit message
// type, and the version pins the payload layout for future format changes.
const CERT_PAYLOAD_PREFIX = "spirit-device-cert-v1";

/**
 * Per-device ECDSA keypair, deliberately separate from the identity keypair
 * (docs/accounts.md): the identity key signs device certificates; each
 * device signs its day-to-day traffic with its own key, so revoking a
 * device (Section 10) never requires rotating the identity itself.
 */
export async function generateDeviceKeyPair() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}

/**
 * The exact byte string the identity key signs. Fields are joined with "|",
 * which cannot occur in base64 or decimal numbers, so the encoding is
 * injective -- no two distinct (devicePubkey, issuedAt, expiresAt) triples
 * serialize to the same payload (a canonical-form requirement; ambiguity
 * here would let an attacker shift bytes between fields).
 */
function certificatePayload(devicePubkeyBase64, issuedAt, expiresAt) {
  return new TextEncoder().encode(`${CERT_PAYLOAD_PREFIX}|${devicePubkeyBase64}|${issuedAt}|${expiresAt}`);
}

/**
 * Issues a device certificate: the identity private key signs the device's
 * public key together with a validity window. The certificate is a plain
 * JSON-serializable object (it travels over the E2EE channel in Section 9).
 */
export async function signDeviceCertificate(identityPrivateKey, devicePublicKey, { validityMs = DEFAULT_VALIDITY_MS, now = Date.now() } = {}) {
  const spki = await crypto.subtle.exportKey("spki", devicePublicKey);
  const devicePubkey = bytesToBase64(new Uint8Array(spki));
  const issuedAt = now;
  const expiresAt = issuedAt + validityMs;

  const signature = await crypto.subtle.sign(
    SIGNING_ALGORITHM,
    identityPrivateKey,
    certificatePayload(devicePubkey, issuedAt, expiresAt)
  );

  return {
    devicePubkey,
    issuedAt,
    expiresAt,
    signature: bytesToBase64(new Uint8Array(signature))
  };
}

/**
 * Verification is a pure predicate: returns false for anything invalid --
 * forged, tampered, expired, not-yet-valid, malformed, or signed by a
 * different identity -- and never throws (a malicious peer controls this
 * input entirely; an exception here must not crash the caller).
 *
 * `now` is injectable for tests; issuedAt is allowed CLOCK_SKEW_MS of
 * forward skew (peers' clocks are never perfectly aligned), expiry is not.
 */
export async function verifyDeviceCertificate(identityPublicKey, certificate, { now = Date.now() } = {}) {
  if (
    !certificate ||
    typeof certificate.devicePubkey !== "string" ||
    typeof certificate.issuedAt !== "number" ||
    typeof certificate.expiresAt !== "number" ||
    typeof certificate.signature !== "string"
  ) {
    return false;
  }

  if (now > certificate.expiresAt) return false;
  if (now < certificate.issuedAt - CLOCK_SKEW_MS) return false;

  try {
    const signature = base64ToBytes(certificate.signature);
    return await crypto.subtle.verify(
      SIGNING_ALGORITHM,
      identityPublicKey,
      signature,
      certificatePayload(certificate.devicePubkey, certificate.issuedAt, certificate.expiresAt)
    );
  } catch {
    return false; // malformed base64 or a key/format error -- invalid, not fatal
  }
}
