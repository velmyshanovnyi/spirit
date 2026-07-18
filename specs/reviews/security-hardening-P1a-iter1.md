---
spec: phase5/security-hardening
section: P1a
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/webrtc.js
  - client/js/app.js
  - client/index.html
  - client/js/i18n.js
  - client/tests/rtcConfig.test.js
  - client/tests/app.test.js
  - specs/phase5/security-hardening.md
---

Zero findings. Diff reviewed against 5 scrutiny points:

1. `iceTransportPolicy` omission — confirmed correct in `buildRtcConfig`
   (`client/js/webrtc.js`): the key is added only via
   `if (forceTurnRelay) config.iceTransportPolicy = "relay";`, so when the
   toggle is off the key is entirely absent (not `"all"`), matching prior
   behavior byte-for-byte for every user who never touches the checkbox.
2. All peer-connection-construction call sites in `client/js/app.js` wired
   consistently — grepped `iceServers|rtcConfig|iceTransportPolicy|buildRtcConfig`,
   confirmed exactly 5 construction sites (initiator/`initiateChatSession`,
   `btn-join` joiner, device-linking initiator, device-linking joiner,
   invite-link auto-join joiner), all converted to
   `buildRtcConfig(el("stun-url").value, { forceTurnRelay: el("force-turn-relay").checked })`.
   No stray inline `{ iceServers: [...] }` literals remain.
3. No new persistence infrastructure introduced — confirmed the checkbox
   matches its siblings `server-url`/`stun-url` (neither persisted to
   localStorage/IndexedDB anywhere in `client/js`).
4. Test quality — the `vi.mock("../js/webrtc.js", ...)` reimplementation of
   `buildRtcConfig` in `app.test.js` is semantically identical to the real
   one; the 3 new app.test.js cases assert on the actual `rtcConfig` object
   threaded into `startAsInitiator`/`startAsJoiner` mocks (including an
   explicit `"iceTransportPolicy" in captured.rtcConfig` absence check), not
   vacuous passes. The joiner-path test specifically exists to catch a
   single-side-only wiring bug.
5. i18n — `data-i18n="server.forceTurnRelay"`/`server.forceTurnRelayHint` in
   `index.html` match keys added to all 11 locales in `i18n.js`.

Non-blocking observation (informational, no fix required): a forced-relay
toggle with only a plain STUN url configured will silently hang during ICE
gathering rather than surfacing a distinct error — this is disclosed via the
`server.forceTurnRelayHint` text but not actively detected/surfaced by
`setStatus`/ICE-timeout messaging. Judged out of scope for a UI-toggle
section; noted here for any future section that wants to add that detection.

Convergence: reached on iteration 1, no re-review needed.
