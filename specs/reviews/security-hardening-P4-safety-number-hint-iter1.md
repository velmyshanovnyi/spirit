---
spec: phase5/security-hardening
section: P4-safety-number-hint
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/app.js
  - client/js/i18n.js
  - client/index.html
  - client/tests/app.test.js
---

Two findings, both required fixes before commit:

1. **Real bug — stale hint across session transitions.** `state.peerFingerprint = null` is reset at four sites (logout/reset, initiate, join, quick-join) but none hid `#safety-number-hint`, so a hint shown for one peer could remain visible (misleadingly) after logging out or starting a fresh session with a different peer. Fixed with a `hideSafetyNumberHint()` helper called at all four reset sites.
2. **Test-coverage gap.** The original "known contact" test only asserted the hint stayed hidden from the start, never exercising the CLEARING path from an already-shown state. Added two tests: one shows the hint for a new peer then re-announces the same peer now known and asserts the hint actually flips to hidden; one shows the hint then clicks `btn-logout` and asserts it clears.

Non-defects confirmed:
- `isFirstMeeting`/visibility set after the only early return (verify-fail) in the `identity-announce` handler -- no legitimate first-meeting case is skipped.
- `if (hintEl)` null-check matches the file's existing optional-DOM convention (e.g. `renderContactsScreen`).
- `safety.hint` i18n key present with a distinct, real translation in all 11 locale blocks; `{fp}` interpolation matches the `t()` syntax used elsewhere (e.g. `status.peerVerified`).
- Uses `verified.fingerprint` (the peer's), never `state.senderKey` (own) -- no identity mixup.

## iter2 (re-review after fixes)

Converged, zero new findings.

- All 4 `state.peerFingerprint = null` sites now call `hideSafetyNumberHint()` (app.js lines ~557, ~1611, ~1662, ~1896).
- Both new tests are non-vacuous: the "same peer reconnects as known" test exercises the actual `true -> false` transition; the logout test would fail without the fix wired into the reset path.
- No new issues: `hideSafetyNumberHint` only touches `hintEl.hidden`, no ordering conflict with adjacent state resets.
- Full suite: 532/532 (one `codec.test.js` failure in the combined run was the pre-existing flaky large-buffer test, confirmed passing 4/4 in isolation).

Convergence reached at iteration 2 -- no re-review needed.
