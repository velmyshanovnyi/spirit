---
spec: simplified-ephemeral-mode
section: SM2+SM3
iter: 2
agent: opus (general-purpose, no isolation -- read/ran directly against the
  uncommitted working tree at C:\claude\spirit; iter1's worktree-isolated
  agent had manually worked around isolation by copying files in, this pass
  used no isolation from the start to avoid that friction)
files-reviewed:
  - client/js/router.js
  - client/js/advancedModeUI.js
  - client/js/app.js
  - client/tests/router.test.js
  - client/tests/app.test.js
---

Confirmatory pass over the 4 fixes from iter1. Explicitly instructed NOT
to re-litigate iter1 finding 2 (dismissed with evidence, settled).

## Verification results

**Finding 1 (locking left the current screen visible) -- HOLDS.** Traced
`ADVANCED_ROUTES` = `profile, server, room, manage, history` against the
hashchange-dispatch fix: `#/manage` and `#/history` are in BOTH
`GATED_ROUTES` and `ADVANCED_ROUTES` -- identity gate passes (user on
that screen has identity), restricted gate then redirects to
`conversation`, itself identity-gated but satisfied, settles in 2 hops.
Covers every route, not just the one the iter1 regression test happened
to check.

**Finding 3 (redirect cycle hop counter) -- DID NOT FULLY HOLD, new bug
found and fixed (see below).**

**Finding 4 (password lingering) -- HOLDS.** Grepped for every possible
modal-close mechanism in `client/js/` (`.modal-overlay` click-outside,
`Escape` key) -- neither exists anywhere in this codebase, so the cancel
button and unlock-success handler are genuinely the ONLY two exits, and
both clear the field. In-flight-cancel (password typed, cancel clicked
before the async `unlockAdvancedMode` resolves) is not a lingering-DOM
issue: cancel clears immediately; if the request later resolves
successfully anyway, the success handler re-clears (harmlessly, field
already empty). Noted as a cosmetic (not security, per the spec's own
framing) non-issue: cancelling mid-flight doesn't abort the in-flight
request, so a correct password typed-then-cancelled still unlocks. No
action needed -- consistent with "locking/unlocking is a UI-cleanliness
action, not a security boundary" already established in SM1.

**Finding 5 (label re-translation) -- HOLDS.** `refreshToggleLabel`
closes over the live `t` passed into `initAdvancedModeUI`; `i18n.js`'s
`t()` reads current locale state on every call, confirmed by the
regression test asserting three different label values across two
switches and both lock states. A locale switch while the modal is open
is a non-scenario in production (the modal only opens while locked, and
while locked `.settings-wrap` -- which contains `lang-select` -- is
itself hidden), so this was correctly not pursued as a gap.

## New finding: the finding-3 fix was incomplete

`client/js/router.js` (before this iteration's fix) registered
`win.addEventListener("hashchange", render)` -- `render` DIRECTLY as the
listener. The browser passes an `Event` object as the listener's first
argument on every event-driven call, and that first argument IS
`render`'s `hopCount` parameter (added by the finding-3 fix).
`Event > MAX_REDIRECT_HOPS` is always `false`, and `hopCount + 1`
string-concatenates onto the Event's string form (`"[object Event]1"`,
etc.) rather than incrementing numerically -- so the hop-counter guard
silently never tripped on the ONE path (real, user-driven navigation via
hashchange) it most needed to cover. Only the init-time `render()` call
and `navigate()`'s `render()` call (both invoked with zero arguments,
correctly defaulting `hopCount` to `0`) were ever actually protected.
Verified empirically: the same cyclic config as the iter1 regression
test, entered via the listener instead of via `initRouter`'s own
init-time `render()`, hung indefinitely (killed at 120s) rather than
throwing -- the iter1 regression test only exercised the protected
init-time path and passed despite this gap.

**Fixed**: the listener is now a wrapping arrow function
(`() => render()`), so `hopCount` always starts at its real default
regardless of caller. New regression test in `router.test.js` captures
the ACTUAL registered listener function (via `vi.spyOn(window,
"addEventListener")`) and calls it directly with a real `Event` argument
-- exactly what the browser does -- confirming it throws.
(`dispatchEvent()` itself does not propagate a listener's synchronous
throw back to the caller, in jsdom or real browsers -- it surfaces as an
uncaught exception instead -- so the test intentionally does not rely on
`dispatchEvent`'s return value or `expect(...).toThrow()` around it.)

## Sizing check (requested, not a defect)

`MAX_REDIRECT_HOPS = 10` is amply generous for legitimate (non-cyclic)
use: `app.js`'s real `initRouter` call passes exactly 2 gates
(`gatedRoutes`, `restrictedRoutes`), so the longest legitimate cascade is
2 hops. No currently-existing chain in this codebase approaches 10.

## Full suite

897/898 across two independent full-suite runs -- the one non-passing
result both times was the SAME pre-existing "ICE gathering timeout"
test (`client/tests/app.test.js`), which passes standalone and is a
known test-isolation/timer-leak flake pre-dating this diff (also
observed and documented earlier in this same session for an unrelated
PoW timing test) -- unrelated to `router.js`/`advancedModeUI.js`/`app.js`.

## Convergence

**CONVERGED after 2 iterations.** One fix (finding 3) required a
follow-up fix within this same iteration; re-verified after the
follow-up and confirmed holding. No new findings beyond that one.
