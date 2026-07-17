---
spec: ui/ephemeral-spirit-mode
section: F6-followup
iter: 2
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/index.html
  - client/js/app.js
  - client/tests/app.test.js
---

Converged. Zero new findings.

All three iteration-1 findings confirmed fixed:

1. `client/index.html` adds `<div id="room-status" class="status"></div>` on the room screen; `client/js/app.js`'s `setStatus()` now writes to both `#connection-status` and `#room-status` (guarded with `if (roomStatus)`, safe since `el()` returns null on a miss). Test exercises the exact regression scenario (no identity, click `btn-initiate`, assert `#room-status` gets the guard text).
2. `client/js/app.js`'s Enter-to-send guard now reads `event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229`. Test dispatches with `isComposing: true` and asserts no additional send.
3. Original mistitled test renamed to accurately describe its own behavior ("a" keypress); a new, genuinely separate test dispatches a real `{ key: "Enter", shiftKey: true }` event and asserts no send.

All three fixes are structurally sound, correctly scoped, and each has a genuine (non-vacuous) test exercising the specific failure mode.

Full suite verified: 436/436 project-wide (app.test.js: 153/153).

Convergence reached at iteration 2 — no re-review needed.
