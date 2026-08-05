---
spec: granular-feature-flags
section: GE2
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/router.js
  - client/js/app.js
  - client/tests/router.test.js
  - client/tests/app.test.js
---

## Verdict: CONVERGED (after fix below)

Reviewer independently ran the full suite (382/382 green) and mutation-tested
both halves of the wiring:
- Dropping the `isFeatureEnabled` disjunct from `app.js`'s `isRestricted`
  broke the new app.test.js integration test.
- Reverting `router.js`'s `isRestricted()` call back to zero-arg broke both
  the new router.test.js test and one app.test.js test.

Both confirm the new tests genuinely pin the wiring, not vacuous passers.
Truth table for `!isAdvancedModeUnlocked() || !isFeatureEnabled(route)`
verified correct for all four (locked/unlocked) x (flag true/false)
combinations. `server` self-lockout guard confirmed intact end-to-end (only
consumer of `isFeatureEnabled` is this one call site; `server` can still be
restricted via the master lock, which is the intended sole remaining path).
Nav-item visibility logic confirmed untouched and still independent of
`restrictedRoutes`, consistent with the 2026-07-31 UX decision.

## Finding and resolution

1. **Misleading notice copy for the new partial-restriction case**: the
   `footer.advancedModeRestricted` toast text ("This section is hidden in
   simplified mode." / uk: "Цей розділ прихований у спрощеному режимі.")
   is shown for BOTH the full master-lock case (accurate) and the new
   per-feature-flag case (inaccurate -- a user who unlocked advanced mode
   and then toggled off one section is not "in simplified mode", and the
   text implies the (already-unlocked) footer toggle would help, which it
   won't for this case). **Fixed**: reworded the key to be mode-neutral
   ("This section is disabled." / uk: "Цей розділ вимкнено.") across all 11
   locales in `client/js/i18n.js`, respecting each locale's existing
   accent/ASCII-transliteration convention (verified against neighboring
   already-shipped `footer.advancedMode*` keys before writing each).
   Confirmed no test hardcodes the old string (`grep` across
   `client/tests/`).

No re-review requested: the fix was a copy-only change (no logic touched),
already covered by the existing "shows a notice" assertions that check
`.textContent.length > 0`, not exact text.
