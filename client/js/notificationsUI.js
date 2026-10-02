// Section R8 (specs/phase5/app-decomposition.md, backlog A4): push
// notifications toggle (Section PN4) -- card visibility (permanent profile
// only) and the enable flow (permission, service-worker subscription,
// persist, announce to the live peer) -- extracted verbatim out of app.js's
// initApp() closure, continuing the G1/R1-R7 dependency-injection pattern.
// `state` is the same mutable object app.js holds (identityKeyPair,
// senderKey, channel, sessionKey are read from it at call-time).
// app.js consumes renderNotificationsCard and ownPushSubscriptionKey.
import { put } from "./db.js";
import { buildPushSubscribeOptions, serializeSubscriptionForAnnounce } from "./pushSubscription.js";
import { VAPID_PUBLIC_KEY_RAW_BASE64URL } from "./vapidKeys.js";
import { encryptMessage } from "./e2ee.js";

export const ownPushSubscriptionKey = (profileId) => `pushSubscription:${profileId}`;

export function initNotificationsUI({ doc, el, t, state }) {
  // Section PN4 (specs/phase5/push-notifications.md): the notifications
  // toggle only makes sense for a permanent profile (vaultKey present) --
  // ephemeral "spirits" have nowhere to persist a subscription. Same
  // call-site pattern as renderGuestQuickActions: called at every
  // identity-establishing/clearing point.
  function renderNotificationsCard() {
    const card = el("notifications-card");
    if (!card) return;
    card.hidden = !(state.identityKeyPair && state.identityKeyPair.vaultKey);
  }
  renderNotificationsCard();

  // Section PN4 (specs/phase5/push-notifications.md): enabling push
  // notifications. Mostly untested runtime glue -- Notification,
  // navigator.serviceWorker and PushManager don't exist in jsdom (same split
  // as sw.js in PN3: pure helpers in pushSubscription.js are tested, this
  // wiring isn't). Permanent-profile only (gated by vaultKey, same as
  // renderNotificationsCard's own visibility).
  /* c8 ignore start */
  async function enableNotifications() {
    const checkbox = el("notifications-enabled");
    const setNotificationsStatus = (text) => {
      el("notifications-status").textContent = text;
    };
    if (!state.identityKeyPair || !state.identityKeyPair.vaultKey) {
      if (checkbox) checkbox.checked = false;
      return;
    }
    if (!("Notification" in doc.defaultView) || !("serviceWorker" in doc.defaultView.navigator)) {
      setNotificationsStatus(t("notifications.notSupported"));
      if (checkbox) checkbox.checked = false;
      return;
    }
    try {
      const permission = await doc.defaultView.Notification.requestPermission();
      if (permission !== "granted") {
        setNotificationsStatus(t("notifications.permissionDenied"));
        if (checkbox) checkbox.checked = false;
        return;
      }
      const registration = await doc.defaultView.navigator.serviceWorker.ready;
      // Avoid double-subscribing (and rotating the endpoint/keys for no
      // reason) if this profile already has an active push subscription.
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe(
          buildPushSubscribeOptions(VAPID_PUBLIC_KEY_RAW_BASE64URL)
        );
      }
      const serialized = serializeSubscriptionForAnnounce(subscription);
      if (!serialized) {
        setNotificationsStatus(t("status.error", { msg: "invalid subscription" }));
        if (checkbox) checkbox.checked = false;
        return;
      }
      const { endpoint, keys } = serialized;
      await put("profile", ownPushSubscriptionKey(state.senderKey), { endpoint, keys });
      if (state.channel && state.sessionKey) {
        state.channel.send(
          await encryptMessage(state.sessionKey, JSON.stringify({ type: "push-subscription-announce", endpoint, keys }))
        );
      }
      setNotificationsStatus(t("notifications.enabled"));
    } catch (err) {
      setNotificationsStatus(t("status.error", { msg: err.message }));
      if (checkbox) checkbox.checked = false;
    }
  }
  el("notifications-enabled")?.addEventListener("change", () => {
    if (el("notifications-enabled").checked) {
      enableNotifications();
    }
  });
  /* c8 ignore stop */

  return { renderNotificationsCard };
}
