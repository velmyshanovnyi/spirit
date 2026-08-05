---
spec: design-edit-mode
section: RF22
iter: 2
agent: live browser verification (not a subagent review -- caught during
  post-deploy live checking on spirit.kolo.media, jsdom cannot exercise this)
files-reviewed:
  - client/css/style.css
---

## Verdict: CONVERGED (after fix)

## Finding: iter1's own fix selector was structurally backwards, matched nothing in a real browser

`client/css/style.css`, the `[data-screen="conversation"] .layout` rule
added in iter1 (`specs/reviews/design-edit-mode-RF22-iter1.md`) to fix
`.layout`'s hardcoded `max-width: 1100px` capping the conversation card.

**Root cause**: `.layout` (`<main class="layout">`, `client/index.html`)
is the PARENT of every `[data-screen]` section, including
`[data-screen="conversation"]` -- never its descendant. A descendant-combinator
selector `[data-screen="conversation"] .layout` can therefore never match
any real element; iter1's fix was a complete no-op in a live browser.

**Why jsdom's test suite never caught this**: `client/tests/designSettingsRegistry.test.js`'s
RF22 tests only assert `document.documentElement.style.getPropertyValue("--conversation-width")`
-- an INLINE style set directly by `applyDesignSettings()`, never routed
through the stylesheet's own selector matching at all. jsdom has no real
CSS cascade/layout engine, so there is no test in this project's suite
capable of catching "this selector structurally cannot match anything" --
this is a known, accepted gap (confirmed with the RF22-iter1 and RF23-iter1
reviewers: CSS-cascade correctness in this codebase is verified by LIVE
browser checking after deploy, not jsdom unit tests, same as RF17/RF18's
own exec-review notes ("жива перевірка на spirit.kibr.com.ua")).

**How it was actually caught**: post-deploy live verification on
`spirit.kolo.media` (fresh browser tab, service worker unregistered,
`cache:"no-store"` fetch confirming deployed file content) -- set
`conversationWidth` to 1500 via the real settings UI, navigated to
`#/conversation`, read `getComputedStyle(document.querySelector("main.layout")).maxWidth`
directly: returned `"1100px"` (the mutation), not `"1500px"` (the
requested value) -- proving iter1's `.layout` rule had zero live effect.

**Fix**: replaced the descendant selector with `:has()`, which correctly
expresses "the ANCESTOR .layout that currently contains a visible
conversation screen":
```css
.layout:has(> [data-screen="conversation"]:not([hidden])) {
  max-width: max(1100px, var(--conversation-width, 1100px));
}
```
Re-verified live on `spirit.kolo.media` after redeploying just
`client/css/style.css`: injecting the fresh stylesheet and re-reading
`getComputedStyle(...).maxWidth` on `main.layout` now correctly returns
`"1500px"` when `conversationWidth` is set to 1500, and resetting the
setting correctly returns it to the unaffected default. Deployed to both
`spirit.kibr.com.ua` and `spirit.kolo.media`.

No unit test added for this specific selector-matching behavior --
consistent with the project's existing convention (RF17/RF18/RF19's own
exec-review notes rely on live verification for the same class of "does
this CSS selector actually match the right element" claim, not jsdom).
