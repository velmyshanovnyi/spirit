---
spec: simplified-ephemeral-mode
section: SM1
iter: 1
agent: opus (general-purpose, worktree isolation)
files-reviewed:
  - client/js/advancedMode.js
  - client/tests/advancedMode.test.js
  - client/js/adminAuth.js (context only, unchanged)
---

## Findings (2, both CONFIRMED and fixed)

1. `client/js/advancedMode.js:6` — `isAdvancedModeUnlocked()`'s
   `localStorage.getItem` was unguarded, unlike every other localStorage
   read in the codebase (`theme.js:13-17`, `i18n.js:3922`, `app.js`'s
   `spirit.welcomeSeen` fail-open policy). In Safari private mode /
   blocked-third-party-storage contexts this would throw mid-`initApp`
   instead of failing closed to the simplified default. **Fixed**:
   wrapped in try/catch, fails closed to `false`.

2. `client/js/advancedMode.js:18` — `unlockAdvancedMode`'s
   `localStorage.setItem` was on the same promise/error channel as
   `adminLogin`'s `AdminAuthError`, so a correct password plus a
   storage/quota failure would be shown to the user as "wrong password".
   **Fixed**: `setItem` wrapped separately, throws a plain `Error` (not
   `AdminAuthError`) with a distinct message so SM2's UI can tell the
   two failure modes apart.

## Explicitly checked, clean (not re-litigated)

- Flag-on-success-only ordering: `await adminLogin(...)` precedes any
  storage write, so a rejection short-circuits before any write — no
  race, no unhandled rejection.
- Storage key `spirit.advancedModeUnlocked` matches spec text and test
  constant exactly, no collision elsewhere in `client/`.
- No security overclaim in naming/comments — module comment accurately
  states the token is discarded and the effect is purely local, matching
  the spec's explicit "UI-cleanliness gate, not a security boundary"
  framing.
- Tests exercise the real module against real jsdom `localStorage` (only
  `adminAuth.js` is mocked, per spec) — not mocks validating mocks.
- Appropriately minimal — no speculative generality.

## Convergence

CONVERGED after 1 iteration. Both findings fixed; 2 new regression tests
added (storage-unavailable-on-read, storage-unavailable-on-write). Full
`advancedMode.test.js`: 7/7 green.
