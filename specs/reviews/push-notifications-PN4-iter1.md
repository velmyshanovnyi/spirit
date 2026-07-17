---
spec: phase5/push-notifications
section: PN4
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/pushSubscription.js
  - client/tests/pushSubscription.test.js
  - client/js/contacts.js
  - client/tests/contacts.test.js
  - client/js/app.js
  - client/tests/app.test.js
  - client/index.html
  - client/js/i18n.js
---

One finding, fixed before commit:

**1. CONFIRMED (cosmetic, not correctness/security) — undefined CSS class on the notifications checkbox.** `client/index.html` used `<label class="field-inline">` for the new notifications toggle, but `.field-inline` is defined nowhere in `client/css/style.css`. The established pattern for a checkbox field (already used by the profile-creation checkbox at index.html:116) is `class="field checkbox-field"`. Fixed by changing the class to match.

Non-defects confirmed during this pass:
- `renderNotificationsCard()`'s hidden/shown lifecycle is wired at every one of the 9 existing `renderGuestQuickActions()` call sites (10 including the initial-load call), correctly mirroring that established permanent-profile-only visibility pattern; no missed or unpaired call site.
- `enableNotifications()` calls `registration.pushManager.getSubscription()` before `subscribe()`, avoiding needless endpoint/key rotation on re-enable.
- The `{endpoint, keys}` shape written to `ownPushSubscriptionKey(state.senderKey)` on subscribe matches exactly what `makeIdentityAnnouncer`'s follow-up reads and sends (`{ type: "push-subscription-announce", ...ownPushSubscription }`), and what `parsePushSubscriptionAnnounce` expects on the receiving side.
- `VAPID_PUBLIC_KEY_RAW_BASE64URL` import path/name from `vapidKeys.js` is correct; `base64UrlToBytes` reuse from `webPushCrypto.js` is correct.
- `push-subscription-announce`'s gate in `handleChatMessage` is byte-for-byte the same predicate as `device-list-announce`/`proof-set-announce` (verified peer + permanent profile).
- The subscription is persisted only to local IndexedDB and transmitted only over the E2EE data channel -- it never touches the Spirit signaling server (zero-database invariant preserved). Incoming announces are only stored for an already-TOFU-registered contact (orphan-record guard).
- Test coverage confirmed for: outgoing announce present/absent based on stored subscription; incoming valid announce from a verified profile-mode peer calling `updateContactPushSubscription`; malformed announce ignored; ephemeral-mode/unverified-peer gate enforced. 513/513 tests green (492 baseline + 21 new: 13 pushSubscription.test.js, 2 contacts.test.js, 6 app.test.js).
