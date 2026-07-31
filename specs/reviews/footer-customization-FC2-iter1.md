---
spec: footer-customization
section: FC2
iter: 1
agent: opus (general-purpose, no isolation)
files-reviewed:
  - client/js/footerRegistry.js (applyFooterSettings + helpers)
  - client/js/app.js (new import + call site)
  - client/tests/app.test.js (new describe block + footer-fixture fix)
---

## Findings (5, all CONFIRMED)

1. **CRITICAL, self-lockout.** Hiding `advancedToggle` via its normal
   visibility toggle actually hid the footer's "Розширений режим"
   button -- the ONLY UI path back into the full app once locked
   (`client/index.html:630-635`'s own comment: "always visible in the
   footer regardless of mode"). Hide it, then lock: `.settings-wrap` is
   also hidden, `server` is a restricted route -- zero UI recovery path
   short of editing `localStorage` by hand. **Fixed**: `advancedToggle`
   is now excluded from the `hidden` assignment entirely (order-only,
   never hideable) -- matches the same "excluded from the advanced
   bucket" precedent already established for call/camera/mic controls in
   SM2/SM3. New regression test.

2. **Real bug.** `if (node.innerHTML !== block.html)` compared against
   the browser's re-serialized, normalized DOM (e.g. `'` becomes `"`,
   attribute order/spacing can change) rather than the actual source
   string that was assigned -- a block whose STORED html hadn't changed
   at all could still fail this comparison on literally every render,
   destroying and rebuilding its subtree and losing any live state
   inside it (in-progress form input, focus, a running video). Reviewer
   reproduced concretely with `<input type='text' ...>` (single-quoted
   attribute): focused, typed into it, re-rendered with the SAME stored
   source -- value and focus were both lost. **Fixed**: track the
   last-assigned SOURCE string as a plain JS property on the node
   (`node.__footerBlockSource`, not a DOM attribute -- avoids any
   HTML-attribute-encoding/size concerns for arbitrarily large custom
   HTML) instead of comparing against `.innerHTML`. New regression test.

3. **Test-quality gap, not a code bug.** The original "removes a custom
   block's DOM node" test reset `document.body.innerHTML = HTML` before
   re-init, so the footer started with ZERO custom-block nodes -- the
   actual sweep-removal loop in `applyFooterSettings` was never
   exercised (mutation-verified: no-op'ing the sweep body left the whole
   suite green). The real FC3 delete-button path calls
   `applyFooterSettings` again on the SAME live DOM, no reload. **Fixed**:
   rewrote the test to call `removeCustomBlock` + `applyFooterSettings`
   directly without touching `document.body.innerHTML`.

4. **Test-quality gap.** The "positions a custom block's CSS order" test
   always placed the custom block FIRST (order `"0"`), so a hardcoded
   `node.style.order = "0"` implementation would have passed it
   (mutation-verified). **Fixed**: rewrote to place the block third in a
   5+-item order and assert `"2"`.

5. **Minor hardening (low priority, self-inflicted-only).** Both the
   custom-block lookup and the deleted-block sweep used a plain
   `[data-footer-block-id=...]` selector with no scope restriction -- a
   custom block's OWN user-authored HTML could in principle contain an
   element carrying a same-shaped attribute, and it would be
   indistinguishable from a real registry-managed node. Consistent with
   this feature's already-accepted trust model (a user can only affect
   their own footer), but cheap to exclude. **Fixed**: both selectors now
   use `:scope > [data-footer-block-id=...]`, restricting the match to
   direct children of `#app-footer`.

## Explicitly checked, clean (not re-litigated)

- `cssEscape`/`CSS.escape`: `randomBlockId()` only ever produces
  `[0-9a-zA-Z-]` characters (verified) -- neither branch is load-bearing
  today, purely defensive, harmless. (Noted: jsdom lacks `CSS`, so tests
  only exercise the manual fallback while real browsers only exercise
  `CSS.escape` -- neither path is covered where it actually runs; not
  filed as this iteration's job, no functional risk found.)
- DOM node identity across re-renders: the `data-footer-block-id` lookup
  correctly reuses the existing container node -- finding 2's state loss
  happened INSIDE the reused node's subtree (from the innerHTML
  reassignment), not from destroying/recreating the container itself.
- No order/hidden conflict with `headerControlsOrder` (design settings)
  or `advancedModeUI.js` -- neither touches any footer-item selector;
  `advancedModeUI.js` only sets `#footer-advanced-toggle`'s `textContent`.
  Call ordering in `app.js` (`applyFooterSettings` right after
  `applyDesignSettings`, before `applyTranslations`) is safe.
- `[hidden]` correctly wins over any footer CSS -- no `display` override
  set on `.footer-link`/`.footer-version`/`.footer-advanced-toggle`.

## Convergence

CONVERGED after 1 iteration. 926/926 tests green (1 pre-existing,
order-dependent flaky test documented in prior review artifacts in this
same directory, unrelated to this diff, not observed this run).
