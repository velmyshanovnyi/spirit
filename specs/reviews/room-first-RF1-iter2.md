---
spec: specs/ui/room-first.md
section: RF1 — room stage + toolbar room id
iter: 2
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/app.js
  - client/tests/app.test.js
  - client/tests/designSettingsRegistry.test.js
  - specs/ui/room-first.md
---

# Verdict: PASS — 0 new findings (delta of the two iter1 fixes)

- (a) group → 1:1: `enterConversationLobby` sets `activeGroupId = null`
  before `renderInviteBar()` → `renderRoomChip()`, so the chip reappears.
- (b) `state.activeGroupId` is written in exactly two places (null in the
  lobby; the id in `openGroupConversation`, immediately followed by
  `renderRoomChip()`).
- (c) Tests non-vacuous (pre-filled "deadbeef" + hidden assert; options[0]).
- Not covered by a test: group → 1:1 chip reappearance (code order verified).

Tests: designSettingsRegistry 41/41; app -t group 30/30. Author full suite:
63 files, 1065/1065.

## Author's live verification (2026-10-02, kolomedi, 375px viewport, fresh H5 visit)
`#room-stage` renders as a dark 4:3 area with the silhouette placeholder
(camera denied in the pane → `video-status` shows the error inside the
stage); the docked panel sits inside the stage (`panelInStage: true`,
position absolute after the specificity fix); toolbar chip shows
`fc2d E2EE` with the green lock. Welcome modal / header untouched (RF3/RF5).
kibr: same build deployed byte-identical (profile-remembered session there
lands on the account screen, so the stage was checked on kolomedi).
