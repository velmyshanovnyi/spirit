---
spec: specs/ui/portable-backup-step.md
section: P1 — conditional backup step for portable accounts (backlog A13)
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/index.html
  - client/js/profileUI.js
  - client/js/i18n.js
  - client/js/locales/{de,es,fr,it,ru,lt,lv,et,no}.js
  - client/tests/app.test.js
---

# Verdict: PASS — 0 findings

1. **Coverage** — `#backup-step` is revealed in exactly one place
   (profileUI.js btn-profile-confirm) and hidden in one (btn-backup-skip);
   mnemonic/keyfile restore and recoveryUI never show it. Both flags are set
   on every confirm from `portable` read once → random-after-portable in the
   same session resets correctly. No stale path.
2. **Markup consumers** — no CSS targets `#backup-step` children or sibling
   structure (only `.btn-row`/`.secret-output` classes); tests reference ids
   only; global `[hidden]` rule applies to the hint.
3. **applyTranslations** sets textContent on every `[data-i18n]` regardless of
   `hidden` → the uk textContent assertion is meaningful; `t(key) !== key`
   guard rules out a vacuous match.
4. **Locale parity** — key present once in all 9 locale files + en/uk inline;
   dynamic import of all 9 succeeded.
5. **Test quality** — both hidden states asserted on both paths; RED was the
   null-element failure before the markup existed.

Tests: app + i18n + profileUI — 418/418. Author full suite: 1060/1060.

## Author's live verification (2026-10-02; 12 files deployed, byte-identical on both hosts)
First attempt surfaced the F1 navigation-cache bug (stale index.html served
from HTTP cache through the SW) — fixed as deploy-freshness Section F2
before this could be verified. With fresh documents:
- **kolomedi** (fresh tab): portable create → `#backup-key-exports` hidden,
  mnemonic button not rendered, `#backup-portable-hint` visible with the
  Ukrainian text, skip button visible, login string shown.
- **kibr**: random create → exports visible, hint hidden, mnemonic = 24 words;
  then a portable create in the SAME session → exports hidden, hint visible
  (state resets per confirm, as the reviewer reasoned). No console errors.
