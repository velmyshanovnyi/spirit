---
spec: design-edit-mode
section: RF22
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/designSettingsRegistry.js
  - client/css/style.css
  - client/js/i18n.js
  - client/tests/designSettingsRegistry.test.js
---

## Verdict: CONVERGED (after fix below)

Reviewer confirmed the new CSS selector `[data-screen="conversation"] .card-wide`
correctly scopes to ONLY the conversation screen (the other three
`.card-wide` occurrences in `client/index.html` live under `manage`/
`history`, unaffected); no cascade conflict with the existing
`@media (min-width:768px) { .card-wide { grid-column: 1/-1; } }` rule
(disjoint properties); default (`1100px` CSS-var fallback) is a true no-op
for anyone who never touches the setting; all 11 i18n locales present,
correct key parity, no stray Cyrillic in Latin-script locales.

## Finding and resolution

1. **CONFIRMED, functional**: the first version only widened `.card-wide`
   itself, but `.layout`'s own hardcoded `max-width: 1100px` (with 24px
   padding each side at desktop) still capped the actual available box at
   ~1052px -- every registry value above that (up to the registered max of
   1600) was silently inert; the setting could only ever narrow the card,
   never widen it, which is the opposite of a width control's usual
   purpose. **Fixed**: `[data-screen="conversation"] .layout` now uses
   `max-width: max(1100px, var(--conversation-width, 1100px))` --
   `max()` never shrinks it below the original 1100px hardcode (so every
   OTHER screen sharing `.layout`, and this screen when the setting is at
   or below default, are unaffected), but grows it when the setting is
   raised above default. Still bounded further out by `.app-body`'s own
   `--content-max-width` (1400px default) -- an expected nested-constraint
   interaction, the same shape `sidebarWidth`/`contentMaxWidth` already
   have, not a new bug class.
2. Corrected two comments (`designSettingsRegistry.js`,
   `designSettingsRegistry.test.js`) that described the var as "replacing"
   `.layout`'s hardcode -- it didn't (until the fix above), and the
   inaccurate comment is exactly what let the gap go unnoticed. Reworded
   to describe the actual two-selector mechanism.

Full suite re-run green (`designSettingsRegistry.test.js` + `i18n.test.js`:
45/45). No re-review requested -- the fix is a CSS-only addition (`max()`
on an existing, already-tested selector), no new JS logic surface.
