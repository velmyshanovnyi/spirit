---
spec: footer-customization
section: FC1
iter: 1
agent: opus (general-purpose, no isolation, resumed once via SendMessage for full finding detail)
files-reviewed:
  - client/js/footerRegistry.js
  - client/tests/footerRegistry.test.js
---

## Findings (4, all CONFIRMED by probe/mutation testing, all fixed)

1. **`addCustomBlock` returned an id even when persistence failed.**
   `writeJSON` is best-effort (swallows quota errors); the caller couldn't
   tell "created" from "nothing was saved" -- reproduced with
   `Storage.prototype.setItem` mocked to throw `QuotaExceededError`: a
   real id was returned while `listCustomBlocks()` stayed empty. Quota is
   genuinely reachable here specifically -- the spec explicitly declines
   any size/count limit on custom HTML. **Fixed**: `writeJSON` now returns
   a boolean; `addCustomBlock` returns `null` on write failure instead of
   a phantom id. New regression test.

2. **Test coverage gap, not a code bug**: the existing "drops entries for
   a deleted custom block" test routed deletion through
   `removeCustomBlock()`, which itself already strips the stale order
   entry -- so `getFooterOrder()`'s OWN reconciliation filter (the thing
   under test) was never actually exercised. Mutation-verified: deleting
   the filter line entirely still left the whole suite green. **Fixed**:
   new test writes a "ghost" order entry directly into storage that
   nothing else ever cleans up, so only `getFooterOrder()`'s own
   filtering can be responsible for it disappearing.

3. **`listCustomBlocks()` could return a non-array and crash every
   caller.** `readJSON`'s try/catch only guarded PARSE failures --
   `localStorage['...customBlocks'] = "null"` parses successfully to
   `null`, sailing past the `[]` fallback; `getFooterOrder()` then threw
   on `.map()`, `addCustomBlock()` threw on `.push()`. Would have been an
   uncaught app-init throw once FC2 wires `applyFooterSettings` into
   `app.js`. **Fixed**: `readJSON` now takes an explicit shape validator
   (`Array.isArray`/`isPlainObject`) so "wrong shape" is treated the same
   as "parse error" -- both fall back safely. `listCustomBlocks()`
   additionally filters out individual malformed entries (missing/
   non-string `id`) so one corrupt array element doesn't take down every
   caller that keys blocks by id.

4. **`isFooterItemVisible`/`setFooterItemVisible` threw on the same root
   cause as #3** (`"null"` parsing successfully, `{}` fallback never
   reached). **Fixed** the same way, via the shared `readJSON` shape-
   validator parameter.

## Explicitly checked, clean (not re-litigated)

- The `addCustomBlock` double-append fix I made myself before requesting
  review (`setFooterOrder(getFooterOrder())` instead of a manual
  `order.push()`) -- independently probe-verified: three consecutive
  `addCustomBlock()` calls produce zero duplicate order entries, in
  creation order, preserving a prior manual reorder.
- `resetFooterSettings` -- mutation-verified to leave custom block
  content untouched (adding a `removeItem` for the custom-blocks key
  fails the existing test).
- `moveFooterEntry` -- mutation-verified swap-direction and index guards;
  degrades sanely (no throw) against a duplicate-containing order, though
  duplicates cannot arise via any module API today.

## Convergence

CONVERGED after 1 iteration. 21/21 tests green (17 original + 4 new
regression tests for the findings above).
