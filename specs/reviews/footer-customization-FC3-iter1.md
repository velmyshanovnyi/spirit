---
spec: footer-customization
section: FC3
iter: 1
agent: opus (general-purpose, no isolation)
files-reviewed:
  - client/js/settingsPanelUI.js (renderFooterSettings + event handlers)
  - client/js/app.js (lang-select handler addition)
  - client/index.html (new card markup)
  - client/tests/app.test.js (new describe block + fixture additions)
  - client/js/i18n.js (13 new keys × 11 locales, spot-checked)
---

## Findings (4, all CONFIRMED)

1. **Test-quality gap, mutation-verified.** The "moving a fixed item
   up/down" test only asserted against `getFooterOrder()` (stored data),
   never against the LIVE footer DOM's CSS `order` -- deleting the
   `applyFooterSettings(doc)` call inside the reorder click handler still
   left the whole suite green, meaning ▲/▼ could silently stop updating
   the live footer (requiring a reload) with zero test signal. Also only
   the "down" direction was exercised. **Fixed**: split into two tests,
   each asserting BOTH the stored order AND the corresponding footer
   item's `style.order`; both directions now covered.

2. **Test-quality gap, mutation-verified.** The "renders one row per
   fixed item plus one per custom block" test only checked row COUNT and
   that some row had a textarea -- rewriting `renderFooterSettings` to
   emit fixed rows in registry order (ignoring the real saved order)
   while placing the custom row at its correct stored index still passed
   16/16. **Fixed**: now asserts `rows.map(r => r.dataset.footerOrderEntry)`
   equals the exact saved order array.

3. **Real correctness gap.** `addCustomBlock()`'s return value was
   discarded in the `btn-add-footer-custom-block` click handler --
   FC1 exec review specifically introduced the `null`-on-failure return
   so callers could detect a failed write (storage quota, reachable by
   design since custom HTML has no size limit), but FC3 never checked
   it. No phantom row was produced (the failure happens before
   `setFooterOrder`), but the button became a permanently silent dead
   button on failure with zero user feedback. **Fixed**: new
   `#footer-settings-status` element (`index.html`, `footerSettings.
   addBlockFailed` key in all 11 locales); the handler now checks for
   `null` and shows an error instead of proceeding. New regression test
   mocks `Storage.prototype.setItem` to throw and confirms nothing is
   added and the status message appears.

4. **Accessibility gap.** The visibility checkbox and the custom-block
   textarea were rendered as bare `<input>`/`<textarea>` siblings of a
   `<span>`, not wrapped in a `<label>` -- unlike every other settings
   row in this same file (`renderSettingsRegistry`/`renderDesignSettings`
   both use the `<label class="field"><span>...</span><input></label>`
   pattern). No accessible name for screen readers; clicking the visible
   item text didn't toggle the control, inconsistent with the rest of
   the panel. **Fixed**: both now wrapped in a real `<label class="field">`.
   New regression test confirms `.closest("label")` resolves for both.

## Explicitly checked, clean (not re-litigated)

- **The `data-footer-block-id` attribute-name collision** between the
  settings-panel textarea and the live footer's custom-block `<div>`
  (discovered and worked around in test queries during this same
  implementation pass) is confirmed TEST-ONLY -- grepped every
  production consumer: `footerRegistry.js`'s `applyFooterSettings`
  scopes with `:scope > [data-footer-block-id=...]` (FC2 finding 5's
  fix), and `settingsPanelUI.js`'s event delegation uses `closest()`
  from within a listener already scoped to `#footer-settings-list`.
  Neither can ever see the other's nodes, including with both the panel
  and the footer simultaneously live on the real `server` screen.
- `doc.defaultView.confirm(...)` for the remove-block confirmation --
  correct choice; decline path traced to return BEFORE any state change
  (no removal, no re-render) on either the panel row or the footer node.
- Change-event delegation (`[data-footer-item-key]` vs
  `[data-footer-block-id]`) cannot cross-fire -- neither is an ancestor
  of the other, and the row itself carries a third, distinct attribute
  (`data-footer-order-entry`).
- `advancedToggle` structurally has no checkbox element at all (not
  hidden via CSS) -- re-verified directly in the conditional, not just
  via the pre-existing test. FC2's lockout class of bug is not
  reintroduced.
- Reset button traced end-to-end again given FC3's new call site --
  `resetFooterSettings()` never touches `spirit.footer.customBlocks`;
  content is preserved.
- i18n: 13 keys × 11 locales, spot-checked de/es/it/lt/lv/et/no --
  no corruption, consistent with the established ASCII-transliteration
  convention for this settings-panel-adjacent block.

## Convergence

CONVERGED after 1 iteration. 938/938 tests green (19 in the combined
FC2+FC3 footer-settings block: 7 FC2 + 12 FC3 -- 9 original + 3 new for
this iteration's findings).
