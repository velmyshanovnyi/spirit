// Section C3 (specs/phase5/core-dispatch.md, backlog A4): the group-chat
// receiving side -- the group-member-joined / group-message / mesh-relay-*
// control handlers plus the two helpers both the identity-announce core
// and groupMesh.js keep using (ensureLocalGroupRecord,
// broadcastGroupMemberJoined) -- extracted verbatim out of app.js's
// initApp() closure. `state` is the same mutable object app.js holds. The
// four mesh primitives are consts created by initGroupMesh AFTER this
// module is initialized (it needs our ensureLocalGroupRecord), so they
// arrive as lazy thunks that are only ever invoked from a message.
import { formatSpiritId } from "./spiritId.js";
import { getContact } from "./contacts.js";
import { getGroup, ensureGroupBootstrap, updateGroupMembers } from "./groups.js";
import { appendMessage } from "./historyStore.js";
import { encryptMessage } from "./e2ee.js";

export function initGroupChatHandlers({
  t, state, getActivePeer, appendGroupChat, noteIncomingForDrawer,
  initiateMeshRelayConnect, relayGroupMeshMessage, handleIncomingMeshRelayOffer, handleIncomingMeshRelayAnswer
}) {
  // Section GC2: best-effort fan-out of "a new member joined group X" to
  // every OTHER state.peers entry tagged with the same groupId that
  // currently has a live channel + sessionKey. Star/tree invite topology
  // (spec's own scope-narrowing, 2026-07-18): this does NOT reach every
  // group member, only whoever this device happens to be directly
  // connected to right now -- consistent with the existing device-list/
  // recovery-share "announce to whoever is there" philosophy. Never
  // throws: a send failure on one peer must not stop the others from
  // being notified, and having zero other same-group peers connected
  // (the common case for a freshly created group) is not an error.
  async function broadcastGroupMemberJoined(groupId, memberFingerprint, memberNickname) {
    const joinedConnectionId = state.activeConnectionId;
    for (const [connectionId, peer] of state.peers) {
      if (connectionId === joinedConnectionId) continue; // skip the connection that just joined
      if (peer.groupId !== groupId) continue;
      if (!peer.channel || !peer.sessionKey) continue; // half-open/half-torn-down -- nothing to send on
      try {
        peer.channel.send(
          await encryptMessage(peer.sessionKey, JSON.stringify({
            type: "group-member-joined",
            groupId,
            memberFingerprint,
            memberNickname
          }))
        );
      } catch {
        // Best-effort broadcast -- one peer's send failure must not block
        // notifying the rest.
      }
    }
  }

  // Section GC4 fix: a device that only ever JOINED a group via an invite
  // (never called createGroup itself) had no local groups.js record at all
  // -- getGroup(groupId) always returns undefined for it on a real separate
  // device, which silently starved every receiving-side group gate below
  // (group-message, group-member-joined, mesh-relay-offer) of a group to
  // attach to. This bootstraps a minimal local record -- name is a
  // placeholder (the real chosen name is never transmitted to a plain
  // joiner; deliberately not introducing a new control message for this,
  // per the scope agreed with the user) -- the first time any of those
  // gates would otherwise find nothing. Membership starts as just [self,
  // the connected peer] and grows correctly afterward via the existing
  // updateGroupMembers calls once real roster data arrives.
  async function ensureLocalGroupRecord(groupId) {
    const existing = await getGroup(groupId);
    if (existing) return existing;
    return ensureGroupBootstrap(groupId, {
      name: t("groups.bootstrapNameFallback"),
      memberFingerprints: [state.senderKey, state.peerFingerprint].filter(Boolean)
    });
  }

  async function onGroupMemberJoined(control) {
    // Section GC2 trust gate -- same shape as every other *-announce:
    // meaningless before THIS connection's own peer identity is verified,
    // pointless in ephemeral mode (nothing persists). On top of that,
    // this control message makes a claim about a THIRD party (not the
    // sender itself), so two more checks are required before trusting it:
    // (1) the connection it arrived on must actually be tagged with the
    // groupId being claimed -- a peer cannot inject membership for a
    // group it was never invited into via a mismatched/forged groupId;
    // (2) a local record for this group must exist -- ensureLocalGroupRecord
    // (Section GC4 fix) bootstraps a minimal one if this device only ever
    // joined via invite and never had its own copy, rather than silently
    // dropping every group-scoped message the way the old getGroup-only
    // gate did.
    if (!state.peerFingerprint || !state.identityKeyPair || !state.identityKeyPair.vaultKey) return;
    if (typeof control.groupId !== "string" || typeof control.memberFingerprint !== "string") return;
    const activePeerEntry = getActivePeer();
    if (!activePeerEntry || activePeerEntry.groupId !== control.groupId) return;
    const group = await ensureLocalGroupRecord(control.groupId);
    if (!group) return;
    if (!group.memberFingerprints.includes(control.memberFingerprint)) {
      await updateGroupMembers(control.groupId, [...group.memberFingerprints, control.memberFingerprint]);
      // Section GC4: this is the FIRST time this device has heard of
      // memberFingerprint in this group -- auto-start a relayed
      // mesh-connect toward them through the very connection this
      // notice arrived on (guaranteed already connected to both sides).
      // Only "old" members ever reach this branch, since a brand-new
      // joiner never retroactively receives group-member-joined about
      // pre-existing members (broadcastGroupMemberJoined only notifies
      // the OTHER already-connected peers, never the joiner itself) --
      // so there is no symmetric race needing a tie-break here.
      if (control.memberFingerprint !== state.senderKey) {
        void initiateMeshRelayConnect({
          groupId: control.groupId,
          relayConnectionId: state.activeConnectionId,
          targetFingerprint: control.memberFingerprint
        });
      }
    }
    return;
  }

  async function onGroupMessage(control) {
    // Section GC3 design point 4: unlike plain 1:1 chat text (which isn't
    // wrapped in JSON at all), group messages are explicitly typed so
    // they can be told apart from 1:1 text arriving on the SAME
    // connection (a groupId-tagged connection can still technically
    // receive any control type). Same trust gate as every other
    // control-type: this connection's own peer identity must already be
    // verified. On top of that -- same anti-spoofing principle as
    // group-member-joined above -- the claimed groupId must match what
    // THIS connection was actually tagged with, never trusted from the
    // message body alone; a peer on a DIFFERENT (or untagged) connection
    // cannot inject messages into a group it wasn't invited into via that
    // connection.
    if (!state.peerFingerprint) return;
    if (typeof control.groupId !== "string" || typeof control.text !== "string") return;
    const activeGroupPeerEntry = getActivePeer();
    if (!activeGroupPeerEntry || activeGroupPeerEntry.groupId !== control.groupId) return;
    let senderLabel = formatSpiritId(state.peerFingerprint);
    // GC3 exec-review iter1 finding: profile mode only (ephemeral mode has
    // no group storage at all -- GC1's groups.js is only ever populated
    // via the profile-mode UI paths). ensureLocalGroupRecord (Section GC4
    // fix) bootstraps a local record if this device only ever joined via
    // invite -- previously this used getGroup directly and silently
    // dropped every group message for anyone but the original creator.
    if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
      const group = await ensureLocalGroupRecord(control.groupId);
      if (!group) return;
      const senderContact = await getContact(state.peerFingerprint);
      if (senderContact?.nickname) senderLabel = senderContact.nickname;
    }
    const receivedAt = Date.now();
    // Rendered into the GROUP-specific container (#group-chat-log), never
    // the 1:1 #chat-log -- tagged with the sender's identity, since a
    // group conversation shows who said what (unlike 1:1 chat where the
    // peer is implicit).
    appendGroupChat(control.text, "in", senderLabel, receivedAt);
    noteIncomingForDrawer();
    // Profile mode only (ephemeral has no vault). Sender attribution is
    // embedded in the stored `text` itself (JSON-encoded) since
    // historyStore.js's schema is deliberately unchanged (GC1) -- it only
    // ever stored direction/text/timestamp.
    if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
      await appendMessage(state.identityKeyPair.vaultKey, state.senderKey, control.groupId, {
        direction: "in",
        text: JSON.stringify({ senderFingerprint: state.peerFingerprint, senderNickname: senderLabel, body: control.text }),
        timestamp: receivedAt
      });
    }
    return;
  }

  async function onMeshRelay(control) {
    // Section GC4: same anti-spoofing gate as group-member-joined/
    // group-message -- the claimed groupId must match what THIS
    // connection was actually tagged with, and identity on this
    // connection must already be verified (a relay path is only ever
    // an already-authenticated same-groupId edge).
    if (!state.peerFingerprint) return;
    if (
      typeof control.groupId !== "string" ||
      typeof control.toFingerprint !== "string" ||
      typeof control.fromFingerprint !== "string"
    ) {
      return;
    }
    const activeMeshPeerEntry = getActivePeer();
    if (!activeMeshPeerEntry || activeMeshPeerEntry.groupId !== control.groupId) return;
    if (control.toFingerprint !== state.senderKey) {
      await relayGroupMeshMessage(control);
      return;
    }
    if (control.type === "mesh-relay-offer") {
      await handleIncomingMeshRelayOffer(control, state.activeConnectionId);
    } else {
      await handleIncomingMeshRelayAnswer(control);
    }
    return;
  }

  const groupControlHandlers = {
    "group-member-joined": onGroupMemberJoined,
    "group-message": onGroupMessage,
    "mesh-relay-offer": onMeshRelay,
    "mesh-relay-answer": onMeshRelay
  };
  return { groupControlHandlers, ensureLocalGroupRecord, broadcastGroupMemberJoined };
}
