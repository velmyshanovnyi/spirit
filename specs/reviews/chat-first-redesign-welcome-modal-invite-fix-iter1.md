---
spec: ui/chat-first-redesign
section: H1-followup
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/app.js
  - client/tests/app.test.js
---

Zero findings. Converged on iteration 1.

Bug report (2026-07-17, user-reported): "initiate a chat, enter it, copy the link, open it in an anonymous tab, chat doesn't open." Root cause found via live testing: a genuinely fresh browser session (real incognito, no `spirit.welcomeSeen` flag) following an invite link auto-joins successfully in the background (Section F4), but the H1 welcome modal rendered ON TOP of the just-joined conversation screen (both fixed-position overlays), covering it with its backdrop -- the chat "didn't open" visually even though the P2P connection succeeded underneath. An earlier session's own H6 verification note in this spec incorrectly concluded invite-link visitors never see the welcome modal; that conclusion was an artifact of testing in a reused browser tab that had already dismissed the modal (shared localStorage), not real suppression logic, which never existed until this fix.

Fix: `welcomeModal.hidden = alreadySeen || cameFromInviteLink;` -- required moving the invite-link query-param parsing block (and the `el` helper it depends on) earlier in `initApp`, before the welcome-modal setup.

Reviewed and confirmed clean:
1. Moving `const el = (id) => doc.getElementById(id);` to the top of `initApp` is safe -- it only depends on the `doc` parameter, nothing set up between its old and new position.
2. Moving `joinParams`/`invitedRoomId`/`invitedToken`/`cameFromInviteLink` earlier is safe -- traced every usage site, none depend on anything between the old and new position.
3. The two adjacent pre-existing welcome-modal tests (fresh-visit-shows-modal, already-seen-hides-it) still pass for the right reason -- `cameFromInviteLink` correctly evaluates false in both (no room/token in `locationSearch`), so `|| cameFromInviteLink` doesn't make them pass vacuously.
4. The fix addresses the bug regardless of whether the initiator's session was manually started or H5-auto-started -- Section F4's joiner auto-join path is identical either way. No evidence of a second, independent failure mode (e.g. ICE-gathering race, single-use-token reuse, rate-limiting) contributing to the reported symptom.

Full suite verified: 460/460 project-wide (app.test.js: 176/176).
