---
spec: design-edit-mode
section: RF23
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/designSettingsRegistry.js
  - client/css/style.css
  - client/js/i18n.js
  - client/tests/designSettingsRegistry.test.js
---

## Verdict: CONVERGED (after fixes below)

Reviewer confirmed CSS cascade correctness (all 5 non-default override
rules have strictly higher specificity than the base rule and appear later
in source order; each explicitly resets every base property it needs to,
verified property-by-property); confirmed the 6th option (bottom-center)
correctly needs no override rule by construction (`applyDesignSettings`
either deletes the dataset attribute or sets the literal chosen value, no
partial-reset hazard); confirmed i18n coverage complete and ASCII-clean
across all 11 locales except two real typos (below).

## Findings and resolutions

1. **CONFIRMED, correctness**: `settingsPanelUI.js`'s `renderDesignSettings`
   highlights `options[0]` as the active chip when nothing is stored
   (`stored ?? entry.options[0]`) -- an invariant every prior choice
   setting (`sidebarSide`/`toolbarSide`, both `["left","right"]`) trivially
   satisfied since their CSS default IS their first option. `noticePosition`
   broke it: `options` listed `"top-left"` first, but the CSS's
   unconditional base rule is bottom-center. A fresh user would see "Top
   left" highlighted as active while the toast actually renders
   bottom-center, and clicking the falsely-highlighted chip would silently
   change the real position. **Fixed**: reordered `options` so
   `"bottom-center"` is first, matching the documented UI invariant.
   Also added the missing regression test the reviewer flagged was absent
   (`app.test.js`, "Section RF23: highlights bottom-center as the active
   notice-position chip by default...") -- the existing RF17/RF18 tests
   covered this exact class of bug for their own settings but nothing
   covered `noticePosition`.
2. **CONFIRMED, i18n**: Latvian used `Parinojuma`/`parinojums` (not a real
   Latvian word) instead of `Pazinojuma`/`pazinojums` ("notification") --
   a `z`→`r` typo, inconsistent with the same file's own already-shipped
   `Pazinojumi`/`pazinojuma` at the `settings.category.notifications`/push
   keys. **Fixed**: corrected both occurrences.
3. **Minor, applied**: `.choice-toggle` had no `flex-wrap`, authored for
   2-chip rows -- `noticePosition`'s 6 chips (some with long labels, e.g.
   Italian "In alto a sinistra") would cram onto one line. **Fixed**: added
   `flex-wrap: wrap`.

Full suite re-run green (`app.test.js` + `designSettingsRegistry.test.js` +
`i18n.test.js`: 421/421, including the previously-flaky ICE-timing test
passing this run). No re-review requested -- the options-order fix and its
new regression test were exactly what the reviewer verified would catch
the bug; the i18n and CSS fixes are non-logic changes.
