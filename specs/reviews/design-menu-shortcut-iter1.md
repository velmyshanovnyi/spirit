---
spec: (no formal spec file -- small-change carve-out, direct reaction to a
  user request; 3 files touched: index.html, app.js, app.test.js)
section: "Дизайн" settings-menu shortcut
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/index.html
  - client/js/app.js
  - client/tests/app.test.js
---

## Context

User request (2026-08-08): a direct "Дизайн" entry in the settings-menu
dropdown, one click away from the design-settings card -- previously only
reachable via "Сервер" then hunting/scrolling past several other cards
(admin/settings-registry/footer/feature-flags).

## Verdict: CONVERGED (after fixes below)

Reviewer confirmed the click-handler ordering is deterministic (router.js's
own listeners attach before this new one, same bubble phase, same
element -- attachment order determines execution order), `render()` is
fully synchronous so the target screen is genuinely visible before
`scrollIntoView` runs, `#design-settings-list` exists statically in
`index.html` at `initApp()` time, and the recent `preventDefault()`
router.js fix (specs/reviews/router-nav-preventDefault-iter1.md) doesn't
conflict (no `stopPropagation()` anywhere in the chain).

## Findings and resolutions

1. **CONFIRMED, real bug**: the shortcut originally reused
   `data-route="server"` so router.js's generic `navItems` loop would pick
   it up automatically -- but that loop marks EVERY `.nav-item[data-route]`
   matching the current route `aria-current="page"`, so clicking either
   "Сервер" or "Дизайн" would mark BOTH entries current simultaneously
   (both visually accented via `.nav-item[aria-current="page"]` CSS and
   announced twice to screen readers) -- the first time two nav items
   would ever share one route. **Fixed**: dropped `data-route` from the
   shortcut entirely (kept `href="#/server"` for right-click/keyboard/
   no-JS fallback); navigation is now handled by a dedicated, generic
   listener that parses the route from the link's own `href` and calls
   `router.navigate(route)` directly, with the same modifier-key guard as
   router.js's own handler (preserves Ctrl/Cmd/Shift-click "open in new
   tab").
2. **CONFIRMED, test hygiene**: `Element.prototype.scrollIntoView = vi.fn()`
   was a bare prototype assignment, never restored -- jsdom doesn't define
   `scrollIntoView` on `Element.prototype` at all (not even as
   `undefined`), so `vi.spyOn` couldn't be used directly either. Left
   unrestored, it would leak a mock into every later test in the file.
   **Fixed**: saved/restored the original (absent) value explicitly
   around the test body.
3. **CONFIRMED, scoping**: the `[data-scroll-target]` wiring loop
   originally lived inside `if (settingsToggle && settingsMenu) { ... }`,
   even though the selector is document-wide by design -- a future
   `[data-scroll-target]` element added outside the settings menu would
   silently lose its listener on any page/fixture lacking those two
   elements. **Fixed**: moved the loop outside that guard.
4. **Test-quality improvements** (reviewer's suggestions, applied): the
   test now also asserts exactly one nav item carries
   `aria-current="page"` after the click (pins finding 1's fix), that
   `[data-screen="server"].hidden === false` at the moment `scrollIntoView`
   is called (not just that the hash string changed), and that
   `scrollIntoView` was called with the exact expected arguments
   (`{ behavior: "smooth", block: "start" }`), not just "called at all".

Full suite re-run green (`app.test.js` -t "scrolls the design-settings
card": 1/1; full suite: 986/986). No re-review requested -- fixes were a
scoping change (drop `data-route`, add explicit navigate call with the
same guard already proven correct in router.js), a loop relocation, and
test hygiene, no new unreviewed logic surface.
