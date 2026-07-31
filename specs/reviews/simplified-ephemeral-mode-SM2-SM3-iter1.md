---
spec: simplified-ephemeral-mode
section: SM2+SM3
iter: 1
agent: opus (general-purpose, worktree isolation)
files-reviewed:
  - client/js/advancedModeUI.js
  - client/js/router.js
  - client/js/app.js
  - client/tests/app.test.js
  - client/tests/router.test.js
  - client/index.html
  - client/css/style.css
  - client/js/i18n.js
---

## Findings (5 reported, 4 CONFIRMED and fixed, 1 dismissed with evidence)

1. **CONFIRMED, fixed.** `app.js` -- `onVisibilityChange` (called on
   lock/unlock) never re-triggered the router, so locking while an advanced
   screen (e.g. `#/server`) was open left that whole screen fully visible
   -- only the sidebar/gear hid. Fixed: `onVisibilityChange` now also
   dispatches a synthetic `hashchange` event, which the already-registered
   router listener picks up and re-evaluates the CURRENT route against the
   new lock state (no new router.js API needed). New regression test:
   "clicking the toggle while unlocked locks immediately ... including the
   currently-visible advanced screen".

2. **DISMISSED, not a real defect -- caller evidence provided.** Reviewer
   claimed the locked default lands on "account" and stays there,
   contradicting the spec's "conversation is always reachable" claim. Their
   repro did not exercise `autoStartChat` (H5's real zero-click production
   path -- `index.html` calls `initApp(document)` with no options, which
   defaults `autoStartChat` to `true`; every test in this suite passes an
   explicit options object, which defaults it to `false`). Traced the real
   code path: `app.js`'s `autoStartChat` branch (~line 4562) generates an
   identity, then calls `initiateChatSession()` -> `enterConversationLobby()`
   which calls `router.navigate("conversation")` DIRECTLY, by which point
   `state.senderKey` already exists -- both the identity gate and the
   restricted-route gate (conversation is deliberately excluded from
   `ADVANCED_ROUTES`) pass cleanly, locked or not. Added a regression test,
   "autoStartChat's zero-click ephemeral flow reaches conversation even
   while locked", using the same mock pattern as the pre-existing
   `btn-quick-chat` zero-click test -- passes without any code change. The
   "account" flash the reviewer observed is real but pre-existing (the same
   flash happens today, before this feature, for any fresh visitor during
   the async identity-generation window), not a regression.

3. **CONFIRMED (as a latent robustness gap, not currently reachable with
   this feature's actual config), fixed defensively.** `router.js`'s two
   redirect guards each only check their OWN gate's route list against
   their own redirect target -- a config where `restrictedRedirectRoute`
   is gated by the OTHER gate, and that gate's OWN `defaultRoute` is
   restricted by the first gate, slips past both guards and cycles
   forever (verified: no `RangeError`, a genuinely wedged tab, not
   reachable today since `ADVANCED_ROUTES` excludes `"account"`, but a
   real landmine for any future change to that list). Fixed with a
   redirect-hop counter (`MAX_REDIRECT_HOPS = 10`) in `render()`, correct
   regardless of how many gates exist or how they're configured relative
   to each other. New router.js test confirms it throws (not hangs) on
   the contrived cyclic config.

4. **CONFIRMED, fixed.** `advancedModeUI.js` -- the admin password was
   only cleared when the modal OPENED, not after a successful unlock or
   after cancel, contradicting the project's own existing "the password
   must not linger in the DOM" invariant (already enforced for the
   admin-login form). Fixed: cleared in both the unlock-success path and
   the cancel handler. Two new regression tests.

5. **CONFIRMED, fixed.** `advancedModeUI.js` -- `refreshToggleLabel()` set
   the footer button's text imperatively (not via `data-i18n`, since the
   label itself depends on lock state), so a language switch's
   `applyTranslations()` never touched it and it reverted to whichever
   locale was active at boot. Same bug class as the pre-existing C6 fix
   for `renderSettingsRegistry`/`renderDesignSettings`. Fixed the same way:
   `initAdvancedModeUI` now returns `{ refreshToggleLabel }`, called from
   `app.js`'s `lang-select` change handler alongside the C6 calls. Masked
   in the original test fixture because it was missing the `data-i18n`
   attribute `index.html` actually has -- fixture corrected to match, new
   regression test added.

## Explicitly checked, clean (not re-litigated)

- `renderGuestQuickActions()`'s `isAdvancedModeUnlocked()` call: no
  ordering hazard (static ESM import, evaluated before `initApp` runs;
  every call site is either synchronous-after-import or a later click).
  SM1's try/catch means it can't throw.
- i18n: all 11 locales carry exactly the new keys post-fix, no duplicates,
  no corruption in de/lv/it (spot-checked -- these were the ones an
  anchor-collision bug in the insertion script had initially clobbered;
  already manually corrected before this review, independently confirmed
  clean by the reviewer too).
- `btn-sidebar-back` unhiding on unlock is correct; mobile show/hide is a
  separate CSS-class mechanism this doesn't interfere with.
- Test scoping: the shared `beforeEach`'s unlock-by-default change is
  correctly ordered relative to the SM-block's own override.

## Convergence

**NOT converged after iteration 1** (4 real findings). Iteration 2
(`specs/reviews/simplified-ephemeral-mode-SM2-SM3-iter2.md`) needed to
confirm the fixes -- found one more real bug in the fix for finding 3,
fixed and converged there.
