---
spec: phase5/social-recovery
section: S3
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/socialRecovery.js
  - client/tests/socialRecovery.test.js
  - client/js/app.js
  - client/tests/app.test.js
  - client/index.html
  - client/js/i18n.js
  - client/js/recoveryShare.js
  - client/js/trustedShares.js
---

## Must-fix (0 findings)

None.

## Nice-to-have (2 findings, both fixed this iteration)

**1. `recovery.noHeldShares` was defined in all 10 locales but never rendered; the
held-shares list had no empty state.**

`client/js/app.js`'s `renderRecoveryCard` held-shares block looped `for (const share of
held)` with no empty branch, so a trustee holding zero shares saw a blank
`#recovery-held-list` with no explanation. Fix: render `t("recovery.noHeldShares")` as a
`<p class="hint">` when `held.length === 0`.

**2. The `finally` block wiped the pasted shares textarea even on a *retryable* import
failure, forcing a full re-paste mid-recovery-crisis.**

`client/js/app.js`'s `btn-recover-from-shares` handler ran the same `finally` clearing
`recovery-restore-shares` on both success AND the `restoreImportFailed` catch path --
but the UX copy explicitly invites retry ("...re-typed correctly, then try again"), and
the individual pasted shares are below-threshold-useless on their own (no security
reason to force re-entry). Fix: only clear `recovery-restore-shares` on the success
path; the passphrase is still cleared in both cases (it's short-lived, easy to re-type,
and re-encrypts fresh key material each time regardless).

## Checked and clean

- **Pre-combine consistency check ordering (the single most important correctness
  property for this section) -- CORRECT.** `socialRecovery.js`'s `recoverFromShares`
  runs the `threshold`/`totalShares` cross-consistency loop over all decoded shares,
  and only reaches `combineShares(distinct.slice(0, threshold))` afterward, once
  de-duplication and the sufficiency check (`distinct.length < threshold`) both pass.
  Mismatched-set shares return `{ reason: "inconsistent" }` and `combineShares` is never
  called. Verified directly by reading the function body's statement order, and by the
  test `socialRecovery.test.js`'s "rejects shares from two different split cycles"
  case plus the app-level integration test asserting `adoptScalarIdentity` is never
  called on that path.
- **Secret-scalar handling matches existing raw-key-material care elsewhere in this
  codebase.** The recovered scalar is never logged; the success status surfaces only
  `formatSpiritId(state.senderKey)` (the resulting fingerprint), never the scalar
  itself; `recovery-restore-passphrase` is cleared in both the success and failure
  paths; `recovery-restore-shares` is now cleared only on success (post-fix #2 above).
  Consistent with `btn-login-portable`'s handling of `privateKeyScalar` (also never
  logged, also not explicitly zeroed after `adoptScalarIdentity` consumes it -- no
  regression, matches the pre-existing pattern).
- **Post-recovery `adoptScalarIdentity` call is genuinely identical in behavior to the
  existing portable-login path.** Same ordered post-scalar sequence in both handlers:
  `adoptScalarIdentity` -> `state.senderKey = profileId` -> `getNickname` ->
  `resetOwnProofsState` -> `renderGuestQuickActions` -> `renderNotificationsCard` ->
  `renderRecoveryCard` -> `pub-key-display` update -> `rememberSession` ->
  `recordRecentAccount` -> `refreshProfileSelector` -> `router.navigate`. No new or
  weaker security posture introduced for this path.
- **Held-shares "show as text" gating -- reasoned judgment call, not a skip.** No
  re-authentication gate was added, deliberately: `trustedShares` stores at most one
  share per `ownerFingerprint`, so a reveal exposes exactly one share -- below
  `threshold` and information-theoretically useless alone (Shamir's guarantee, S1). This
  is categorically different from a mnemonic or keyfile reveal, either of which alone
  reconstructs the entire key and is correctly gated behind extra confirmation
  elsewhere in this codebase. The reasoning holds and is documented inline at the
  reveal's call site.
- **Malformed-share-text and insufficient-shares error paths are clear and
  actionable.** `recoverFromShares`'s four typed reasons (`empty`/`malformed`/
  `inconsistent`/`insufficient`) each route to a distinct, specific i18n key (English
  and Ukrainian both reviewed); `malformed` echoes the offending line, `insufficient`
  reports have-vs-need counts. A raw `adoptScalarIdentity` throw is caught and
  converted to a plain "didn't produce a valid key, try again" message rather than a
  stack trace -- verified the raw underlying error string never leaks into the status
  text.
- **De-duplication and malformed-line handling are correct**, and the new tests
  (`socialRecovery.test.js`'s 8 cases, `app.test.js`'s 7 integration cases) exercise
  real decode/validate/combine/adopt paths rather than tautological assertions --
  confirmed by reverting the implementation and observing all 7 new `app.test.js` S3
  tests fail (RED) before the wiring existed, then pass (GREEN) after.

## Test results

Full suite green: 590/590 (40 test files), no regressions from the 583-test baseline
going into this section (575 baseline post-S2 + 8 new pure `socialRecovery.js` tests +
7 new `app.test.js` integration tests = 590).

## Convergence

Zero must-fix findings. Both nice-to-have findings were fixed directly in this
iteration (evidence above), re-verified with a full green test run after the fixes. No
second review round requested -- the fixes were small, mechanical, and directly
addressed the reviewer's exact quoted code with no ambiguity requiring further passes.
