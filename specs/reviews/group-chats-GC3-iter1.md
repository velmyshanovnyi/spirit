---
spec: phase4/group-chats
section: GC3
iter: 1
agent: opus-subagent (general-purpose, model override)
files-reviewed:
  - client/js/app.js
  - client/index.html
  - client/js/i18n.js
  - client/tests/app.test.js
  - specs/phase4/group-chats.md
  - specs/reviews/group-chats-GC2-iter1.md
---

Focus: fan-out send correctness, the `group-message` anti-spoofing gate, the `onMessage`
activeConnectionId rebinding under real concurrent connections (GC3 is the first section where
multiple live channels coexist), JSON history round-trip, UI routing/state-leak, and the
`buildInviteLinkText` 1:1 invariant.

## Findings

### 1. MEDIUM — `onMessage` activeConnectionId rebinding is not await-safe; concurrent inbound on two connections corrupts dispatch context

`client/js/app.js` ~line 1840, `wireChannelCallbacks.onMessage`:

```
const previousActiveConnectionId = state.activeConnectionId;
if (ownerConnectionIdAtWireTime !== null) state.activeConnectionId = ownerConnectionIdAtWireTime;
try {
  ... await decryptMessage(...) ; await onDecryptedMessage(text);
} finally {
  state.activeConnectionId = previousActiveConnectionId;
}
```

The rebind mutates a single **shared global** across `await` points. GC3 is precisely the section
that makes two simultaneously-live channels real, and group fan-out means two peers' messages can
arrive with overlapping async decrypt windows. Interleaving (single-threaded, but callbacks yield
at every `await`):

- A fires: `previousActiveConnectionId = X`; `activeConnectionId = A`; yields at `decryptMessage`.
- B fires: `previousActiveConnectionId = A` (current value!); `activeConnectionId = B`; yields.
- A resumes: `await onDecryptedMessage(text)` -> `handleChatMessage` reads `state.peerFingerprint`
  and `getActivePeer().groupId`, but `activeConnectionId` is now **B**. A's message is dispatched
  against B's peer entry. A's `finally` sets `activeConnectionId = X`.
- B resumes: dispatched against **X**; `finally` sets `activeConnectionId = A`.

Concrete consequences: (a) the `group-message` spoof gate `getActivePeer().groupId ===
control.groupId` and the `senderLabel`/stored `senderFingerprint` are evaluated against the WRONG
peer -- a valid group message can be silently dropped, or (worse for a security messenger)
rendered/persisted with the wrong sender attribution; (b) the save/restore is not stack-correct
under interleaving, so `state.activeConnectionId` is left dangling at a wrong connection after
processing, which then misroutes subsequent SYNCHRONOUS operations that call `getActivePeer()`
(1:1 `sendChatMessage`, file-send, video controls). The decrypt key itself is safe (read
synchronously as the `decryptMessage` argument), so this is misrouting/misattribution, not a
crypto break. The inline comment's "transparent... same-value no-op" claim holds only for the 1:1
single-connection case it was reasoning about, not for the multi-connection case this section
introduces. Suggested fix: resolve the owner peer entry once and thread it (or a synchronous
snapshot of sessionKey/receiveChainKey/peerFingerprint/groupId) explicitly through
`onDecryptedMessage`/`handleChatMessage`, rather than mutating a shared global across awaits.

### 2. LOW — inbound `group-message` is accepted without confirming the group exists locally

`client/js/app.js` ~line 1637, `group-message` branch of `handleChatMessage`. The gate checks
`state.peerFingerprint` verified + `getActivePeer().groupId === control.groupId`, then renders and
persists. Unlike the GC2 `group-member-joined` handler -- which additionally does `getGroup(...)`
and silently ignores an unknown group -- this path has no `getGroup` existence check. A verified
peer on a connection the local user tagged (e.g. by opening that peer's `?group=` invite link) can
therefore render into `#group-chat-log` and write history under a `groupId` the device never
created a `groups` record for. Not a third-party spoof (the content is from the E2EE-verified
peer, and the tag is a local trust decision the joiner made by opening the link), and storage
under an orphan namespace is fairly harmless, but it is inconsistent with the `group-member-joined`
precedent set in `group-chats-GC2-iter1.md`. Consider mirroring the `getGroup(control.groupId)`
guard for consistency.

### 3. LOW — group conversation view leaves file-transfer/video-call controls live, routed to an arbitrary active peer

`client/js/app.js`, `openGroupConversation` only toggles visibility of `#chat-log` vs
`#group-chat-log`/`#group-conversation-heading` and re-points `btn-send`. The conversation screen's
other controls (start-call / toggle-camera / toggle-mic / file-select) remain enabled and continue
to act on `getActivePeer()` -- some background/last-active 1:1 peer unrelated to the open group.
Clicking them from a group view produces a confusing (not corrupting) action against the wrong
peer. UX/scope nit, not a data-integrity bug; flagging since GC3 is the section that first makes
"a group view sharing the 1:1 screen" reachable.

## Areas checked, no finding

- **Fan-out send (`sendGroupMessage`)** — filters `peer.groupId === groupId && peer.channel &&
  peer.sessionKey`; peers with a different or `null` groupId are correctly excluded; each `send` is
  in its own `try/catch` (best-effort, matches `broadcastGroupMemberJoined`). Exactly ONE
  `appendGroupChat` + ONE `appendMessage` per send action, after the loop (not per-recipient, not
  zero). Correct.
- **Anti-spoofing, static analysis (setting aside Finding 1's race)** — claimed `groupId` is
  checked against the connection's own tag via `getActivePeer().groupId`, never trusted from the
  body alone; type guards on `control.groupId`/`control.text`; verified `state.peerFingerprint`
  required. Joiner-side tagging (`invitedGroupId` from the `group=` param) is a purely LOCAL trust
  decision affecting only that one pairwise connection -- an attacker-crafted `group=` gains no
  access to any group the victim didn't opt into by opening that link.
- **History JSON round-trip (`openGroupConversation`)** — outbound rows stored as plain text and
  replayed directly; inbound rows JSON-parsed with a `try/catch` + structural check
  (`typeof parsed.body === "string"`) falling back to raw text + "unknown member" label. Malformed
  or legacy rows do not throw. (Minor: a structurally-valid JSON object lacking a string `body`
  renders the raw JSON string as the message body, but does not crash.)
- **`buildInviteLinkText` 1:1 invariant** — new `groupId` is a 3rd optional arg gated by
  `if (groupId)`; `copyInviteLink` passes only 2 args, so 1:1 link text is byte-for-byte unchanged.
- **UI routing / state leak** — `enterConversationLobby` resets `activeGroupId = null` and restores
  1:1 log visibility, and every 1:1 session-entry path routes through it, so a stale `activeGroupId`
  cannot misroute a 1:1 send to `sendGroupMessage`. `btn-send` branches on `activeGroupId`.
- **i18n** — `btn.openGroup`, `groups.chatHeading`, `groups.you`, `groups.unknownMember` added to
  all 11 locale blocks; all keys used are defined. No missing keys, no dead keys.
- **Helper references** — `ownerConnectionIdAtWireTime` (line 1808), `setDynamicText` (line 399),
  and the `state.senderKey` profileId convention (matches lines 1463/2990) all resolve correctly.

## Summary

One MEDIUM concurrency finding (the shared-global activeConnectionId rebind is not await-safe once
GC3 makes concurrent connections real) and two LOW consistency/UX findings. Fan-out correctness,
the static anti-spoofing gate, the JSON history round-trip, the 1:1 invite invariant, and i18n are
all sound.
