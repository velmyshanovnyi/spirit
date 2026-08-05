---
spec: granular-feature-flags
section: GE3
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/index.html
  - client/js/settingsPanelUI.js
  - client/js/app.js
  - client/js/i18n.js
  - client/tests/app.test.js
---

## Verdict: CONVERGED

Reviewer independently ran the full suite (414/414 green across
app.test.js, router.test.js, i18n.test.js, advancedMode.test.js) and
performed four real mutations, each caught by the new tests:
- Iterating `ADVANCED_FEATURES` instead of `TOGGLEABLE_FEATURE_KEYS` in the
  render function -> caught (row-set + no-`server` assertion).
- Deleting the `setFeatureEnabled(...)` call from the change handler ->
  caught.
- Ignoring `isFeatureEnabled` on render + skipping `resetFeatureFlags()` on
  reset -> both caught.
- Removing `renderFeatureFlagsSettings()` from app.js's `lang-select`
  handler -> caught.

Confirmed no self-lockout path exists (render only ever iterates
`TOGGLEABLE_FEATURE_KEYS`, `server` excluded there and hard-coded enabled in
`isFeatureEnabled`), no `data-feature-key`-style attribute collision with
any other live-DOM element (grep-verified), accessibility `<label>`
wrapping matches the established `renderFooterSettings` convention (the
same one added after `footer-customization-FC3-iter1.md` finding 4), all 11
locale translations present and ASCII-convention-consistent with neighboring
`footerSettings.*` keys, and language-switch re-render correctly re-reads
state from `isFeatureEnabled` (localStorage) rather than any stale
in-memory copy, so no toggle state can be lost or reset unexpectedly.

## Cosmetic notes applied (not blocking, but free to fix)

1. `client/index.html`'s pre-i18n inline fallback text for
   `featureFlags.hint` didn't byte-match the `uk` dictionary value (every
   other card's inline default matches its own `uk` string exactly).
   **Fixed**: aligned the inline text.
2. The checkbox and its containing row both carried the same
   `data-feature-key` attribute (row for the "no server" assertion, input
   for the change-handler's `closest()` lookup) -- harmless today since
   `change` events only ever originate from the checkbox, but a future row
   addition (e.g. a second control) could make `closest("[data-feature-key]")`
   ambiguously resolve to the row instead of the checkbox. **Fixed**:
   renamed the checkbox's attribute to `data-feature-toggle-key`, updated
   the event handler and all test selectors accordingly; the row itself
   keeps `data-feature-key` (used only for the "no server row exists"
   negative assertion and locating a row's label for i18n re-render checks).

Full suite re-run green after both fixes
(`client/tests/app.test.js -t "feature flags settings UI panel"`: 5/5).
No re-review requested -- both fixes were mechanical attribute
renames/text alignment, no logic changed.
