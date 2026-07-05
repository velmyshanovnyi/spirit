import {
  generateIdentityKeyPair,
  generateEcdhKeyPair,
  fingerprint,
  exportEcdhPublicKeyForWire,
  importEcdhPublicKeyFromWire
} from "./identity.js";
import { startAsInitiator, startAsJoiner, applyRemoteAnswer } from "./webrtc.js";
import { createInvite, createOffer, getOffer, submitAnswer, pollForAnswer } from "./signalingClient.js";
import { deriveSessionKey, encryptMessage, decryptMessage } from "./e2ee.js";
import { promptGoogleSignIn, verifyGoogleIdToken } from "./googleOAuth.js";

const DEFAULT_ICE_TIMEOUT_MS = 15000;
const DEFAULT_ANSWER_WAIT_TIMEOUT_MS = 5 * 60 * 1000; // matches the signaling node's default session TTL

export function initApp(doc, { iceTimeoutMs = DEFAULT_ICE_TIMEOUT_MS, answerWaitTimeoutMs = DEFAULT_ANSWER_WAIT_TIMEOUT_MS } = {}) {
  const state = {
    identityKeyPair: null,
    senderKey: null,
    pc: null,
    channel: null,
    sessionKey: null
  };

  const el = (id) => doc.getElementById(id);
  const setStatus = (text) => {
    el("connection-status").textContent = text;
  };
  const setGoogleStatus = (text) => {
    el("google-verify-status").textContent = text;
  };
  const appendChat = (text) => {
    el("chat-log").textContent += text + "\n";
  };

  function armIceTimeout() {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) setStatus("не вдалося зібрати ICE-кандидати (тайм-аут)");
    }, iceTimeoutMs);
    return () => {
      settled = true;
      clearTimeout(timeoutId);
    };
  }

  function wireChannelCallbacks(disarmIceTimeout) {
    return {
      onChannelOpen: (channel) => {
        state.channel = channel;
        setStatus("з'єднано");
      },
      onMessage: async (payload) => {
        if (!state.sessionKey) return; // message arrived before session key derived; drop rather than throw
        const text = await decryptMessage(state.sessionKey, payload);
        appendChat(text);
      },
      onChannelClose: () => setStatus("з'єднання закрито"),
      onError: (err) => {
        disarmIceTimeout(); // the local-description IIFE failed before onLocalOfferReady/onLocalAnswerReady
        // could ever fire to disarm it itself -- without this the stale ICE timeout
        // would later overwrite this real error with a misleading timeout message.
        setStatus(`помилка: ${err.message}`);
      }
    };
  }

  function withBusyButton(button, handler) {
    button.addEventListener("click", async () => {
      if (button.disabled) return; // re-entrancy guard against double-click
      button.disabled = true;
      try {
        await handler();
      } catch (err) {
        setStatus(`помилка: ${err.message}`);
      } finally {
        button.disabled = false;
      }
    });
  }

  el("btn-generate").addEventListener("click", async () => {
    state.identityKeyPair = await generateIdentityKeyPair();
    state.senderKey = await fingerprint(state.identityKeyPair.publicKey);
    el("pub-key-display").textContent = state.senderKey;
  });

  withBusyButton(el("btn-google-verify"), async () => {
    if (!state.senderKey) {
      setGoogleStatus("спочатку створіть акаунт");
      return;
    }
    const clientId = el("google-client-id").value;
    if (!clientId) {
      setGoogleStatus("вкажіть Google Client ID");
      return;
    }
    // Snapshotted once so the nonce used to start the Google prompt and the
    // nonce checked at verification time are provably the same value, even
    // if the user re-generates an account (changing state.senderKey) while
    // the popup is open -- matches the pattern already used in btn-initiate.
    const senderKey = state.senderKey;
    try {
      // The identity fingerprint doubles as the OIDC nonce, cryptographically
      // binding the returned ID token to this specific identity key
      // (docs/oauth-verification.md).
      const idToken = await promptGoogleSignIn({ clientId, nonce: senderKey });
      const claims = await verifyGoogleIdToken(idToken, { expectedNonce: senderKey, expectedAudience: clientId });
      setGoogleStatus(`Підтверджено через Google: ${claims.email}`);
    } catch (err) {
      setGoogleStatus(`помилка: ${err.message}`);
    }
  });

  withBusyButton(el("btn-initiate"), async () => {
    if (!state.senderKey) {
      setStatus("спочатку створіть акаунт");
      return;
    }
    const serverUrl = el("server-url").value;
    const stunUrl = el("stun-url").value;
    const rtcConfig = { iceServers: [{ urls: stunUrl }] };
    const senderKey = state.senderKey;

    const ecdhKeyPair = await generateEcdhKeyPair();
    const { roomId, inviteToken } = await createInvite(serverUrl, senderKey);
    el("room-id").value = roomId;
    el("invite-token").value = inviteToken;

    const disarmIceTimeout = armIceTimeout();

    state.pc = startAsInitiator({
      rtcConfig,
      ...wireChannelCallbacks(disarmIceTimeout),
      onLocalOfferReady: async (offerSdp) => {
        disarmIceTimeout();
        try {
          const ecdhPubkey = await exportEcdhPublicKeyForWire(ecdhKeyPair.publicKey);
          await createOffer(serverUrl, {
            senderKey,
            roomId,
            inviteToken,
            sdpData: JSON.stringify(offerSdp),
            ecdhPubkey
          });

          setStatus("очікування відповіді співрозмовника...");
          const answerWaitController = new AbortController();
          const answerWaitTimeoutId = setTimeout(() => answerWaitController.abort(), answerWaitTimeoutMs);
          let answer, peerEcdhPubkeyWire;
          try {
            ({ answer, ecdhPubkey: peerEcdhPubkeyWire } = await pollForAnswer(
              serverUrl,
              { senderKey, roomId },
              { signal: answerWaitController.signal }
            ));
          } finally {
            clearTimeout(answerWaitTimeoutId);
          }

          await applyRemoteAnswer(state.pc, JSON.parse(answer));
          const peerEcdhPubkey = await importEcdhPublicKeyFromWire(peerEcdhPubkeyWire);
          state.sessionKey = await deriveSessionKey(ecdhKeyPair.privateKey, peerEcdhPubkey);
        } catch (err) {
          setStatus(`помилка: ${err.message}`);
        }
      }
    });
  });

  withBusyButton(el("btn-join"), async () => {
    if (!state.senderKey) {
      setStatus("спочатку створіть акаунт");
      return;
    }
    const serverUrl = el("server-url").value;
    const stunUrl = el("stun-url").value;
    const roomId = el("room-id").value;
    const inviteToken = el("invite-token").value;
    const rtcConfig = { iceServers: [{ urls: stunUrl }] };
    const senderKey = state.senderKey;

    const ecdhKeyPair = await generateEcdhKeyPair();
    const { offer, ecdhPubkey: peerEcdhPubkeyWire } = await getOffer(serverUrl, { senderKey, roomId, inviteToken });

    const disarmIceTimeout = armIceTimeout();

    state.pc = startAsJoiner({
      rtcConfig,
      offerSdp: JSON.parse(offer),
      ...wireChannelCallbacks(disarmIceTimeout),
      onLocalAnswerReady: async (answerSdp) => {
        disarmIceTimeout();
        try {
          const ecdhPubkey = await exportEcdhPublicKeyForWire(ecdhKeyPair.publicKey);
          await submitAnswer(serverUrl, {
            senderKey,
            roomId,
            inviteToken,
            sdpData: JSON.stringify(answerSdp),
            ecdhPubkey
          });
          const peerEcdhPubkey = await importEcdhPublicKeyFromWire(peerEcdhPubkeyWire);
          state.sessionKey = await deriveSessionKey(ecdhKeyPair.privateKey, peerEcdhPubkey);
        } catch (err) {
          setStatus(`помилка: ${err.message}`);
        }
      }
    });
  });

  el("btn-send").addEventListener("click", async () => {
    if (!state.channel || !state.sessionKey) {
      setStatus("немає активного з'єднання");
      return;
    }
    const text = el("message-input").value;
    const payload = await encryptMessage(state.sessionKey, text);
    state.channel.send(payload);
    el("message-input").value = "";
  });
}
