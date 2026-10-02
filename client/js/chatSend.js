// Section R9 (specs/phase5/app-decomposition.md, backlog A4): chat sending
// -- one ratchet-encrypted send with history write (sendSingleChatMessage),
// the offline/reconnect queue drain (flushPendingOutgoingMessages), the
// 1:1 send path with queueing (sendChatMessage) and the group fan-out
// (sendGroupMessage) -- extracted verbatim out of app.js's initApp()
// closure, continuing the G1/R1-R8 dependency-injection pattern. `state` is
// the same mutable object app.js holds (pendingOutgoingMessages, channel,
// sessionKey, peers, identityKeyPair, senderKey, peerFingerprint).
// nextSendMessageKey stays in app.js (it owns the ratchet chain state) and
// is injected. app.js consumes the three returned functions.
import { encryptMessage } from "./e2ee.js";
import { encodeRatchetPayload } from "./ratchetChain.js";
import { appendMessage } from "./historyStore.js";

export function initChatSend({
  el, t, state, setStatus, setVideoStatus, setDynamicText,
  appendChat, appendGroupChat, clearPendingBadge, nextSendMessageKey
}) {
  // Section RF9: actually encrypts+transmits ONE message over the current
  // channel and persists it to history -- shared by the immediate-send
  // path and the queue drain, so both go through the exact same ratchet
  // (nextSendMessageKey) and history-write sequence. `row` (if given) is
  // the already-rendered bubble from when the message was first queued;
  // its pending badge is cleared once the send actually succeeds.
  async function sendSingleChatMessage(text, sentAt, row) {
    const { messageKey, index } = await nextSendMessageKey();
    // Section P2c: a null index means serializedChainStep saw the active
    // connection change mid-step and did NOT advance the chain -- there is no
    // valid position on the wire for this message. Throwing keeps it queued
    // (flushPendingOutgoingMessages leaves the item in place) instead of
    // emitting an "R2:null:" header the peer can only reject.
    if (index === null) throw new Error("connection changed while preparing the message");
    const payload = encodeRatchetPayload(index, await encryptMessage(messageKey, text));
    state.channel.send(payload);
    clearPendingBadge(row);
    if (state.identityKeyPair && state.identityKeyPair.vaultKey && state.peerFingerprint) {
      await appendMessage(state.identityKeyPair.vaultKey, state.senderKey, state.peerFingerprint, {
        direction: "out",
        text,
        timestamp: sentAt
      });
    }
  }

  // Drains state.pendingOutgoingMessages in order (FIFO -- ratchet key
  // derivation is sequential/stateful, so these cannot send out of order
  // or in parallel) the moment a channel + session key are both available
  // again -- called from onChannelOpen (Section RF9) and after session-key
  // derivation completes, since either can finish before the other.
  async function flushPendingOutgoingMessages() {
    if (!state.channel || !state.sessionKey) return;
    while (state.pendingOutgoingMessages.length > 0) {
      const item = state.pendingOutgoingMessages[0];
      try {
        await sendSingleChatMessage(item.text, item.timestamp, item.row);
        state.pendingOutgoingMessages.shift();
      } catch (err) {
        // Leaves this item (and everything behind it) queued -- a transient
        // failure here must not silently drop a message the user already
        // saw appear in their own chat log.
        setVideoStatus(t("status.error", { msg: err.message }));
        return;
      }
    }
    const sendStatus = el("chat-send-status");
    if (sendStatus) sendStatus.hidden = true;
  }

  async function sendChatMessage() {
    const text = el("message-input").value;
    el("message-input").value = "";
    const sentAt = Date.now();
    const hasConnection = !!(state.channel && state.sessionKey);
    const row = appendChat(text, "out", sentAt, false, !hasConnection);
    if (!hasConnection) {
      // Section RF9 (bug report follow-up): queue instead of dropping --
      // sent the moment a peer connects (or reconnects after an unstable
      // drop; onChannelClose nulls state.channel so this same path covers
      // both "never connected yet" and "was connected, then wasn't").
      state.pendingOutgoingMessages.push({ text, timestamp: sentAt, row });
      setStatus(t("status.noActiveConnection"));
      const sendStatus = el("chat-send-status");
      if (sendStatus) {
        setDynamicText(sendStatus, t("chat.queuedStatus"));
        sendStatus.hidden = false;
      }
      return;
    }
    el("chat-send-status")?.setAttribute("hidden", "");
    await sendSingleChatMessage(text, sentAt, row);
  }

  /**
   * Section GC3 (specs/phase4/group-chats.md), design point 3: fan-out send
   * -- the SAME plaintext is independently encrypted (existing encryptMessage,
   * static sessionKey, NOT the ratchet chain -- same precedent as file
   * transfer's control-message-style encryption, FT2) and sent to EVERY
   * state.peers entry tagged with this groupId that currently has a live
   * channel + sessionKey. Star/tree invite topology (GC2's own scope
   * decision): this reaches only whichever group members this device
   * happens to be directly connected to right now, not the full group.
   * Exactly ONE local append/UI-render call happens here, regardless of how
   * many recipients were sent to -- the user sees "sent" once, not once per
   * peer.
   */
  async function sendGroupMessage(groupId, text) {
    const recipients = [...state.peers.values()].filter((peer) => peer.groupId === groupId && peer.channel && peer.sessionKey);
    for (const peer of recipients) {
      try {
        peer.channel.send(await encryptMessage(peer.sessionKey, JSON.stringify({ type: "group-message", groupId, text })));
      } catch {
        // Best-effort fan-out, same philosophy as broadcastGroupMemberJoined
        // (GC2) -- one recipient's send failure must not block the others.
      }
    }
    const sentAt = Date.now();
    appendGroupChat(text, "out", null, sentAt);
    // Profile mode only (Section 14 precedent) -- ephemeral mode has no
    // vault to persist into. Stored under groupId as the "contactId"
    // namespace -- historyStore.js accepts any string key unchanged (GC1).
    if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
      await appendMessage(state.identityKeyPair.vaultKey, state.senderKey, groupId, {
        direction: "out",
        text,
        timestamp: sentAt
      });
    }
  }

  return { sendChatMessage, sendGroupMessage, flushPendingOutgoingMessages };
}
