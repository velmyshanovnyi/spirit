---
spec: specs/phase5/app-decomposition.md
section: R7 — profile/account handlers → profileUI.js
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/profileUI.js
  - client/js/app.js
  - client/tests/profileUI.test.js
  - specs/phase5/app-decomposition.md
---

# Verdict: PASS — 0 findings (1 informational note)

## Checks performed (all 6, none skipped)

1. **Verbatim move** — removed app.js lines vs profileUI.js body compared as a
   normalized multiset. Only differences: module header comment, import lines,
   `export function initProfileUI({...})` / `return { refreshProfileSelector }`
   wrapper, three `router.navigate(` → `navigate(` substitutions, and one
   deleted orphan comment (below). No other body edits.
2. **TDZ / ordering** — every identifier in profileUI.js is imported, a
   parameter or local. At the app.js call site (~990) all by-value injections
   exist: `postIdentityRoute` (const 848), `resetOwnProofsState` (981),
   `setDynamicText` (const 625), hoisted `renderGuestQuickActions` /
   `renderNotificationsCard` / `withBusyButton` / `readSessionTtlHours`.
   `renderRecoveryCard` (1001) and `router` (1097) are thunks invoked only from
   click handlers. `refreshProfileSelector` const (990) is first used at 1011.
   No residual references to `setProfileStatus`, `PORTABLE_LOGIN_PATTERN`,
   `setPortableLoginStatus` in app.js.
3. **Import pruning** — every pruned symbol has 0 remaining uses; retained
   symbols still used (`fingerprint` ×27, `formatSpiritId` ×11,
   `rememberSession` ×2, `getRememberedProfileId` ×3, `forgetSession` ×2).
   No empty import.
4. **Startup ordering** — app.js no longer touches `profile-select` /
   `account-login-block` / `account-create-mode`; the refresh awaits
   `listProfiles`, so its DOM effect still lands after synchronous initApp.
   app.test.js green → no order dependence.
5. **Test** — not vacuous: MRU ordering (`["fp-recent","fp-old"]`) only
   emerges from the real merge logic; remembered preselect; idempotent second
   call (no duplicate options); login/create visibility by `senderKey`; both
   switch links. Click handlers for create/unlock/backup remain covered by
   app.test.js (stubs here are no-ops).
6. **Spec ↔ code** — matches (injection list, placement between
   initIdentityVerificationUI and initRecoveryUI, pruned imports, thunks).

## Informational note (no fix)

Old app.js line 2892 `// Section E: publishing/managing own linked-identity proofs.`
was deleted and not carried over — it was a stale header left by R6 after
the proofs code moved to identityVerificationUI.js. Intentional.

## Tests
`npx vitest run client/tests/profileUI.test.js client/tests/app.test.js` — 404/404.
Author full suite: 62 files, 1058/1058.

## Author's live verification (2026-10-02, after deploy; app.js 170043 B, profileUI.js 11390 B byte-identical on both hosts)

- **kolomedi**: `profileUI.js` present in Resource Timing; `btn-create-profile`
  shows setup; portable checkbox auto-fills a 37-char password; portable
  create → `pub-key-display` = `spirit…`, `portable-login-display` =
  `spirit<name><tail>`, backup step shown, passphrase input cleared;
  `btn-backup-skip` navigates. No console errors.
- **kibr**: random create (nickname set) → backup step, passphrase cleared;
  `btn-backup-mnemonic` → 24 words; `btn-backup-keyfile` → `{"version":1…`,
  keyfile passphrase cleared. Reload → H5 auto-ephemeral (create path doesn't
  remember a session — pre-existing, documented). `btn-profile-unlock` with a
  wrong passphrase → "Incorrect passphrase…", with the right one → identity
  active, input cleared, login block hidden. Reload after unlock →
  login block shown, create hidden, remembered profile preselected (MRU +
  remembered-session path of `refreshProfileSelector`). No console errors.

## Pre-existing bug surfaced during live check (NOT R7 — verbatim code)
Portable (deterministic) account: `adoptIdentity` returns a non-extractable
key, so the backup-step buttons `btn-backup-mnemonic` / `btn-backup-keyfile`
fail with `Failed to execute 'exportKey' on 'SubtleCrypto': key is not
extractable` (surfaced only in the global status bar). Logged as backlog A13.
