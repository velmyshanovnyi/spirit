// Section PN4 (specs/phase5/push-notifications.md): pure, testable helpers
// for enabling Web Push notifications and exchanging the resulting
// subscription P2P (never touching the Spirit server). Notification /
// serviceWorker / PushManager runtime glue lives in app.js (untestable in
// jsdom, per the same split used by sw.js in PN3).

import { base64UrlToBytes } from "./webPushCrypto.js";

/**
 * Options for PushManager.subscribe(): userVisibleOnly is required by the
 * spec (Spirit always shows a visible notification, never a silent push);
 * applicationServerKey is the shared VAPID public key (Section PN2) decoded
 * to raw bytes as PushManager expects.
 */
export function buildPushSubscribeOptions(vapidPublicKeyRawBase64Url) {
  return {
    userVisibleOnly: true,
    applicationServerKey: base64UrlToBytes(vapidPublicKeyRawBase64Url)
  };
}

/**
 * Extracts the {endpoint, keys} shape needed to send this subscription push
 * from a real PushSubscription (via toJSON()) or an already-plain object
 * (as read back from IndexedDB). Returns null if the shape is invalid.
 */
export function serializeSubscriptionForAnnounce(subscription) {
  const json = typeof subscription.toJSON === "function" ? subscription.toJSON() : subscription;
  const endpoint = json && json.endpoint;
  const keys = json && json.keys;
  if (typeof endpoint !== "string" || !endpoint) return null;
  if (!keys || typeof keys.p256dh !== "string" || !keys.p256dh || typeof keys.auth !== "string" || !keys.auth) {
    return null;
  }
  return { type: "push-subscription-announce", endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/**
 * Validates an incoming push-subscription-announce control message from a
 * peer. Same defensive-parsing style as sw.js's parsePushData.
 */
export function parsePushSubscriptionAnnounce(control) {
  if (!control || typeof control !== "object") return null;
  const { endpoint, keys } = control;
  if (typeof endpoint !== "string" || !endpoint) return null;
  if (!keys || typeof keys !== "object") return null;
  const { p256dh, auth } = keys;
  if (typeof p256dh !== "string" || !p256dh || typeof auth !== "string" || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}
