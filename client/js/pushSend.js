// Section PN5 (specs/phase5/push-notifications.md): sends an encrypted
// invite payload directly to a contact's push subscription (no Spirit
// server involved, per D1 zero-database + the "doorbell not mailbox"
// semantics documented at the top of push-notifications.md).
//
// IMPORTANT (2026-07-18 decision, overrides the spec's original
// "mode:no-cors" wording): this uses the fetch DEFAULT mode ("cors"), not
// "no-cors". A no-cors request throws synchronously if it carries any
// header outside the CORS-safelisted set -- and Web Push requires
// "Authorization" (VAPID) and "Content-Encoding: aes128gcm", neither of
// which are safelisted. So "no-cors" literally cannot carry what Web Push
// needs. The accepted, user-approved trade-off: some push providers may
// reject this cross-origin browser-originated POST outright (most
// real-world Web Push senders are server-side specifically to avoid this).
// That's a known residual risk, not a defect -- sendPushNotification is
// designed to fail soft (see below) so it never breaks anything when it
// happens.
import { encryptWebPushPayload } from "./webPushCrypto.js";
import { signVapidJwt } from "./vapid.js";
import { VAPID_PUBLIC_KEY_RAW_BASE64URL, VAPID_PRIVATE_KEY_JWK } from "./vapidKeys.js";

const VAPID_SUBJECT = "mailto:spirit@example.invalid"; // no real server/contact -- see PN2's rationale for the shared baked-in keypair
const PUSH_TTL_SECONDS = 86400; // 24h -- generous but bounded upper bound on how long the push service should hold this if the recipient's device is offline

export function vapidAudienceFromEndpoint(endpoint) {
  return new URL(endpoint).origin;
}

export function buildPushRequestInit(encryptedBody, jwt, vapidPublicKeyRawBase64Url) {
  return {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(PUSH_TTL_SECONDS),
      Authorization: `vapid t=${jwt}, k=${vapidPublicKeyRawBase64Url}`
    },
    body: encryptedBody
  };
}

let cachedVapidPrivateKey = null;
async function getVapidPrivateKey() {
  if (!cachedVapidPrivateKey) {
    cachedVapidPrivateKey = await crypto.subtle.importKey(
      "jwk",
      VAPID_PRIVATE_KEY_JWK,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
  }
  return cachedVapidPrivateKey;
}

/**
 * Sends an encrypted invite payload to a contact's push subscription. Fails
 * soft: a thrown/rejected fetch (CORS refusal, network error, expired
 * subscription) is swallowed and reported via the return value, never
 * thrown -- the normal invite-link flow this augments must keep working
 * even when the push side fails (doorbell, not mailbox: see spec).
 *
 * @param {{endpoint: string, keys: {p256dh: string, auth: string}}} subscription
 * @param {object} invitePayload e.g. {room, token}
 */
export async function sendPushNotification(subscription, invitePayload, { fetchImpl = fetch, now = Date.now() } = {}) {
  try {
    const encrypted = await encryptWebPushPayload(subscription.keys, JSON.stringify(invitePayload));
    const audience = vapidAudienceFromEndpoint(subscription.endpoint);
    const privateKey = await getVapidPrivateKey();
    const jwt = await signVapidJwt(privateKey, audience, VAPID_SUBJECT, { now });
    const init = buildPushRequestInit(encrypted, jwt, VAPID_PUBLIC_KEY_RAW_BASE64URL);
    await fetchImpl(subscription.endpoint, init);
    return true;
  } catch {
    return false;
  }
}
