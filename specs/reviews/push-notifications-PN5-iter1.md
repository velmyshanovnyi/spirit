---
spec: phase5/push-notifications
section: PN5
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/pushSend.js
  - client/tests/pushSend.test.js
  - client/js/webPushCrypto.js
  - client/js/vapid.js
  - client/js/vapidKeys.js
  - client/js/app.js
  - client/tests/app.test.js
  - client/js/i18n.js
---

Zero findings, converged on the first iteration.

Non-defects confirmed during this pass:
- `sendPushNotification` (`client/js/pushSend.js`) genuinely never throws out of its call site: a single `try` wraps every awaited call inside it (`encryptWebPushPayload`, `getVapidPrivateKey`, `signVapidJwt`, `fetchImpl`), `catch { return false }` swallows everything. The `app.js` call site is `void sendPushNotification(...)` -- fire-and-forget, not awaited. Even a hypothetical synchronous throw inside an `async` function surfaces only as a rejected promise, never a sync throw, so `void`-ing it cannot break `initiateChatSession`'s normal flow.
- `vapidAudienceFromEndpoint` (`new URL(endpoint).origin`) is correct per RFC 8292 -- yields scheme+host+port with no path, exactly what `aud` requires. Verified against both an FCM-shaped and a Mozilla-shaped endpoint in `pushSend.test.js`.
- The VAPID private key is cached correctly: a module-level `cachedVapidPrivateKey`, imported once from `VAPID_PRIVATE_KEY_JWK` (the correct constant), not re-imported on every send, and not stale (the constant is a frozen baked-in key).
- The round-trip test in `pushSend.test.js` genuinely exercises the real wire format end-to-end -- it generates an independent ECDH P-256 keypair for the "receiver", runs the real `encryptWebPushPayload`, and decrypts the *actual* `init.body` that was handed to the mocked `fetchImpl` using `decryptWebPushPayload` with the matching keypair, asserting the decrypted JSON equals the original invite payload. A subtly wrong wire format would fail AES-GCM authentication, so this is a real cross-check, not a shortcut.
- Factoring `initiateChatSession` to accept an optional `{ pushToContact = null }` does not change behavior at any of its other existing call sites (explicit "Ініціювати чат", quick-chat, and the device-linking-adjacent internal callers) -- all of them call with zero args, so `pushToContact` defaults to `null` and the new `if (pushToContact?.pushSubscription)` branch is provably unreachable for them. Confirmed both by reading every call site and by the "without pushing when there's no stored subscription" test.
- The stored `pushSubscription` shape (`{endpoint, keys: {p256dh, auth}}`, per `pushSubscription.js`) matches exactly what `sendPushNotification` destructures.
- The new Contacts-screen "message this contact" button is a single delegated listener on `#contacts-list` (not one per row), looked up by `data-contact-fingerprint` on the row, consistent with the existing pattern used elsewhere in `app.js`.
- `contacts.message` i18n key present and correct in all 11 locale blocks in `client/js/i18n.js`; the existing locale-parity test (`i18n.test.js`) passes.
- Full test suite: 521/521 green (513 baseline + 5 new `pushSend.test.js` + 3 new `app.test.js` message-button tests).
