---
spec: ui/chat-first-redesign
section: F6-followup-2
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/app.js
  - client/index.html
  - client/tests/app.test.js
---

One finding, fix required before commit:

**CONFIRMED (blocking) — uncancelled delayed `setTimeout` re-acquires camera/mic after teardown.** The timeout handle scheduling the delayed auto-preview (Section F6 follow-up) was never stored or cleared. If the user logged out (`btn-logout`) or the channel closed (`onChannelClose`) within the delay window, both paths null out `state.localStream`/`state.localMediaPreviewPromise`, but the orphaned timeout then fires anyway once its delay elapses, and `previewLocalMedia()`'s guards no longer short-circuit (session state was reset) -- re-lighting the camera after logout, writing into `#video-local`, re-enabling toggle buttons, and leaking a stream nothing later stops. The `localMediaPreviewDelayMs=0` branch (used by every test) runs synchronously and is unaffected, which is why the suite stayed green and didn't catch this -- only production's 1500ms path was exposed. Fixed by storing the timer id in `state.localMediaPreviewTimeoutId`, clearing it in both teardown paths, and adding a defensive `if (!state.senderKey) return;` inside the timeout callback itself as a second layer.

Non-defects confirmed during this pass:
1. **`autoStartChat: true` in index.html** is correct and genuinely necessary -- `autoStartChat = options === undefined` is the only option keyed on the no-arg-vs-object distinction; passing any options object for the new delay setting necessarily flips that, so spelling out `autoStartChat: true` explicitly is exactly what preserves the old bare `initApp(document)` production behavior.
2. **Concurrent start-call race**: if the user hits "Дзвінок" during the delay window, `state.localStream`/in-flight-promise gets set by that path, so the delayed timeout's eventual `previewLocalMedia()` call correctly early-returns -- no duplicate `getUserMedia`.
3. Delay value (1500ms) and the real-`setTimeout`-based test pattern (vs. fake timers) are reasonable, non-blocking judgment calls, not defects.

Convergence: not reached, iteration 2 required after the fix.
