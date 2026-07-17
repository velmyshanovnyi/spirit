---
spec: ui/ephemeral-spirit-mode
section: F6
iter: 2
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/app.js
  - client/tests/app.test.js
---

Converged. Zero new findings.

The fix directly addresses the iter1 finding: `previewLocalMedia()` now checks `state.localStream` first (already-resolved case), then `state.localMediaPreviewPromise` (in-flight case), caching the async IIFE's promise and clearing it in a `finally` block — a second call arriving while the first is pending awaits the SAME promise instead of issuing a second concurrent `getUserMedia()`. Since JS execution between awaits is synchronous, the two checks close the TOCTOU window: there is no point where a second caller can observe both fields unset and slip through.

The new test ("does not start a second concurrent getUserMedia prompt if the lobby is entered again while the first is still pending") genuinely exercises the scenario: holds `getUserMedia` pending via an unresolved promise, double-clicks `btn-quick-chat`, gives the second click's own awaits real time to run via `setTimeout`, and asserts `getUserMediaMock` was called exactly once before and after resolution — a faithful reproduction of the original finding, not a tautological check.

Full suite verified independently: 148/148 in app.test.js, 431/431 project-wide.

No new concerns from re-reading the surrounding code (device-linking paths, `isInviteOwner`, `onChannelClose` reset ordering) — all previously reviewed as correct, untouched by this fix.

Convergence reached at iteration 2 — no re-review needed.
