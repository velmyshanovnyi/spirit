---
spec: specs/phase5/core-dispatch.md
section: C4 — per-contact announcement handlers → peerAnnouncements.js
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/peerAnnouncements.js
  - client/js/app.js
  - client/tests/peerAnnouncements.test.js
  - specs/phase5/core-dispatch.md
---

# Verdict: PASS — 0 findings

1. **Verbatim** — all five handler bodies + comments match the removed app.js
   lines (only header/imports/wrapper/table/return differ, plus the uniform
   re-indent).
2. **TDZ** — init at app.js:1977; `renderSafetyHint` is a hoisted function
   declaration (630), `state` above; `announcementHandlers` used only in the
   table spread (2003); handlers run only from dispatch.
3. **Pruning** — 8 symbols have 0 uses left; kept imports still used
   (rememberContact 1922, computeSharedSafetyNumber 1932, hexToEmoji 648,
   getSetting 1322); the glued import line still parses (pre-existing).
4. **Table** — 5 explicit entries incl. safety-display-mode removed, back via
   the spread; no overlap between the three spreads; C1 drift guard passes.
5. **Tests** real (5 keys; vault-less gate leaves contacts untouched; vault
   present stores; safety mode incl. "garbage" → "peer" fallback).
6. **Spec ↔ code** — consistent (module imports getContact itself).

Tests: peerAnnouncements + app 421/421. Author full suite: 67 files, 1092/1092.

## Author's live verification (2026-10-03; app.js 150309 B, peerAnnouncements.js 4152 B byte-identical on both hosts)
kolomedi + kibr: module in Resource Timing, `__spiritControlHandlers` has 16
keys with the five announcement keys as functions; no console errors.
