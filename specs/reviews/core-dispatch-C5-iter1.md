---
spec: specs/phase5/core-dispatch.md
section: C5 — call/media domain → callUI.js
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/callUI.js
  - client/js/app.js
  - client/tests/callUI.test.js
  - specs/phase5/core-dispatch.md
---

# Verdict: PASS — 0 findings

1. **Verbatim** — setVideoStatus, updateCallButtonStates, previewLocalMedia,
   acquireLocalStream, onWebrtcCallOffer/Answer, startCall, autoStartOwnerCall,
   onMediaToggle and the two click listeners are identical to the removed
   app.js blocks (indent aside). Only stopLocalMedia + table + return are new.
2. **stopLocalMedia dedup** — torn-down path: same order (unconditional
   `localStream = null` is a no-op when already null). Teardown path: the two
   flags reset before hideSafetyNumberHint/resetActiveConnection — not
   observable (synchronous; neither reads the flags; flags are not per-peer
   proxy fields). Channel/pc close still precedes the media stop. Spec wording
   tightened accordingly.
3. **TDZ** — teardownMediaAndConnection (1616) only runs from btn-logout /
   btn-room-leave clicks; stopLocalMedia in handleConnectionTornDown, previewLocalMedia
   in enterConversationLobby, autoStartOwnerCall in onIdentityAnnounce — all runtime,
   after the init at 1749–1760. `acquireLocalStream` returned but unused in app.js (harmless).
4. Module identifiers resolve; getUserMedia path unchanged.
5. Pruning — 4 webrtc symbols only in comments; the rest still used.
6. Tests non-vacuous.
7. Spec ↔ code match (incl. the "only non-verbatim change" statement).

Tests: callUI + app 420/420. Author full suite: 68 files, 1095/1095.

## Author's live verification (2026-10-03; app.js 142663 B, callUI.js 8873 B byte-identical on both hosts)
kolomedi: module in Resource Timing, 16 table keys incl. the two webrtc
handlers; camera tap → localized "Permission denied" status (pane denies
media), aria-pressed false; «Вийти» → new room id, remote tile hidden, invite
card back (stopLocalMedia + lobby). kibr: module loaded, 16 keys. No console
errors on either host.
