// Section PN2 (specs/phase5/push-notifications.md): RFC 8292 VAPID JWT
// signing -- identifies the "application server" to a push provider
// (Google FCM/Mozilla autopush) so it can rate-limit/attribute a sender.
// Not part of the E2E security boundary (see vapidKeys.js for why the
// keypair is shared/public).
import { bytesToBase64Url } from "./webPushCrypto.js";

const MAX_TTL_SECONDS = 24 * 3600; // RFC 8292 hard limit

/**
 * @param {CryptoKey} vapidPrivateKey ECDSA P-256 private key, "sign" usage.
 * @param {string} audience the push service's origin, e.g. "https://fcm.googleapis.com".
 * @param {string} subject a contact URI for the push provider to reach the
 *   sender if needed, e.g. "mailto:..." or "https://...".
 */
export async function signVapidJwt(vapidPrivateKey, audience, subject, { now = Date.now(), ttlSeconds = MAX_TTL_SECONDS } = {}) {
  const cappedTtlSeconds = Math.min(ttlSeconds, MAX_TTL_SECONDS);
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(now / 1000) + cappedTtlSeconds,
    sub: subject
  };

  const encoder = new TextEncoder();
  const headerB64 = bytesToBase64Url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Web Crypto's ECDSA sign already outputs the raw IEEE-P1363 (r || s)
  // format JOSE/JWT requires -- unlike many non-browser crypto libraries
  // (e.g. Node's default), no DER-to-raw conversion is needed here.
  const signatureBits = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    vapidPrivateKey,
    encoder.encode(signingInput)
  );
  const signatureB64 = bytesToBase64Url(new Uint8Array(signatureBits));

  return `${signingInput}.${signatureB64}`;
}
