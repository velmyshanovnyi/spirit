import { bytesToBase64, base64ToBytes } from "./codec.js";
import { importPrivateKeyRaw, derivePublicKeyFromPrivate } from "./identity.js";
import { adoptIdentity } from "./profile.js";
import { put } from "./db.js";

const IDENTITY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" };

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

// Domain-separation prefix for the signed device list -- distinct from the
// certificate prefix so a list signature can never be replayed as a
// certificate or vice versa.
const LIST_PAYLOAD_PREFIX = "spirit-device-list-v1";

/**
 * Canonical byte string the identity key signs for a device list. Each
 * certificate contributes its four fields joined with ":" (absent from both
 * base64 and decimal number strings), certificates are joined with "|" --
 * the same injectivity argument as certificatePayload: no two distinct
 * (version, certificates) pairs serialize identically.
 */
function deviceListPayload(version, certificates) {
  const certParts = certificates.map(
    (cert) => `${cert.devicePubkey}:${cert.issuedAt}:${cert.expiresAt}:${cert.signature}`
  );
  return new TextEncoder().encode(`${LIST_PAYLOAD_PREFIX}|${version}|${certParts.join("|")}`);
}

/**
 * Signs the authoritative, versioned list of allowed device certificates
 * (docs/accounts.md, Section 10). Contacts hold the newest verified list and
 * reject traffic from certificates not on it -- so removing a certificate
 * here IS revocation, and the monotonically growing version prevents an
 * attacker from replaying an older list that still contained the revoked
 * device (see acceptNewerDeviceList).
 */
export async function signDeviceList(identityPrivateKey, certificates, { version }) {
  const signature = await crypto.subtle.sign(
    SIGNING_ALGORITHM,
    identityPrivateKey,
    deviceListPayload(version, certificates)
  );
  return { version, certificates, signature: bytesToBase64(new Uint8Array(signature)) };
}

/**
 * Pure predicate over peer-controlled input, same contract as
 * verifyDeviceCertificate: false for anything invalid, never throws.
 */
export async function verifyDeviceList(identityPublicKey, list) {
  if (
    !list ||
    typeof list.version !== "number" ||
    !Array.isArray(list.certificates) ||
    typeof list.signature !== "string" ||
    list.certificates.some(
      (cert) =>
        !cert ||
        typeof cert.devicePubkey !== "string" ||
        typeof cert.issuedAt !== "number" ||
        typeof cert.expiresAt !== "number" ||
        typeof cert.signature !== "string"
    )
  ) {
    return false;
  }

  try {
    return await crypto.subtle.verify(
      SIGNING_ALGORITHM,
      identityPublicKey,
      base64ToBytes(list.signature),
      deviceListPayload(list.version, list.certificates)
    );
  } catch {
    return false;
  }
}

/**
 * Revokes a device: re-signs the list without any certificate bound to
 * `devicePubkeyToRevoke`, with the version incremented so contacts prefer
 * the new list over any replayed older one.
 */
export async function revokeDevice(identityPrivateKey, currentList, devicePubkeyToRevoke) {
  const certificates = currentList.certificates.filter((cert) => cert.devicePubkey !== devicePubkeyToRevoke);
  return signDeviceList(identityPrivateKey, certificates, { version: currentList.version + 1 });
}

/**
 * Membership check a contact runs against its held (already-verified) list
 * before accepting traffic from a device certificate. Synchronous: pure
 * data comparison, no crypto -- the list's own signature was checked at
 * acceptance time (acceptNewerDeviceList), and the certificate's at
 * handshake time (verifyDeviceCertificate).
 */
export function isDeviceCertificateAllowed(list, certificate) {
  return list.certificates.some(
    (cert) => cert.devicePubkey === certificate.devicePubkey && cert.signature === certificate.signature
  );
}

/**
 * Monotonic update rule for the list a contact holds: adopt `incoming` only
 * if it verifies AND is strictly newer than `current`. Everything else --
 * invalid signature, same version, or an older (possibly replayed) list --
 * leaves `current` in place. `current` may be null (first list ever seen).
 */
export async function acceptNewerDeviceList(identityPublicKey, current, incoming) {
  if (!(await verifyDeviceList(identityPublicKey, incoming))) return current;
  if (current !== null && current !== undefined && incoming.version <= current.version) return current;
  return incoming;
}

/**
 * Adds a newly-certified device to the own signed device list (or starts a
 * version-1 list if none exists yet). Takes RAW identity bytes for the same
 * reason as createLinkGrant: the primary's linking flow already holds them,
 * and a loaded profile's CryptoKey is non-extractable.
 */
export async function appendDeviceToList(identityRawPrivateKey, currentList, certificate) {
  const identityPrivateKey = await importPrivateKeyRaw(identityRawPrivateKey, IDENTITY_ALGORITHM, false);
  const certificates = [...(currentList ? currentList.certificates : []), certificate];
  const version = (currentList ? currentList.version : 0) + 1;
  return signDeviceList(identityPrivateKey, certificates, { version });
}

/**
 * First message of the linking handshake, sent by the NEW device over the
 * already-established E2EE channel: announces the device public key the
 * primary should certify. Possession of the invite token (shared
 * out-of-band, docs/accounts.md) alone used to be treated as sufficient
 * authorization for the primary to hand over the raw identity key --
 * Section B6 (specs/reviews/spirit-evaluation-triage.md) closes that: the
 * primary now REQUIRES the human to compare deriveLinkVerificationCode()
 * on both screens before sending a grant (app.js), and MAY additionally
 * require `pin` (out-of-band-shared, e.g. read aloud) to match before even
 * showing that confirmation -- optional, and not a substitute for the SAS
 * check, since a PIN echoed back over a channel an active MITM controls
 * offers no protection on its own.
 */
export async function createLinkRequest(devicePublicKey, { pin } = {}) {
  const spki = await crypto.subtle.exportKey("spki", devicePublicKey);
  const request = { type: "device-link-request", devicePubkey: bytesToBase64(new Uint8Array(spki)) };
  if (pin !== undefined) request.pin = pin;
  return request;
}

/**
 * Section B6: a short authentication string (SAS) both sides of the
 * linking channel can compute independently from the channel's OWN ECDH
 * public keys (state.sessionEcdhWires in app.js) -- already exchanged in
 * plaintext via signaling, so this derives no new secret and leaks
 * nothing beyond what a passive observer of the signaling traffic already
 * sees. Order-independent (sorted before hashing) so it doesn't matter
 * which side is "local" vs "peer".
 *
 * KNOWN LIMITATION (exec-review finding F1, specs/reviews/spirit-evaluation-triage.md):
 * this code is NOT a full defense against a live, on-path signaling MITM.
 * Real ZRTP/Signal-style SAS safety relies on one side COMMITTING (hashing)
 * to its key before seeing the peer's -- here, the primary publishes its
 * real ECDH key in the offer unconditionally as the very first protocol
 * step (createOffer, before any joiner exists), so a MITM that intercepts
 * both legs can choose its own key AFTER learning the target hash and grind
 * ~2^20 keypairs (this code's ~6-digit space) to find one producing a
 * matching SAS on both screens -- well within a few minutes on ordinary
 * hardware, comfortably inside the default answer-wait timeout. This DOES
 * close the simpler, more common attack the audit described (an attacker
 * who merely obtained/guessed the invite token asynchronously, with no live
 * signaling position, can no longer get an automatic grant) -- it does NOT
 * close a fully active, real-time, resourced signaling attacker. Closing
 * that requires a commit-then-reveal round added to the linking protocol
 * (the responding side publishes a hash of its key before the primary
 * reveals its own), which needs a signaling-protocol change and is tracked
 * as future work, not implemented here.
 */
export async function deriveLinkVerificationCode(wireA, wireB) {
  const [first, second] = [wireA, wireB].sort();
  const combined = new TextEncoder().encode(`spirit-link-sas-v1|${first}|${second}`);
  const digest = await crypto.subtle.digest("SHA-256", combined);
  const bytes = new Uint8Array(digest);
  const num = ((bytes[0] << 16) | (bytes[1] << 8) | bytes[2]) % 1000000;
  return String(num).padStart(6, "0");
}

/**
 * Primary device's reply: certifies the requested device key and hands over
 * the identity. Takes RAW identity bytes (not a CryptoKey) because a loaded
 * profile's private key is deliberately non-extractable -- the caller
 * re-derives the raw bytes via profile.js's exportRawIdentity(passphrase),
 * making linking require a passphrase confirmation.
 *
 * @throws for a malformed request, or a devicePubkey that isn't a parseable
 *         P-256 SPKI key (crypto.subtle.importKey rejects garbage here --
 *         the validation deliberately deferred from Section 8's verify).
 */
export async function createLinkGrant(identityRawPrivateKey, request, { contacts = [], validityMs, now } = {}) {
  if (!request || request.type !== "device-link-request" || typeof request.devicePubkey !== "string") {
    throw new Error("Malformed device link request");
  }

  const devicePublicKey = await crypto.subtle.importKey(
    "spki",
    base64ToBytes(request.devicePubkey),
    IDENTITY_ALGORITHM,
    true,
    ["verify"]
  );

  const identityPrivateKey = await importPrivateKeyRaw(identityRawPrivateKey, IDENTITY_ALGORITHM, false);
  const certOptions = {};
  if (validityMs !== undefined) certOptions.validityMs = validityMs;
  if (now !== undefined) certOptions.now = now;
  const certificate = await signDeviceCertificate(identityPrivateKey, devicePublicKey, certOptions);

  return {
    type: "device-link-grant",
    certificate,
    identityPrivateKey: bytesToBase64(new Uint8Array(identityRawPrivateKey)),
    contacts
  };
}

/**
 * New device's final step: validates the grant and only then persists.
 * Order matters -- nothing is written until (1) the certificate is bound to
 * THIS device's own key (a grant certifying some other key must not be
 * accepted, even from the legitimate identity) and (2) the certificate
 * verifies against the identity delivered in the grant itself (a tampered
 * or mismatched grant persists nothing).
 */
export async function applyLinkGrant(grant, localPassphrase, { devicePublicKey }) {
  if (
    !grant ||
    grant.type !== "device-link-grant" ||
    typeof grant.identityPrivateKey !== "string" ||
    !grant.certificate ||
    !Array.isArray(grant.contacts)
  ) {
    throw new Error("Malformed device link grant");
  }

  const ownSpki = await crypto.subtle.exportKey("spki", devicePublicKey);
  if (grant.certificate.devicePubkey !== bytesToBase64(new Uint8Array(ownSpki))) {
    throw new Error("Link grant certificate is bound to a different device key");
  }

  const rawIdentity = base64ToBytes(grant.identityPrivateKey);
  const extractableIdentity = await importPrivateKeyRaw(rawIdentity, IDENTITY_ALGORITHM, true);
  const identityPublicKey = await derivePublicKeyFromPrivate(extractableIdentity, IDENTITY_ALGORITHM);
  if (!(await verifyDeviceCertificate(identityPublicKey, grant.certificate))) {
    throw new Error("Invalid device certificate in link grant");
  }

  const identityKeyPair = await adoptIdentity(rawIdentity, localPassphrase);
  for (const { key, value } of grant.contacts) {
    await put("contacts", key, value);
  }

  return { identityKeyPair, certificate: grant.certificate, contacts: grant.contacts };
}
