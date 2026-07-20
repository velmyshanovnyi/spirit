---
spec: specs/phase2b/import.md
section: I3
iter: 1
agent: opus (Task subagent)
files-reviewed:
  - client/js/importedContacts.js
  - client/js/historyStore.js
  - client/js/app.js
  - client/index.html
  - client/js/i18n.js
  - client/tests/importedContacts.test.js
  - client/tests/historyStore.test.js
  - client/tests/app.test.js
---

# Exec review: Section I3 (imported history)

## Checks performed

1. **Impossible to reach `appendMessage` without matching first** — CONFIRMED SAFE. `saveImportedContact` only persists `pendingMessages` to IndexedDB; the sole `appendMessage` call for imports is inside the Match-button handler, gated behind `setMatchedFingerprint` + a re-fetch of the record. No speculative/early write path.

2. **`imported: true` survives encryption-at-rest** — CONFIRMED SAFE. `appendMessage` now does `JSON.stringify(payload)` on the whole object; `listMessages` does `JSON.parse(...)` of the full decrypted object with no field allowlist. Round-trip test added in `historyStore.test.js`.

3. **Direction-inference heuristic** — CONFIRMED SAFE, well documented. `inferImportedDirection` is preceded by an explicit comment stating it is "explicitly a heuristic, not a reliable authorship signal," with the stated `"in"` fallback. `deriveImportedHistoryDisplayName` similarly labeled as a documented, non-guaranteed heuristic.

4. **Visual badge in all rendering paths** — CONFIRMED SAFE. A freshly-completed match does NOT render live into the chat log (the handler ends with `renderImportedContactsScreen()`, not `appendChat`). Imported messages surface only when the user later opens the conversation via the single `listMessages` reload path, which passes `entry.imported === true` through to `appendChat`. The two live-message `appendChat` call sites (send/receive) are native P2P and correctly default `imported=false`. Effectively one rendering path for imported messages, and it carries the marker.

5. **Other issues**:
   - **Real finding (fixed)**: confirming a match while no vault key is present (ephemeral mode) would silently strand `pendingMessages` — `setMatchedFingerprint` runs unconditionally, the Match button then disappears on re-render, and without a vault key `historyStore.js` is never written to, so the messages vanish with no feedback. **Fix applied**: the match handler now checks for this case and calls `setImportStatus(t("import.ephemeralHistorySkipped"))` instead of silently dropping the messages; `pendingMessages` are left in place (not cleared) so a later re-match in profile mode could still recover them. Covered by a new regression test in `app.test.js`.
   - No XSS (all label rendering uses `textContent`), no dead code, no unused imports.
   - Minor/benign: rapid double-click on Match before the first write completes could theoretically enqueue duplicate writes, but `messageKey`'s `(profileId, contactId, timestamp)` keying means identical-timestamp duplicates overwrite the same key rather than duplicate. Not actionable.

## Outcome

Converged at iteration 1. One real finding, fixed and verified with a new test (725/725 total suite passing after the fix, up from the 724 immediately after the initial green implementation).
