---
spec: specs/phase5/app-decomposition.md
section: R8 — push notifications → notificationsUI.js
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/notificationsUI.js
  - client/js/app.js
  - client/tests/notificationsUI.test.js
  - specs/phase5/app-decomposition.md
---

# Verdict: PASS — 0 findings

1. **Verbatim move** — `renderNotificationsCard` block (comment, function,
   startup call) and the whole `enableNotifications` block incl. change
   handler and c8 markers are identical in the module. Not carried over, all
   intentional: 2 pruned imports, the `ownPushSubscriptionKey` line (moved +
   exported), two orphan module-scope comments, one blank line.
2. **TDZ / ordering** — all module identifiers resolve (put/db.js,
   buildPushSubscribeOptions + serializeSubscriptionForAnnounce/pushSubscription.js,
   VAPID_PUBLIC_KEY_RAW_BASE64URL/vapidKeys.js, encryptMessage/e2ee.js, params).
   In app.js the const is created at 965; all 8 uses (980, 998, 1576, 2778,
   3030, 3087, 3345, 3402) come after. Sole `ownPushSubscriptionKey` use (2336)
   resolves to the import (41).
3. **Import pruning** — pruned symbols have 0 uses; `parsePushSubscriptionAnnounce`
   still used (2078); no empty imports.
4. **Test** — meaningful: key format, hidden at init, shown after vaultKey +
   re-render; second test asserts `"Notification" in window === false` itself,
   so the jsdom assumption fails loudly if it ever changes.
5. **Spec ↔ code** — matches (line numbers marked approximate).

Tests: notificationsUI + app — 404/404. Author full suite: 63 files, 1060/1060.
Author-side RED confirmed before the module existed (import resolution failure).

## Author's live verification
(filled in after deploy)
