---
spec: phase4/group-chats
section: GC0
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/app.js
  - client/tests/app.test.js
  - specs/phase4/group-chats.md
---

Focus: refactor correctness of the `state.peers` Map / `PEER_PROXY_FIELDS` getter-setter
transformation of `client/js/app.js`'s formerly-flat per-connection `state` fields
(`pc`, `channel`, `sessionKey`, `sessionEcdhWires`, `sendChainKey`, `receiveChainKey`,
`peerFingerprint`, `peerIdentityPublicKey`, `isInviteOwner`).

Ten checks performed, all passed:

1. **Proxy getter/setter field list and fallback values** — `PEER_PROXY_FIELDS` is exactly
   the 9 fields; getter falls back to `null` (or `false` for `isInviteOwner`) matching the
   original flat state's initial values when no peer is active.
2. **`ensureActivePeer()` reuse semantics** — creates a new Map entry only when none is
   active; sequential field writes within `startInitiatorSession`/`startJoinerSession` land
   on the same entry (verified this does NOT split a single session's fields across two
   different Map entries).
3. **`getActivePeer()` null-safety** — returns `undefined` cleanly when
   `activeConnectionId` is `null`; getters handle it without throwing.
4. **`btn-logout` teardown ordering** — `state.channel.close?.()`/`state.pc.close?.()` run
   BEFORE `resetActiveConnection()` deletes the Map entry, so real WebRTC objects are
   closed, not silently no-op'd via the getter's null fallback.
5. **Three other reset sites** (`initiateChatSession`, `btn-join`, auto-join IIFE) reset
   `peerFingerprint`/`sessionEcdhWires` without calling `resetActiveConnection()` —
   confirmed this preserves the ORIGINAL flat-state code's in-place-overwrite behavior
   exactly (same active entry reused, not left stale), not a regression.
6. **`randomConnectionId()` entropy/pattern** — 16 random bytes (128 bits) hex-encoded,
   matches the codebase's established `randomSenderKey`/`historyStore.js` ID pattern.
7. **`createPeerEntry()` field set** — matches spec exactly, including `groupId: null`.
8. **Non-moved fields** — `identityKeyPair`, `senderKey`, `localStream`,
   `localTracksAddedToPeer`, `nickname`, file-transfer state, media-preview fields all
   confirmed still plain top-level `state` fields, untouched by the Map/proxy.
9. **No proxy bypass** — all direct `state.peers`/`state.activeConnectionId` access is
   confined to the helper functions; no call site manipulates the Map directly.
10. **New tests** (`app.test.js`, "GC0" describe block) — both genuinely exercise the
    create-if-none-else-reuse semantics and the logout-deletes-entry behavior; would fail
    under either wrong implementation (always-new-entry or always-reuse-even-after-reset).

## Verdict: CONVERGED — zero findings.
