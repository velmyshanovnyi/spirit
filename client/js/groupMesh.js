// Section R2 (specs/phase5/app-decomposition.md, backlog A4): the GC4
// mesh-relay domain -- background pairwise connections established by
// relaying offer/answer through an existing verified same-group peer --
// extracted verbatim out of app.js's initApp() closure, continuing the
// G1/R1 dependency-injection pattern. `state` is the same mutable object
// app.js holds (state.peers / state.pendingMeshRelays /
// state.messageDispatchLock are shared fields, not copies). Only the four
// returned functions are consumed by app.js; wireMeshRelayChannelCallbacks
// is internal.
import {
  startAsInitiator,
  startAsJoiner,
  applyRemoteAnswer
} from "./webrtc.js";
import {
  generateEcdhKeyPair,
  exportEcdhPublicKeyForWire,
  importEcdhPublicKeyFromWire
} from "./identity.js";
import { deriveSessionKey, encryptMessage, decryptMessage } from "./e2ee.js";

export function initGroupMesh({
  state,
  handleChatMessage,
  randomConnectionId,
  createPeerEntry,
  getGroupPeerByFingerprint,
  makeEntryIdentityAnnouncer,
  currentRtcConfig,
  ensureLocalGroupRecord
}) {
  // Section GC4: connection-lifecycle wiring for a mesh-relay background
  // connection. Deliberately DOES NOT reuse wireChannelCallbacks: that
  // function gates its one-shot onChannelOpen callback on "is this still
  // the active connection" (state.activeConnectionId === ownerConnectionIdAtWireTime),
  // correct for GC0-GC3's one-foreground-handshake-at-a-time model but
  // wrong here -- a mesh-relay connection is established entirely in the
  // background and its ICE gathering can easily finish while some OTHER
  // connection (the user's foreground chat, or another concurrent mesh
  // attempt) is active, in which case that gate would silently DROP the
  // channel. This writes directly to the connectionId's own state.peers
  // entry instead, independent of activeConnectionId. Message dispatch
  // (onMessage) is the one part safe to route through the same
  // temporarily-rebind-then-restore technique wireChannelCallbacks already
  // uses, because it is fully serialized through state.messageDispatchLock
  // (GC3) -- no interleaving is possible there regardless of how many
  // background connections exist.
  function wireMeshRelayChannelCallbacks(connectionId, { afterChannelOpen } = {}) {
    return {
      onChannelOpen: (channel) => {
        const entry = state.peers.get(connectionId);
        if (!entry) return; // torn down before the channel finished opening
        entry.channel = channel;
        if (afterChannelOpen) afterChannelOpen();
      },
      onMessage: (payload) => {
        const task = state.messageDispatchLock.then(async () => {
          if (!state.peers.has(connectionId)) return;
          const previousActiveConnectionId = state.activeConnectionId;
          state.activeConnectionId = connectionId;
          try {
            const entry = state.peers.get(connectionId);
            if (!entry || !entry.sessionKey) return;
            const text = await decryptMessage(entry.sessionKey, payload);
            await handleChatMessage(text);
          } catch {
            // Background connection -- nothing upstream can surface a failure to.
          } finally {
            state.activeConnectionId = previousActiveConnectionId;
          }
        });
        state.messageDispatchLock = task.then(
          () => {},
          () => {}
        );
        return task;
      },
      onChannelClose: () => {
        const entry = state.peers.get(connectionId);
        if (entry) entry.channel = null;
      }
    };
  }

  // Section GC4: initiator side of a relayed mesh-connect attempt --
  // establishes a NEW background pairwise connection toward targetFingerprint
  // (a group member this device isn't directly connected to yet), routing
  // the offer/answer exchange through relayConnectionId (an existing,
  // already-verified same-groupId connection) instead of the signaling
  // server, since the signaling protocol only supports one pairwise room
  // per invite (GC0 finding) and no fresh out-of-band invite exists for
  // this pair. No ICE timeout is armed here (armIceTimeout writes to the
  // visible status bar -- inappropriate for a background attempt the user
  // never initiated directly); a stuck attempt just never completes.
  async function initiateMeshRelayConnect({ groupId, relayConnectionId, targetFingerprint }) {
    const relay = state.peers.get(relayConnectionId);
    if (!relay || !relay.channel || !relay.sessionKey) return; // relay path not usable right now

    const connectionId = randomConnectionId();
    const entry = createPeerEntry();
    entry.groupId = groupId;
    state.peers.set(connectionId, entry);

    const relayId = randomConnectionId();
    const ecdhKeyPair = await generateEcdhKeyPair();
    const announce = makeEntryIdentityAnnouncer(entry);
    state.pendingMeshRelays.set(relayId, { connectionId, ecdhKeyPair, announce });

    const rtcConfig = currentRtcConfig();
    entry.pc = startAsInitiator({
      rtcConfig,
      ...wireMeshRelayChannelCallbacks(connectionId, { afterChannelOpen: announce }),
      onLocalOfferReady: async (offerSdp) => {
        const currentRelay = state.peers.get(relayConnectionId);
        if (!currentRelay || !currentRelay.channel || !currentRelay.sessionKey) return; // relay vanished before the offer was ready
        try {
          const ecdhPubkeyWire = await exportEcdhPublicKeyForWire(ecdhKeyPair.publicKey);
          currentRelay.channel.send(
            await encryptMessage(
              currentRelay.sessionKey,
              JSON.stringify({
                type: "mesh-relay-offer",
                groupId,
                relayId,
                fromFingerprint: state.senderKey,
                toFingerprint: targetFingerprint,
                sdp: offerSdp,
                ecdhPubkey: ecdhPubkeyWire
              })
            )
          );
        } catch {
          // Best-effort, same philosophy as broadcastGroupMemberJoined.
        }
      }
    });
  }

  // Section GC4: transparent forwarding of a mesh-relay-offer/-answer NOT
  // addressed to this device -- re-encrypts the SAME control message body
  // under the target's own sessionKey without inspecting/decrypting the
  // wrapped SDP. Only ever forwards to an ALREADY-VERIFIED same-groupId
  // peer (peerFingerprint set post identity-announce) -- the security
  // invariant this whole section leans on: relaying only happens between
  // edges of the mesh graph that are already authenticated, so a
  // tampering relay is caught the same way a malicious signaling node
  // already is (identity-announce, docs/e2ee.md).
  async function relayGroupMeshMessage(control) {
    const target = getGroupPeerByFingerprint(control.groupId, control.toFingerprint);
    if (!target || !target.channel || !target.sessionKey) return; // no relay path -- best-effort, drop
    try {
      target.channel.send(await encryptMessage(target.sessionKey, JSON.stringify(control)));
    } catch {
      // Best-effort forwarding, same philosophy as broadcastGroupMemberJoined.
    }
  }

  // Section GC4: responder side -- a brand-new mesh-connect request
  // relayed to me. Only handled in permanent-profile mode (ephemeral mode
  // has no persisted groups to mesh into) and only if this device isn't
  // already mesh-connected to the requester under this groupId (avoids a
  // duplicate connection if the same offer is somehow relayed twice).
  async function handleIncomingMeshRelayOffer(control, relayConnectionId) {
    if (!state.identityKeyPair || !state.identityKeyPair.vaultKey) return;
    const group = await ensureLocalGroupRecord(control.groupId);
    if (!group) return;
    if (getGroupPeerByFingerprint(control.groupId, control.fromFingerprint)) return;

    const connectionId = randomConnectionId();
    const entry = createPeerEntry();
    entry.groupId = control.groupId;
    state.peers.set(connectionId, entry);

    const ecdhKeyPair = await generateEcdhKeyPair();
    const announce = makeEntryIdentityAnnouncer(entry);
    const rtcConfig = currentRtcConfig();
    entry.pc = startAsJoiner({
      rtcConfig,
      offerSdp: control.sdp,
      ...wireMeshRelayChannelCallbacks(connectionId, { afterChannelOpen: announce }),
      onLocalAnswerReady: async (answerSdp) => {
        try {
          const ecdhPubkeyWire = await exportEcdhPublicKeyForWire(ecdhKeyPair.publicKey);
          const peerEcdhPubkey = await importEcdhPublicKeyFromWire(control.ecdhPubkey);
          entry.sessionEcdhWires = { localEcdhWire: ecdhPubkeyWire, peerEcdhWire: control.ecdhPubkey };
          entry.sessionKey = await deriveSessionKey(ecdhKeyPair.privateKey, peerEcdhPubkey);

          // relayConnectionId was captured (via getActivePeer() at dispatch
          // time, synchronously, before any await) by the handleChatMessage
          // branch that called this function -- NOT re-read from
          // state.activeConnectionId here, which by this point (after the
          // awaits above) could easily point at a completely different
          // connection.
          const relayPeer = state.peers.get(relayConnectionId);
          if (!relayPeer || !relayPeer.channel || !relayPeer.sessionKey) return;
          try {
            relayPeer.channel.send(
              await encryptMessage(
                relayPeer.sessionKey,
                JSON.stringify({
                  type: "mesh-relay-answer",
                  groupId: control.groupId,
                  relayId: control.relayId,
                  fromFingerprint: state.senderKey,
                  toFingerprint: control.fromFingerprint,
                  sdp: answerSdp,
                  ecdhPubkey: ecdhPubkeyWire
                })
              )
            );
          } catch {
            // Best-effort, same philosophy as broadcastGroupMemberJoined.
          }
          await announce();
        } catch {
          // Best-effort background handshake.
        }
      }
    });
  }

  // Section GC4: initiator side completion -- an incoming mesh-relay-answer
  // matched back to the pending attempt by relayId.
  async function handleIncomingMeshRelayAnswer(control) {
    const pending = state.pendingMeshRelays.get(control.relayId);
    if (!pending) return; // unknown/stale relayId -- drop
    state.pendingMeshRelays.delete(control.relayId);
    const entry = state.peers.get(pending.connectionId);
    if (!entry || !entry.pc) return; // torn down already
    try {
      await applyRemoteAnswer(entry.pc, control.sdp);
      const peerEcdhPubkey = await importEcdhPublicKeyFromWire(control.ecdhPubkey);
      const ecdhPubkeyWire = await exportEcdhPublicKeyForWire(pending.ecdhKeyPair.publicKey);
      entry.sessionEcdhWires = { localEcdhWire: ecdhPubkeyWire, peerEcdhWire: control.ecdhPubkey };
      entry.sessionKey = await deriveSessionKey(pending.ecdhKeyPair.privateKey, peerEcdhPubkey);
      await pending.announce();
    } catch {
      // Best-effort background handshake.
    }
  }

  return {
    initiateMeshRelayConnect,
    relayGroupMeshMessage,
    handleIncomingMeshRelayOffer,
    handleIncomingMeshRelayAnswer
  };
}
