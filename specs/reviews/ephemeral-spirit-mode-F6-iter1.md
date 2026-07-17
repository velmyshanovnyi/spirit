---
spec: ui/ephemeral-spirit-mode
section: F6
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/app.js
  - client/index.html
  - client/tests/app.test.js
---

One finding, fix required before commit (per dismissibility rule):

**PLAUSIBLE — concurrent getUserMedia race from a double-click into the conversation lobby.** `previewLocalMedia()`'s `if (state.localStream) return` is a TOCTOU guard that doesn't cover two concurrent in-flight calls: `startInitiatorSession()` is not awaited inside `initiateChatSession()`, so the outer async function resolves and `withBusyButton` re-enables `btn-quick-chat` while `getUserMedia()` is still prompting. A fast second click can spawn a second concurrent `getUserMedia()` call, orphaning the first live `MediaStream` (its tracks never stopped, camera left running).

Non-defects confirmed during this pass:
- `acquireLocalStream()`/`state.localTracksAddedToPeer` correctness: the `onChannelClose` reset (null `localStream` then clear the flag, no interleaving await) has no window where the flag is true while the stream is null.
- Device-linking (`btn-link-device`, `btn-join-as-device`) never calls `enterConversationLobby`/`previewLocalMedia`/navigates to "conversation" — no regression of previously-reviewed intentional behavior.
- `state.isInviteOwner` correctness: every entry point sets it explicitly (true for both initiator paths, false for both joiner paths) — no stale-flag path found.
- Test coverage: adequate for the happy paths; the concurrency race itself was untested prior to this review (flagged, then covered by a new test after the fix).

Convergence: not reached, iteration 2 required after the fix.
