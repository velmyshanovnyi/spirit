import {
  generateIdentityKeyPair,
  generateEcdhKeyPair,
  fingerprint,
  exportEcdhPublicKeyForWire,
  importEcdhPublicKeyFromWire,
  exportPrivateKeyScalar,
  exportPrivateKeyRaw
} from "./identity.js";
import { createPermanentProfile, exportRawIdentity } from "./profile.js";
import { bytesToMnemonic } from "./mnemonic.js";
import { createKeyfile } from "./keyfile.js";
import {
  generateDeviceKeyPair,
  createLinkRequest,
  createLinkGrant,
  applyLinkGrant,
  appendDeviceToList,
  acceptNewerDeviceList
} from "./deviceLinking.js";
import { listKeys, get, put } from "./db.js";
import { createIdentityAnnounce, verifyIdentityAnnounce } from "./identityAnnounce.js";
import { rememberContact, getContact, updateContactDeviceList } from "./contacts.js";
import { appendMessage, listMessages } from "./historyStore.js";

const OWN_DEVICE_LIST_KEY = "deviceList";
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
    sessionKey: null,
    // Set by the session helpers just before the session key is derived;
    // needed to bind/verify identity announces to THIS session's ECDH keys.
    sessionEcdhWires: null,
    // Fingerprint of the peer's VERIFIED identity (null until a valid
    // announce arrives; incoming chat text is refused while null).
    peerFingerprint: null,
    // The verified peer identity key -- device-list announces are checked
    // against it (Section 13).
    peerIdentityPublicKey: null
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

  const CONTROL_MESSAGE_TYPES = new Set(["identity-announce", "device-list-announce"]);

  /**
   * Default handler for decrypted chat-channel messages. Control messages
   * (JSON with a known type) are routed; everything else is chat text --
   * refused until the peer has proven its identity via a valid announce
   * (TOFU, Section 12).
   */
  async function handleChatMessage(text) {
    let control = null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && CONTROL_MESSAGE_TYPES.has(parsed.type)) {
        control = parsed;
      }
    } catch {
      // not JSON -- plain chat text
    }

    if (!control) {
      if (!state.peerFingerprint) {
        setStatus("вхідне повідомлення відхилено: identity співрозмовника не підтверджена");
        return;
      }
      appendChat(text);
      if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
        await appendMessage(state.identityKeyPair.vaultKey, state.peerFingerprint, {
          direction: "in",
          text,
          timestamp: Date.now()
        });
      }
      return;
    }

    if (control.type === "identity-announce") {
      const verified = await verifyIdentityAnnounce(
        control,
        state.sessionEcdhWires.localEcdhWire,
        state.sessionEcdhWires.peerEcdhWire
      );
      if (!verified) {
        setStatus("⚠ не вдалося підтвердити identity співрозмовника");
        return;
      }
      state.peerFingerprint = verified.fingerprint;
      state.peerIdentityPublicKey = verified.identityPublicKey;
      let continuity = "";
      // Persist the contact only in permanent-profile mode (the vault key's
      // presence is what distinguishes it) -- ephemeral sessions store nothing.
      if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
        const { status } = await rememberContact({
          fingerprint: verified.fingerprint,
          identityPubkeyWire: verified.identityPubkeyWire
        });
        continuity = status === "known" ? " (відомий контакт)" : " (новий контакт)";
      }
      setStatus(`співрозмовник підтверджений: ${verified.fingerprint}${continuity}`);
      // Known contact in profile mode: bring the prior conversation back
      // into the chat log before any new messages arrive.
      if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
        const history = await listMessages(state.identityKeyPair.vaultKey, verified.fingerprint);
        for (const entry of history) {
          appendChat(`${entry.direction === "out" ? "→" : "←"} ${entry.text}`);
        }
      }
      return;
    }

    if (control.type === "device-list-announce") {
      // Meaningless before the peer proved its identity (nothing to verify
      // the list against), and pointless in ephemeral mode (nothing persists).
      if (!state.peerFingerprint || !state.identityKeyPair || !state.identityKeyPair.vaultKey) return;
      const contact = await getContact(state.peerFingerprint);
      const heldList = contact ? contact.deviceList : null;
      const accepted = await acceptNewerDeviceList(state.peerIdentityPublicKey, heldList, control.list);
      if (accepted !== heldList) {
        await updateContactDeviceList(state.peerFingerprint, accepted);
      }
    }
  }

  /**
   * One-shot announce sender for chat flows: fires once the channel is open
   * AND the session key + ECDH wires exist, whichever completes last.
   */
  function makeIdentityAnnouncer() {
    let announced = false;
    return async () => {
      if (announced || !state.channel || !state.sessionKey || !state.sessionEcdhWires) return;
      announced = true;
      try {
        const announce = await createIdentityAnnounce(
          state.identityKeyPair.privateKey,
          state.identityKeyPair.publicKey,
          state.sessionEcdhWires.localEcdhWire,
          state.sessionEcdhWires.peerEcdhWire
        );
        state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify(announce)));
        // Follow up with the own device list, if this profile maintains one --
        // the peer verifies it against the identity just announced.
        const ownDeviceList = await get("profile", OWN_DEVICE_LIST_KEY);
        if (ownDeviceList) {
          state.channel.send(
            await encryptMessage(state.sessionKey, JSON.stringify({ type: "device-list-announce", list: ownDeviceList }))
          );
        }
      } catch (err) {
        setStatus(`помилка: ${err.message}`); // afterChannelOpen path is detached; nothing upstream catches
      }
    };
  }

  function wireChannelCallbacks(disarmIceTimeout, { onDecryptedMessage = handleChatMessage, afterChannelOpen } = {}) {
    return {
      onChannelOpen: (channel) => {
        state.channel = channel;
        setStatus("з'єднано");
        if (afterChannelOpen) afterChannelOpen();
      },
      onMessage: async (payload) => {
        if (!state.sessionKey) return; // message arrived before session key derived; drop rather than throw
        try {
          const text = await decryptMessage(state.sessionKey, payload);
          await onDecryptedMessage(text);
        } catch (err) {
          // This callback runs detached from any button handler, so nothing
          // upstream can catch a rejection here.
          setStatus(`помилка: ${err.message}`);
        }
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

  // Signaling sender_key for the device-linking flows: an opaque one-off
  // identifier, NOT the identity fingerprint -- the new device has no
  // identity yet, and the primary has no reason to announce its identity to
  // the signaling node just to hand it over inside the E2EE channel.
  function randomSenderKey() {
    return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function snapshotContacts() {
    const keys = await listKeys("contacts");
    return Promise.all(keys.map(async (key) => ({ key, value: await get("contacts", key) })));
  }

  /**
   * The initiator handshake shared by "Ініціювати чат" and "Прив'язати
   * пристрій": ICE gathering -> publish offer -> wait for answer -> derive
   * the E2EE session key. Behavior for the chat path is byte-for-byte what
   * it was before this was extracted.
   */
  function startInitiatorSession({ senderKey, ecdhKeyPair, roomId, inviteToken, serverUrl, rtcConfig, channelOptions, onSessionReady }) {
    const disarmIceTimeout = armIceTimeout();

    state.pc = startAsInitiator({
      rtcConfig,
      ...wireChannelCallbacks(disarmIceTimeout, channelOptions),
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
          state.sessionEcdhWires = { localEcdhWire: ecdhPubkey, peerEcdhWire: peerEcdhPubkeyWire };
          state.sessionKey = await deriveSessionKey(ecdhKeyPair.privateKey, peerEcdhPubkey);
          if (onSessionReady) await onSessionReady();
        } catch (err) {
          setStatus(`помилка: ${err.message}`);
        }
      }
    });
  }

  /**
   * The joiner handshake shared by "Приєднатися до чату" and "Приєднати цей
   * пристрій": fetch offer -> answer -> derive the E2EE session key.
   */
  async function startJoinerSession({ senderKey, roomId, inviteToken, serverUrl, rtcConfig, channelOptions, onSessionReady }) {
    const ecdhKeyPair = await generateEcdhKeyPair();
    const { offer, ecdhPubkey: peerEcdhPubkeyWire } = await getOffer(serverUrl, { senderKey, roomId, inviteToken });

    const disarmIceTimeout = armIceTimeout();

    state.pc = startAsJoiner({
      rtcConfig,
      offerSdp: JSON.parse(offer),
      ...wireChannelCallbacks(disarmIceTimeout, channelOptions),
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
          state.sessionEcdhWires = { localEcdhWire: ecdhPubkey, peerEcdhWire: peerEcdhPubkeyWire };
          state.sessionKey = await deriveSessionKey(ecdhKeyPair.privateKey, peerEcdhPubkey);
          if (onSessionReady) await onSessionReady();
        } catch (err) {
          setStatus(`помилка: ${err.message}`);
        }
      }
    });
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

  const setProfileStatus = (text) => {
    el("profile-status").textContent = text;
  };

  el("btn-create-profile").addEventListener("click", () => {
    el("profile-setup").hidden = false;
  });

  withBusyButton(el("btn-profile-confirm"), async () => {
    const passphrase = el("profile-passphrase").value;
    if (!passphrase) {
      setProfileStatus("вкажіть passphrase для профілю");
      return;
    }
    state.identityKeyPair = await createPermanentProfile(passphrase);
    // Don't keep the secret sitting in a DOM input after it's been used.
    el("profile-passphrase").value = "";
    state.senderKey = await fingerprint(state.identityKeyPair.publicKey);
    el("pub-key-display").textContent = state.senderKey;
    setProfileStatus("");
    el("backup-step").hidden = false;
  });

  withBusyButton(el("btn-backup-mnemonic"), async () => {
    const scalar = await exportPrivateKeyScalar(state.identityKeyPair.privateKey);
    const words = await bytesToMnemonic(scalar);
    el("mnemonic-display").textContent = words.join(" ");
  });

  withBusyButton(el("btn-backup-keyfile"), async () => {
    const keyfilePassphrase = el("keyfile-passphrase").value;
    if (!keyfilePassphrase) {
      setProfileStatus("вкажіть passphrase для keyfile");
      return;
    }
    const rawPrivateKey = await exportPrivateKeyRaw(state.identityKeyPair.privateKey);
    const keyfile = await createKeyfile(rawPrivateKey, keyfilePassphrase);
    el("keyfile-passphrase").value = "";
    el("keyfile-display").textContent = JSON.stringify(keyfile);
  });

  el("btn-backup-skip").addEventListener("click", () => {
    el("backup-step").hidden = true;
    el("backup-reminder").hidden = false;
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
    const rtcConfig = { iceServers: [{ urls: el("stun-url").value }] };
    const senderKey = state.senderKey;

    const ecdhKeyPair = await generateEcdhKeyPair();
    const { roomId, inviteToken } = await createInvite(serverUrl, senderKey);
    el("room-id").value = roomId;
    el("invite-token").value = inviteToken;

    state.peerFingerprint = null;
    state.sessionEcdhWires = null;
    const announce = makeIdentityAnnouncer();
    startInitiatorSession({
      senderKey,
      ecdhKeyPair,
      roomId,
      inviteToken,
      serverUrl,
      rtcConfig,
      channelOptions: { afterChannelOpen: announce },
      onSessionReady: announce
    });
  });

  withBusyButton(el("btn-join"), async () => {
    if (!state.senderKey) {
      setStatus("спочатку створіть акаунт");
      return;
    }
    state.peerFingerprint = null;
    state.sessionEcdhWires = null;
    const announce = makeIdentityAnnouncer();
    await startJoinerSession({
      senderKey: state.senderKey,
      roomId: el("room-id").value,
      inviteToken: el("invite-token").value,
      serverUrl: el("server-url").value,
      rtcConfig: { iceServers: [{ urls: el("stun-url").value }] },
      channelOptions: { afterChannelOpen: announce },
      onSessionReady: announce
    });
  });

  const setDeviceLinkStatus = (text) => {
    el("device-link-status").textContent = text;
  };

  withBusyButton(el("btn-link-device"), async () => {
    const passphrase = el("link-passphrase").value;
    if (!passphrase) {
      setDeviceLinkStatus("вкажіть passphrase профілю");
      return;
    }
    // Re-deriving the raw identity from the vault both unlocks the bytes to
    // hand over AND makes linking require passphrase confirmation.
    const identityRaw = await exportRawIdentity(passphrase);
    el("link-passphrase").value = "";

    const serverUrl = el("server-url").value;
    const rtcConfig = { iceServers: [{ urls: el("stun-url").value }] };
    const senderKey = randomSenderKey();

    const ecdhKeyPair = await generateEcdhKeyPair();
    const { roomId, inviteToken } = await createInvite(serverUrl, senderKey);
    el("room-id").value = roomId;
    el("invite-token").value = inviteToken;
    setDeviceLinkStatus("передайте Room ID та invite token на новий пристрій...");

    startInitiatorSession({
      senderKey,
      ecdhKeyPair,
      roomId,
      inviteToken,
      serverUrl,
      rtcConfig,
      channelOptions: {
        onDecryptedMessage: async (text) => {
          let message;
          try {
            message = JSON.parse(text);
          } catch {
            return; // not a linking message; nothing else is expected on this channel
          }
          if (!message || message.type !== "device-link-request") return;

          const contacts = await snapshotContacts();
          const grant = await createLinkGrant(identityRaw, message, { contacts });
          state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify(grant)));
          // Record the new device in the own signed device list (Section 13):
          // contacts receiving the updated list will accept the new device.
          const currentOwnList = (await get("profile", OWN_DEVICE_LIST_KEY)) ?? null;
          const updatedOwnList = await appendDeviceToList(identityRaw, currentOwnList, grant.certificate);
          await put("profile", OWN_DEVICE_LIST_KEY, updatedOwnList);
          setDeviceLinkStatus("пристрій прив'язано");
        }
      }
    });
  });

  withBusyButton(el("btn-join-as-device"), async () => {
    const localPassphrase = el("device-local-passphrase").value;
    if (!localPassphrase) {
      setDeviceLinkStatus("вкажіть passphrase для цього пристрою");
      return;
    }

    const devicePair = await generateDeviceKeyPair();

    // The request can only go out once BOTH the channel is open and the
    // session key is derived; those two complete in either order.
    let linkRequestSent = false;
    const maybeSendLinkRequest = async () => {
      if (linkRequestSent || !state.channel || !state.sessionKey) return;
      linkRequestSent = true;
      const request = await createLinkRequest(devicePair.publicKey);
      state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify(request)));
      setDeviceLinkStatus("очікування підтвердження від основного пристрою...");
    };

    await startJoinerSession({
      senderKey: randomSenderKey(),
      roomId: el("room-id").value,
      inviteToken: el("invite-token").value,
      serverUrl: el("server-url").value,
      rtcConfig: { iceServers: [{ urls: el("stun-url").value }] },
      onSessionReady: maybeSendLinkRequest,
      channelOptions: {
        afterChannelOpen: maybeSendLinkRequest,
        onDecryptedMessage: async (text) => {
          let message;
          try {
            message = JSON.parse(text);
          } catch {
            return;
          }
          if (!message || message.type !== "device-link-grant") return;

          const { identityKeyPair } = await applyLinkGrant(message, localPassphrase, {
            devicePublicKey: devicePair.publicKey
          });
          el("device-local-passphrase").value = "";
          state.identityKeyPair = identityKeyPair;
          state.senderKey = await fingerprint(identityKeyPair.publicKey);
          el("pub-key-display").textContent = state.senderKey;
          setDeviceLinkStatus("пристрій приєднано");
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
    // Profile mode + verified peer: keep the encrypted history (Section 14).
    // Ephemeral mode has no vaultKey; an unverified peer has no fingerprint
    // to file the message under -- both skip silently.
    if (state.identityKeyPair && state.identityKeyPair.vaultKey && state.peerFingerprint) {
      await appendMessage(state.identityKeyPair.vaultKey, state.peerFingerprint, {
        direction: "out",
        text,
        timestamp: Date.now()
      });
    }
  });
}
