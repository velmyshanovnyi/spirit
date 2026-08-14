---
spec: docs/backlog.md (A2, A3, partially A7)
section: A2+A3 -- onRestricted must distinguish user intent
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/router.js
  - client/js/app.js
  - client/tests/router.test.js
  - client/tests/app.test.js
---

## Context

`onRestricted` is a RENDER-level hook, so it fired identically whether the
user clicked a nav item, the app navigated itself, or a re-render was
triggered by locking advanced mode. Two regressions followed:

- **A2**: `postIdentityRoute()` returns `"room"`/`"profile"` — both advanced
  routes — and is navigated to after portable-account login, recovery
  restore, profile unlock and backup-skip. A locked user completing any of
  those got an admin-password modal they never asked for.
- **A3**: locking dispatched a synthetic `hashchange`, which re-rendered the
  now-restricted current route and re-opened the modal; because
  `pendingRestrictedRoute` was recorded during that lock, typing the
  password sent the user back to the screen they had just locked. The lock
  both prompted for a password and undid itself.

Fix: `router.js` tracks navigation origin and reports
`onRestricted(route, { userInitiated })`; `app.js` only offers the password
prompt when `userInitiated`.

## Verdict: CONVERGED (after fixes)

Reviewer mutation-tested four mutants: dropping `&& userInitiated`
(A2+A3 tests red), dropping `{ userInitiated: true }` from the nav-item
click (4 tests red), dropping it from the "Дизайн" shortcut (guard test
red) — all killed. It also classified **every** `router.navigate(` call
site in `client/js/` as click-driven vs programmatic and confirmed no
click path silently lost its prompt.

Notable side effect the reviewer surfaced: `deviceLinkingUI.js` navigates
to `"profile"` on an incoming `device-link-grant` message — a second, live
instance of A2 that this fix closes as well.

## Findings and resolutions

1. **CONFIRMED, real UX regression (finding 2)**: treating *every*
   `hashchange` as programmatic silently dropped the password prompt for
   Back/Forward, an edited address bar, a bookmarked or shared deep link,
   and session restore — i.e. for precisely the user this feature was built
   for ("як користувач з правами зможе просто потрапити в це меню?"). The
   reviewer verified the modal no longer opened on that path, where it did
   before the diff. **Fixed**: the hashchange listener now derives intent
   from `event.isTrusted` — a real browser-generated hashchange is a user
   action, while the synthetic `new Event("hashchange")` that `app.js`
   dispatches after locking is not (which is what keeps A3 fixed). New
   router test drives the registered listener with both shapes, since jsdom
   cannot construct a trusted event.
2. **CONFIRMED at review time, then superseded (finding 1)**: the reviewer
   showed a mutant deleting `navigate()`'s `finally` reset survived the
   whole suite, and that the A3 test reached `#/server` by assigning the
   hash rather than clicking. **Both addressed, with an honest correction**:
   the A3 test now clicks a real nav item (more faithful regardless), but
   re-running that mutation afterwards showed it *still* survives — and that
   is now correct rather than a test gap. The finding-2 fix made the
   hashchange listener assign the flag on every entry, so all three
   `render()` entry points (`navigate`, the listener, the init-time call)
   assign before reading; no stale value is reachable. Verified by reading
   every `render()` call site rather than assuming. The `finally` is kept as
   defense-in-depth and its comment now says so instead of claiming a
   guarantee it no longer provides.
3. **Applied, zero cost**: three pre-existing tests updated from
   `expect.any(Object)` to `expect.objectContaining({ userInitiated: false })`,
   and `let navigationWasUserInitiated` moved above `render()` (its only
   reader) to remove a latent temporal-dead-zone trap.

## A7 status

Three tests that drove the feature through `#btn-generate` — a button that
does **not** exist in `client/index.html` (only `#btn-generate-proof` does)
and which `app.js` documents as superseded test-fixture boilerplate — were
rewritten to dispatch a genuine `MouseEvent` on a real `.nav-item`. That
gap is exactly where the A2/A3 regressions hid.

A7 is **not** fully closed: the new A2 test deliberately still uses
`#btn-generate` as a stand-in for programmatic navigation (with a comment
saying so), and other suites continue to use it as identity-setup
boilerplate. Left open in the backlog.

## Suite

`router.test.js` 25/25 · `app.test.js -t "advanced mode"` 19/19 · full
suite **1000/1000**.
