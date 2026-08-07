---
spec: (no formal spec file -- small-change carve-out, direct reaction to a
  user request; 3 files touched: advancedModeUI.js, app.js, app.test.js)
section: restricted-route password modal
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/advancedModeUI.js
  - client/js/app.js
  - client/tests/app.test.js
---

## Context

User request (2026-08-08, screenshot): the "розділ вимкнено" notice gave a
locked-out user with the real password no actionable path forward -- they
had to already know to hunt for the tiny "Розширений режим" footer link
themselves. Clicking a restricted route now ALSO opens the password modal
directly, and a successful unlock takes the user straight to the route
they originally wanted.

## Verdict: CONVERGED (after fixes below)

Reviewer confirmed via probe tests: the lock-vs-unlock discrimination in
`onVisibilityChange` is correct for locking (never navigates); all modal
close paths (`#advanced-mode-modal` has no backdrop-click or Escape
handler, only the Cancel button and a successful unlock hide it) clear
`pendingRestrictedRoute`, so no route can leak into an unrelated later
unlock; double-`onRestricted` in rapid succession is last-click-wins with
no other side effect; the `router` closure reference inside
`onVisibilityChange` is safe (never invoked before `initApp()` finishes
assigning it); and the test-race fix (waiting for the modal instead of
`pub-key-display`) is a genuine fix, not a symptom mask -- confirmed
`btn-generate`'s async handler literally ends with `router.navigate("room")`,
so the modal opening is the true terminal observable of that chain.

## Findings and resolutions

1. **CONFIRMED, ship-blocker**: a leftover `console.log("DEBUG onVisibilityChange...")`
   shipped in `app.js` -- would have logged the unlock state and pending
   route on every lock/unlock in production, visible to anyone with
   devtools open. **Fixed**: removed (was development-only tracing added
   while diagnosing an unrelated test race, missed during cleanup).
2. **CONFIRMED, real bug, most severe**: `onRestricted` opened the
   password modal unconditionally, including when the route was blocked
   purely by its own per-feature flag (GE2/GE3) while advanced mode was
   ALREADY unlocked. Reviewer reproduced via probe test: entering the
   (already-known-correct) master password there succeeds, but
   `onVisibilityChange` then re-navigates to the still-flag-disabled
   route, which is restricted again, re-opening the modal -- an infinite
   loop the correct password can never escape, only "Скасувати" does.
   **Fixed**: `onRestricted` now only sets `pendingRestrictedRoute` and
   opens the modal when `!isAdvancedModeUnlocked()` -- a flag-disabled
   route while unlocked keeps the original notice-only behavior (the
   password modal can never fix a per-feature flag). New regression test
   added.
3. **CONFIRMED (plausible-turned-real via regression test), low
   severity**: `openUnlockModal()` unconditionally cleared the password
   field, with no "already open" guard -- a second `onRestricted` while
   the modal is open (reachable via the browser Back button re-entering a
   restricted hash, since the restricted redirect pushes a new history
   entry) would wipe an in-progress password mid-typing. **Fixed**: added
   an idempotent `if (!modal.hidden) return;` guard. New regression test
   added (types a password, re-triggers `onRestricted` for the same
   route, confirms the typed value survives).

## Test-methodology note (not a source-code finding)

While writing the original two tests, a real race was found and fixed IN
THE TESTS themselves (not production code): `btn-generate`'s pre-existing,
unrelated click handler is async and ends with an unconditional
`router.navigate("room")` once identity generation settles. The original
tests waited only for `pub-key-display` (set several lines earlier in
that same async chain), leaving the trailing `navigate("room")` call
still in flight -- which could double-fire `onRestricted` later in the
test and produce a flaky/incorrect failure unrelated to the feature under
test. Fixed by waiting for the modal's own visibility (the true terminal
effect of that chain) instead.

Full suite green after all fixes: `app.test.js` targeted run 2/2 (new
finding-2 test) + 2/2 (new finding-3 test) + 2/2 (original two tests);
full suite 990/990 (the previously-flaky "ICE gathering timeout" test
passed this run too, confirmed unrelated).
