---
spec: specs/ui/room-first.md
section: RF2 — room controls (mic / camera / leave), owner auto-call
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/index.html
  - client/css/style.css
  - client/js/app.js
  - client/js/designSettingsRegistry.js
  - client/js/advancedModeUI.js
  - client/js/i18n.js
  - client/js/locales/*.js
  - client/tests/app.test.js
  - client/tests/designSettingsRegistry.test.js
  - specs/ui/room-first.md
---

# Verdict: FAIL — 1 HIGH, 1 MED-LOW, 1 LOW; all addressed in iter2

## F1 (HIGH) — owner auto-offer raced its own announce / missing sessionKey
`client/js/app.js` initiator `afterChannelOpen`: `if (state.localStream) void startCall();`
`announce()` is fire-and-forget (async ECDSA sign before send); nothing ordered
the two sends, and the joiner processes messages strictly in order — an offer
before the announce is rejected (`status.incomingRejected`). Sub-race: the
channel can open before `state.sessionKey` is derived → `encryptMessage(undefined)`
throws, but `acquireLocalStream` had already set `localTracksAddedToPeer`, which
also gated the taps → call permanently dead for the session. Joiner side:
a message before its own sessionKey is dropped silently (same dead end).
**Fixed (iter2):** trigger moved to the `identity-announce` handler right after
`state.peerFingerprint` is set (proves both keys + in-order processing);
`autoStartOwnerCall` awaits `state.ownAnnouncePromise` (announcer returns its
in-flight promise); `startCall` guards `!sessionKey`; new `state.callOfferSent`
flag reset in `catch` → retryable; `state.isInviteOwner` re-asserted after
`resetActiveConnection()` in `initiateChatSession`. Tests: ordering test
(no offer before verification; announce index < offer index; exactly one
offer) + retry test.

## F2 (MED-LOW) — joiner glare
`onMediaToggle`: `if (state.channel && state.pc && !state.localTracksAddedToPeer) await startCall();`
A joiner tap during the owner's in-flight offer puts both sides in
`have-local-offer`. **Partially addressed:** taps now require a verified peer
and the retry flag makes a second tap heal it; the ~RTT window that needs a
user tap at that exact moment is recorded as an accepted residual in the spec.

## F3 (LOW) — spec wording said `state.isInviteOwner` at `onChannelOpen`
**Fixed:** spec RF2 rewritten to the verified-peer trigger.

## Minor — stale comments
`btn-start-call` / `headerCallControls` mentions in app.js, app.test.js
comments. **Fixed.**

## Checks that passed
teardown shared by logout/leave (order change harmless); leave re-prompts
getUserMedia (browsers don't re-prompt once granted — acceptable); taps while a
preview is in flight share `localMediaPreviewPromise`; no leftover
`#header-call-controls` references in logic; i18n parity green; RED→GREEN
story credible (preview denied via `mockRejectedValueOnce`).

Tests: app + designSettingsRegistry + i18n — 460/460.
