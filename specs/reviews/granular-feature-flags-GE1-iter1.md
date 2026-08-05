---
spec: granular-feature-flags
section: GE1
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/advancedMode.js
  - client/tests/advancedMode.test.js
  - specs/ui/granular-feature-flags.md
---

## Verdict: CONVERGED (after fixes below)

Core GE1 registry logic (`ADVANCED_FEATURES`, `TOGGLEABLE_FEATURE_KEYS`,
`isFeatureEnabled`, `setFeatureEnabled`, `resetFeatureFlags`) was found
correct against the spec's design intent: matches `ADVANCED_ROUTES`, `server`
un-disableable on both read and write paths, fail-open-to-"enabled" on
missing/malformed/throwing storage, consistent with `footerRegistry.js`'s
established pattern.

## Findings and resolutions

1. **Spec-mismatch (process, most severe)**: GE2/GE3 checkboxes (Tests/Impl/
   Exec review) were ticked `[x]` in the initial spec draft despite no code
   for either section existing yet -- would have misled the next reader of
   `specs/` (this project's Claude Country coordination channel) into
   thinking the whole feature shipped. **Fixed**: un-ticked GE2/GE3's six
   checkboxes back to `[ ]`; corrected the now-inaccurate "done" note this
   same edit had added to `specs/ui/simplified-ephemeral-mode.md`.
2. **Test blind spot**: no test asserted the actual storage key name, nor
   exercised the read path for a flag set by an EXTERNAL write (not through
   this module's own setter) -- a typo'd storage key would still pass every
   original test via self-consistent round-tripping. **Fixed**: added a
   `JSON.parse(localStorage.getItem(FEATURE_FLAGS_KEY))` assertion after a
   write, and a new test that hand-writes `{profile:false}` to storage and
   reads it back through `isFeatureEnabled`.
3. **Missing coverage**: `resetFeatureFlags` had zero test coverage and zero
   callers yet (GE3 not built) -- a copy-paste bug reusing the wrong storage
   key (the master `advancedModeUnlocked` key instead of the feature-flags
   key) would compile and pass everything else. **Fixed**: added a test
   asserting reset clears feature flags but leaves `isAdvancedModeUnlocked()`
   untouched.
4. **Minor**: `Array.prototype.sort()` was called directly on the exported
   `ADVANCED_FEATURES`/`TOGGLEABLE_FEATURE_KEYS` consts inside a test,
   mutating the module's shared array in place. **Fixed**: `[...array].sort()`.
5. **Minor**: `server`'s registry entry had a `labelKey` pointing at an i18n
   key GE3 never plans to add (since `server` is never rendered as a
   toggle). **Fixed**: dropped the `labelKey` for that entry, with a comment
   explaining why.

All fixes applied; full suite re-run green (15/15,
`client/tests/advancedMode.test.js`). No re-review requested -- fixes were
either mechanical (checkbox state, array copy, dead key removal) or
straightforward additive test coverage with no new logic to re-audit.
