---
spec: onboarding-auth
section: 16-18
iter: 1
agent: opus (general-purpose subagent)
files-reviewed:
  - client/js/session.js
  - client/js/profile.js
  - client/js/identityAnnounce.js
  - client/js/contacts.js
  - client/js/app.js
  - client/index.html
  - client/css/style.css
  - client/js/i18n.js
  - client/tests/session.test.js
  - client/tests/profile.test.js
  - client/tests/identityAnnounce.test.js
  - client/tests/contacts.test.js
  - client/tests/app.test.js
---

## Findings and dispositions

1. **[Medium, FIXED]** The peer-verified status line showed the peer's self-chosen nickname INSTEAD OF the fingerprint (`verified.nickname || formatSpiritId(...)`). Since a nickname is peer-chosen, not proof of identity, a different (unknown) fingerprint could announce the same nickname as an already-trusted contact — the fingerprint, the actual TOFU trust anchor, was hidden from the user in that case. Fixed: `client/js/app.js` now always shows the fingerprint, with the nickname prefixed when present (`"Оксана (spirit0001...)"`). Covered by the updated test "shows the peer's announced nickname ALONGSIDE the fingerprint, never in place of it".

2. **[Low, FIXED]** `rememberSession(selectedId, ...)` used the pre-migration `#profile-select` value ("identity" for a legacy record) instead of the actually-loaded `profile.profileId` (the fingerprint). For a legacy profile this meant the remembered session id would never match on the next load's `listProfiles()` (which returns the migrated id), silently breaking the preselect. Fixed: now stores `profile.profileId`. Covered by new test "remembers the session under the MIGRATED profile id, not the legacy selector value"; the existing "remembers the session ... after a successful unlock" test's expectation was corrected to match (it had been asserting the pre-fix, wrong behavior).

3. **[Low, FIXED]** `Number(el(...).value) || DEFAULT` let a negative TTL (e.g. `-5`) pass through as truthy, producing an `expiresAt` already in the past — silently making `rememberSession` a no-op with no user-visible feedback. Fixed: extracted `readSessionTtlHours()` which clamps to `>= 1`, used both by the unlock handler and the TTL field's persisted-setting `change` handler. Covered by new test "falls back to the default TTL instead of a past expiry when the field holds a negative number".

## Points reviewed and accepted as-is (no change)

- Unencrypted local nickname storage and the silent nickname-update-on-reannounce in `contacts.js` are the explicit, user-agreed design (spec Decisions 1-2); reviewer confirmed this doesn't newly expose the social graph beyond what the existing cleartext fingerprint/pubkey storage already does.
- `identityAnnounce.js` nickname-as-terminal-field payload construction preserves injectivity; the tampered-nickname test is a real signature check, not tautological.
- `forgetSession()` being unused is not a bug (no explicit-logout UI exists yet; a stale remembered id is harmless since the profile-selector guard rejects unknown ids).

## Verification

Full suite green after fixes: 332/332 (`npx vitest run`). Live-verified in browser: create account with nickname → reload → login block shows correct preselected profile → unlock → `localStorage['spirit.session']` correctly populated with the real profile id and a ~24h-out expiry.
