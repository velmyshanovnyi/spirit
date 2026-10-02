---
spec: specs/ui/room-first.md
section: RF1 — room stage + toolbar room id
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/index.html
  - client/css/style.css
  - client/js/app.js
  - client/js/designSettingsRegistry.js
  - client/tests/app.test.js
  - client/tests/designSettingsRegistry.test.js
  - specs/ui/room-first.md
---

# Verdict: PASS with 2 findings — both FIXED (see iter2)

1. **Doc drift** — `client/tests/designSettingsRegistry.test.js` comment
   `"float" MUST be options[0]` and test name `(== default float)` contradict
   the new docked default. Fixed: comment + name updated, new assertion
   `options[0] === "docked"`.
2. **Stale room chip in group conversations (low)** — `renderRoomChip` reads
   `#room-id`, which is never cleared; group chats reuse the screen without
   `renderInviteBar`, so a previous 1:1 id could stay visible. Fixed: chip
   hidden when `state.activeGroupId` is set; `openGroupConversation` calls
   `renderRoomChip()`; GC3 test pre-fills `#room-id` and asserts hidden (RED
   proven by temporarily reverting the fix). Spec table wording corrected
   (`#room-id`, not `state.roomId`).

## Checks (PASS)
- Default flip: `?? "docked"` at applyVideoDockMode; dock saves inline rect
  (savedInlineRect) so a later first switch to float restores applyRect's
  values; CSS docked rules under `:root:not([float])`; settingsPanelUI
  options[0] highlight consistent.
- Startup timing: placeholder no-op → real fn assigned → corrective call →
  onDesignSettingChange wiring; RF1 test covers dock on route entry/undock on exit.
- CSS cascade: stage rule (0,3,0) beats relative rule (0,2,0); `#video-status:empty`
  hidden acceptable (empty live region announces nothing).
- Tests non-vacuous; explicit float opt-in in RF4/RF21 does not weaken
  coverage of the docked default.
- Skipped by reviewer: drift-guard fixture generation (passes in suite);
  visual check of remote overlay (author's live check below).

Tests: app + designSettingsRegistry 444/444.
