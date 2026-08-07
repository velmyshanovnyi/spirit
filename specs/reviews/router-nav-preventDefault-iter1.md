---
spec: (no formal spec file -- small-change carve-out, <3 files, direct
  reaction to a user-reported bug)
section: router.js nav-item click preventDefault
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/router.js
  - client/tests/router.test.js
  - client/js/app.js (checked for a duplicate .nav-item listener)
---

## Context

User reported (screenshot, 2026-08-08): clicking a settings-menu item
(e.g. "Кімната") sometimes appeared to do nothing. Nav items are real
`<a href="#/...">` elements that carry BOTH the browser's native anchor
default action AND a JS click listener calling `navigate()` -- without
`event.preventDefault()`, both fire on the same click.

## Verdict: CONVERGED (after fix)

## Findings and resolutions

1. **CONFIRMED, regression**: the first version of the fix called
   `event.preventDefault()` unconditionally, breaking the standard
   Ctrl/Cmd-click ("open in new tab") and Shift-click ("open in new
   window") affordances real anchors exist to provide -- directly
   contradicting the fix's own comment about preserving
   "middle-click-open-in-new-tab" (middle-click itself, via `auxclick`,
   was genuinely unaffected; modifier-clicks on the *primary* button were
   not). **Fixed**: added a bail-out (`event.button !== 0 || metaKey ||
   ctrlKey || shiftKey || altKey`) before `preventDefault()`, restoring
   the exact capability the comment claimed to preserve. New regression
   test added.
2. **CONFIRMED, comment accuracy**: the original comment claimed the
   native default action "sets location.hash again" as the harmful
   effect -- on the COMMON path this is a no-op (same-hash anchor click),
   not a real double-render. **Fixed**: reworded to describe the actual
   mechanism -- the double-fire only matters on a RESTRICTED route (SM3's
   gate), where `navigate()`'s own redirect changes the hash to something
   DIFFERENT from the link's href, so the native default action fires a
   second, genuinely different navigation, double-showing the "розділ
   вимкнено" notice and leaving a junk back-button history entry.
3. **Test coverage gap identified and closed**: the original single test
   only asserted `defaultPrevented === true`, a pure implementation
   restatement that couldn't distinguish "fixed" from "broken but still
   happens to pass" for the actual failure mode. **Fixed**: added a test
   that exercises the real restricted-route double-fire scenario
   (`onRestricted` called exactly once, not twice) plus the
   modifier-click preservation test from finding 1.
4. **No duplicate navigation listener found** in `app.js` -- the only
   other `.nav-item`-scoped listener (`settingsMenu`'s own click handler)
   closes the dropdown and never navigates. `preventDefault()` is also
   harmless for the `<button data-route="manage">` elements (not real
   anchors, no default action to prevent).

## Honest uncertainty (per reviewer, preserved rather than overstated)

This fix closes a REAL defect (finding 2/3's restricted-route
double-notice), but the reviewer explicitly could not confirm it's THE
mechanism behind the user's report, since live coordinate-based click
testing was blocked mid-session (Browser pane became unavailable for
screenshots/real clicks) before the exact failure could be reproduced.
The reviewer's own best hypothesis, offered honestly rather than as
confirmed fact: "Кімната" is an advanced/restricted route
(`ADVANCED_ROUTES` in `app.js`) -- if advanced mode was locked or the
per-feature flag was off at the moment of the user's click, the item
correctly bounced back to `#/conversation` with a transient notice the
user may not have consciously registered, which looks indistinguishable
from "clicking did nothing" from the user's seat. This fix is a genuine,
independently-justified correctness improvement either way (eliminates a
real double-fire class of bug), not a confirmed root-cause fix for the
exact report -- worth telling the user plainly rather than claiming more
certainty than the investigation actually supports.

Full suite green after fixes: `router.test.js` 21/21; full suite 985/985.
