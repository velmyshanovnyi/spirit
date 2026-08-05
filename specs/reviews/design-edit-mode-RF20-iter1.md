---
spec: design-edit-mode
section: RF20
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/app.js
  - client/index.html
  - client/js/i18n.js
  - client/tests/app.test.js
---

## Verdict: CONVERGED (after fix below)

Reviewer confirmed the RF4 floating-video init refactor (extracting
`computeDefaultRect`/`applyRect`) is behavior-preserving (double-clamp is a
verified no-op, identical default rect computed both before and after),
listener wiring matches the project's existing per-`initApp` re-binding
pattern, and i18n coverage is complete for all 11 locales.

## Findings and resolutions

1. **CONFIRMED, correctness**: the `if (!panel.hidden)` guard around
   `applyRect(computeDefaultRect())` made the reset silently do nothing
   until the next page reload in EVERY real usage -- `#btn-reset-floating-video`
   lives on the "server" screen, and the panel is only ever un-hidden on
   `#/conversation` (`setConversationChromeVisible`). `loadFloatingVideoRect()`
   is only ever called once, at `initApp()` time, so nothing re-reads
   storage on a later route change; a user who reset while on settings
   would return to a still-dragged-position panel for the rest of the
   session. **Fixed**: removed the guard, apply unconditionally -- the
   panel's inline styles are already correct by the time it's next
   revealed, no reload needed.
2. **CONFIRMED, test-coverage**: the second test only asserted
   `not.toThrow()` + storage cleared, both of which passed even WITH the
   guard bug present (mutation-verified) -- nothing distinguished
   guard-present from guard-absent. **Fixed**: rewrote to assert the
   panel's actual inline styles change (`left` no longer the stale saved
   value, `width`/`height` back to computed defaults) while still hidden.
3. **PLAUSIBLE, comment accuracy (nit)**: a comment claimed
   `resetFloatingVideoRect` was "hoisted" -- it's a `let`-bound arrow
   function (TDZ, not function-declaration hoisting); the code is correct
   regardless (click handler runs well after init), but the comment
   implied semantics that don't apply. **Fixed**: reworded to describe the
   actual reassignment mechanism instead.

Full suite re-run green after fixes (`app.test.js -t "Скинути позицію"`:
2/2; full `app.test.js`: 371/371 excluding the pre-existing, unrelated
"ICE gathering timeout" flake, confirmed passing in isolation). No
re-review requested -- fixes were a guard removal (mutation-tested by the
reviewer as producing correct, green behavior) and a test/comment
strengthening, no new logic surface introduced.
