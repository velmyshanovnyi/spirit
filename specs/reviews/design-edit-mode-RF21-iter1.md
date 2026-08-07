---
spec: design-edit-mode
section: RF21
iter: 1
agent: opus (general-purpose subagent, two attempts -- first hit a session
  API limit mid-review and was retried in full)
files-reviewed:
  - client/js/app.js
  - client/js/designSettingsRegistry.js
  - client/js/settingsPanelUI.js
  - client/css/style.css
  - client/js/i18n.js
  - client/tests/app.test.js
  - client/tests/designSettingsRegistry.test.js
---

## Verdict: CONVERGED (after fixes below); live browser verification still required before this section is considered fully done

This was the highest-risk section of the RF20-23 batch -- real DOM
reparenting of `#floating-video` (which contains the live `<video>`
elements) between the float mount point and the conversation card. The
reviewer mutation-tested the guards and found three real defects plus a
misleading comment; all fixed.

## Findings and resolutions

1. **CONFIRMED, high, CSS**: `applyRect()` (RF4's pre-existing init logic)
   unconditionally sets inline `left/top/width/height` on `#floating-video`
   -- an inline style always beats the docked CSS rule's
   `width:100%`/`aspect-ratio:4/3`, so the docked box silently kept
   whatever pixel size float mode last had, and `aspect-ratio` never took
   effect. **Fixed**: `applyVideoDockMode()` now captures and clears the
   float-mode inline rect on dock, restores it byte-for-byte on undock.
2. **CONFIRMED, high, CSS**: docking set `.floating-video` to
   `position: static`, which means `.video-tile-remote`'s
   `position: absolute; bottom/right` no longer resolves against it as a
   containing block -- the remote peer's thumbnail would escape the panel
   entirely and float over the rest of the page. **Fixed**: `position: relative`
   instead of `static` (keeps the same "this element positions its
   children" contract as float mode, without the fixed-to-viewport part).
3. **CONFIRMED, medium, JS**: the window-resize clamp listener wrote
   `panel.offsetLeft/offsetTop` (in-flow docked coordinates) into inline
   `left/top` regardless of dock state -- corrupted values could then be
   PERSISTED to `spirit.floatingVideoRect` on a later undock, since
   `isDocked` is already `false` by the time that undock's own
   `ResizeObserver` callback fires (so `persistCurrentRect`'s own guard
   doesn't catch it). **Fixed**: added the same `if (isDocked) return;`
   guard to the resize listener.
4. **PLAUSIBLE, low, doc accuracy**: a comment claimed
   `onDesignSettingChange` was needed because toggling `videoMode` "while
   ALREADY on the conversation route with an active call must take effect
   immediately" -- in the CURRENT layout this path is unreachable (the
   design-settings controls live on the mutually-exclusive "server"
   screen, so `applyVideoDockMode()`'s own `!panel.hidden` check is always
   false at click time; the setting genuinely takes effect on the next
   route entry, already covered by test 2). **Fixed**: reworded the
   comment to describe this honestly (forward-compatible plumbing, not
   something exercised today).
5. **CONFIRMED, low, test coverage (mutation-verified)**: two mutations
   survived the original 3-test suite -- removing the `pointerdown`
   guard's `if (isDocked) return;`, and removing the
   `wantDocked === isDocked` no-op guard in `applyVideoDockMode`. **Fixed**:
   strengthened the drag test to assert `panel.style.left` is unchanged
   (not just localStorage), and added three new tests: undock restores
   the exact pre-dock inline width/height (pins finding 1's fix);
   window-resize-while-docked doesn't corrupt `spirit.floatingVideoRect`
   (pins finding 3's fix); re-selecting the SAME mode doesn't call
   `insertBefore` again (pins the no-op guard, via an `insertBefore` spy
   on the dock target -- the closest jsdom-visible proxy for "this would
   have disturbed real `<video>` playback").
6. **CONFIRMED, cosmetic, i18n**: the internal spec ID "RF4" leaked into
   user-facing description text in all 11 locales ("Float (draggable
   overlay, RF4 default)...") -- meaningless to an end user. **Fixed**:
   removed "RF4" from all 11 locale strings, kept "default"/its
   translation.

Full suite re-run green (`app.test.js` -t "RF21": 6/6;
`designSettingsRegistry.test.js` -t "RF21": 3/3; full suite: 981/982, the
one failure being the pre-existing, unrelated "ICE gathering timeout"
flake, confirmed passing in isolation).

## Requires live browser verification before this section is fully done

The reviewer explicitly flagged this as NOT jsdom-testable (jsdom has no
real `<video>`/`MediaStream` implementation):

- **Playback continuity across reparenting**: does moving `#floating-video`
  (containing `#video-remote`/`#video-local`) via `insertBefore` interrupt
  an active `MediaStream`'s rendering in a real browser? Per spec this
  should be safe (synchronous remove+insert within the same document
  doesn't trigger `<video>`'s pause steps), but engine behavior can differ
  in practice.
- **Visual confirmation of findings 1 and 2's fixes** with an actual docked
  call (responsive sizing, remote-peer thumbnail staying inside the
  panel).

Per this project's established convention (RF17/RF18/RF22-iter2: CSS
cascade and live-rendering claims are verified by browser checking after
deploy, not jsdom), this section's `[ ]` Exec review checkbox in
`specs/ui/design-edit-mode.md` stays UNCHECKED pending an actual two-peer
call test on both hosts, deferred to a following work session.
