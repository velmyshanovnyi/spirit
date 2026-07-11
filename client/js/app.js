import {
  generateIdentityKeyPair,
  generateEcdhKeyPair,
  fingerprint,
  exportEcdhPublicKeyForWire,
  importEcdhPublicKeyFromWire,
  exportPrivateKeyScalar,
  exportPrivateKeyRaw
} from "./identity.js";
import { createPermanentProfile, exportRawIdentity, listProfiles, loadPermanentProfile, setNickname, getNickname } from "./profile.js";
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
import { rememberContact, getContact, updateContactDeviceList, listContacts } from "./contacts.js";
import { appendMessage, listMessages, listConversations } from "./historyStore.js";

import {
  startAsInitiator,
  startAsJoiner,
  applyRemoteAnswer,
  addLocalMediaTracks,
  createRenegotiationOffer,
  createRenegotiationAnswer,
  applyRenegotiationAnswer
} from "./webrtc.js";
import { createInvite, createOffer, getOffer, submitAnswer, pollForAnswer } from "./signalingClient.js";
import { deriveSessionKey, encryptMessage, decryptMessage } from "./e2ee.js";
import { promptGoogleSignIn, verifyGoogleIdToken } from "./googleOAuth.js";
import { t, setLocale, detectLocale, applyTranslations, getLocale, SUPPORTED_LOCALES } from "./i18n.js";
import { initTheme, toggleTheme } from "./theme.js";
import { formatSpiritId } from "./spiritId.js";
import { initRouter } from "./router.js";
import { adminLogin, getAdminConfig } from "./adminAuth.js";
import { rememberSession, getRememberedProfileId } from "./session.js";

// Order controls display order in the read-only admin panel.
const ADMIN_CONFIG_FIELDS = [
  "session_ttl_seconds",
  "max_sessions",
  "global_access",
  "allowed_origins",
  "request_window_seconds",
  "max_requests_per_window",
  "room_creation_window_seconds",
  "max_room_creations_per_window",
  "enable_proof_proxy",
  "fetch_proof_timeout_seconds",
  "fetch_proof_max_bytes"
];

const ROUTES = ["account", "profile", "server", "room", "conversation", "contacts", "history"];
const GATED_ROUTES = ["profile", "conversation", "contacts", "history"];

// Per-profile own device list record key in the "profile" store (Section 15:
// multiple accounts each maintain their own list).
const ownDeviceListKey = (profileId) => `deviceList:${profileId}`;

const DEFAULT_ICE_TIMEOUT_MS = 15000;
const DEFAULT_ANSWER_WAIT_TIMEOUT_MS = 5 * 60 * 1000; // matches the signaling node's default session TTL

export function initApp(
  doc,
  {
    iceTimeoutMs = DEFAULT_ICE_TIMEOUT_MS,
    answerWaitTimeoutMs = DEFAULT_ANSWER_WAIT_TIMEOUT_MS,
    locale,
    // Overridable for tests -- jsdom doesn't implement real navigation, so
    // `location.search =` is a silent no-op there; production always uses
    // the real value.
    locationSearch = doc.defaultView.location.search
  } = {}
) {
  // Locale: explicit option (tests) -> stored choice -> browser language.
  setLocale(locale ?? detectLocale(typeof navigator !== "undefined" ? navigator.language : undefined));
  initTheme(doc);
  applyTranslations(doc);

  const themeToggle = doc.getElementById("theme-toggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => toggleTheme(doc));
  }
  const langSelect = doc.getElementById("lang-select");
  if (langSelect) {
    langSelect.innerHTML = "";
    for (const code of SUPPORTED_LOCALES) {
      const option = doc.createElement("option");
      option.value = code;
      option.textContent = code.toUpperCase();
      langSelect.appendChild(option);
    }
    langSelect.value = getLocale();
    langSelect.addEventListener("change", () => {
      setLocale(langSelect.value);
      applyTranslations(doc);
    });
  }

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
    peerIdentityPublicKey: null,
    // Own camera/mic MediaStream once a call has been started (Section V2);
    // null before then and used by the camera/mic toggle buttons.
    localStream: null,
    // Own display name (Section 16), loaded from profile.js's unencrypted
    // nickname record on create/unlock; null in ephemeral quick-chat mode.
    nickname: null
  };

  const el = (id) => doc.getElementById(id);
  // Runtime values must survive language switches: the first dynamic write
  // strips the element's data-i18n so applyTranslations stops touching it.
  const setDynamicText = (element, text) => {
    element.removeAttribute("data-i18n");
    element.textContent = text;
  };
  const setStatus = (text) => {
    setDynamicText(el("connection-status"), text);
  };
  const setGoogleStatus = (text) => {
    el("google-verify-status").textContent = text;
  };
  const formatClockTime = (ms) => {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  // direction: "out" (this device sent it) or "in" (received from the peer).
  const appendChat = (text, direction, timestamp = Date.now()) => {
    const arrow = direction === "out" ? "→" : "←";
    el("chat-log").textContent += `[${formatClockTime(timestamp)}] ${arrow} ${text}\n`;
  };

  // Cross-origin rendezvous (Section N6): two independent signaling nodes
  // (e.g. spirit.kolo.media, spirit.kibr.com.ua) don't share a database or
  // CORS allowlist by design (docs/signaling-protocol.md) -- a room created
  // on one node doesn't exist on the other. An invite LINK sidesteps this
  // entirely by pointing the receiver at the INITIATOR's own origin (not
  // wherever they happen to be), so both ends always land on the same node.
  const joinParams = new URLSearchParams(locationSearch);
  const invitedRoomId = joinParams.get("room");
  const invitedToken = joinParams.get("token");
  const cameFromInviteLink = !!(invitedRoomId && invitedToken);
  if (cameFromInviteLink) {
    el("room-id").value = invitedRoomId;
    el("invite-token").value = invitedToken;
  }
  // Once identity is established, an invite-link visitor should land where
  // they can immediately join (room), not the usual profile-admin screen.
  const postIdentityRoute = () => (cameFromInviteLink ? "room" : "profile");

  const setInviteStatus = (text) => {
    el("invite-status").textContent = text;
  };

  el("btn-copy-invite").addEventListener("click", () => {
    const roomId = el("room-id").value;
    const inviteToken = el("invite-token").value;
    if (!roomId || !inviteToken) {
      setInviteStatus(t("room.inviteMissing"));
      return;
    }
    const link = new URL(doc.defaultView.location.pathname, doc.defaultView.location.origin);
    link.search = `?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(inviteToken)}`;
    link.hash = "#/room";
    const linkText = link.toString();

    el("invite-link-display").textContent = linkText;
    setInviteStatus(t("room.inviteCopied"));
    // Best-effort: Clipboard API needs a secure context and isn't available
    // in every environment (jsdom, http://, older browsers) -- the visible
    // link text above is the reliable fallback either way.
    if (doc.defaultView.navigator.clipboard && doc.defaultView.navigator.clipboard.writeText) {
      doc.defaultView.navigator.clipboard.writeText(linkText).catch(() => {});
    }
  });

  async function renderContactsScreen() {
    const list = el("contacts-list");
    const empty = el("contacts-empty");
    if (!list || !empty) return; // screen not present in this document (e.g. older test fixture)
    const contacts = await listContacts();
    list.innerHTML = "";
    empty.hidden = contacts.length > 0;
    for (const contact of contacts) {
      const row = doc.createElement("div");
      row.className = "list-row";
      row.dataset.contactFingerprint = contact.fingerprint;
      row.textContent = formatSpiritId(contact.fingerprint);
      list.appendChild(row);
    }
  }

  async function renderHistoryScreen() {
    const list = el("history-list");
    const empty = el("history-empty");
    if (!list || !empty) return;
    if (!state.identityKeyPair || !state.identityKeyPair.vaultKey) {
      list.innerHTML = "";
      empty.hidden = false;
      return;
    }
    const conversations = await listConversations(state.identityKeyPair.vaultKey, state.senderKey);
    list.innerHTML = "";
    empty.hidden = conversations.length > 0;
    for (const conversation of conversations) {
      const row = doc.createElement("div");
      row.className = "list-row";
      row.dataset.contactFingerprint = conversation.contactId;
      row.textContent = formatSpiritId(conversation.contactId);
      list.appendChild(row);
    }
  }

  const router = initRouter(doc, {
    routes: ROUTES,
    defaultRoute: "account",
    gatedRoutes: GATED_ROUTES,
    hasIdentity: () => !!state.senderKey
  });

  const setAdminStatus = (text) => {
    el("admin-status").textContent = text;
  };

  function renderAdminConfig(config) {
    const list = el("admin-config-list");
    list.innerHTML = "";
    for (const field of ADMIN_CONFIG_FIELDS) {
      if (!(field in config)) continue;
      const row = doc.createElement("div");
      row.className = "list-row";
      const value = Array.isArray(config[field]) ? config[field].join(", ") : String(config[field]);
      row.textContent = `${t(`admin.field.${field}`)}: ${value}`;
      list.appendChild(row);
    }
    list.hidden = false;
  }

  withBusyButton(el("btn-admin-login"), async () => {
    const password = el("admin-password").value;
    if (!password) {
      setAdminStatus(t("admin.needPassword"));
      return;
    }
    try {
      const { token } = await adminLogin(el("server-url").value, password);
      el("admin-password").value = "";
      const config = await getAdminConfig(el("server-url").value, token);
      el("admin-login-form").hidden = true;
      setAdminStatus("");
      renderAdminConfig(config);
    } catch (err) {
      setAdminStatus(err.message);
    }
  });

  // Re-initializing (tests creating multiple app instances in one window)
  // must not stack listeners -- only the latest initApp() call's handler,
  // closing over its own `state`, should ever react (same pattern as
  // router.js's own hashchange listener).
  const win = doc.defaultView;
  const onScreenChange = () => {
    const route = win.location.hash.replace(/^#\/?/, "");
    if (route === "contacts") renderContactsScreen();
    if (route === "history") renderHistoryScreen();
  };
  if (win.__spiritAppHashListener) {
    win.removeEventListener("hashchange", win.__spiritAppHashListener);
  }
  win.__spiritAppHashListener = onScreenChange;
  win.addEventListener("hashchange", onScreenChange);

  function armIceTimeout() {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (!settled) setStatus(t("status.iceTimeout"));
    }, iceTimeoutMs);
    return () => {
      settled = true;
      clearTimeout(timeoutId);
    };
  }

  const CONTROL_MESSAGE_TYPES = new Set([
    "identity-announce",
    "device-list-announce",
    "webrtc-call-offer",
    "webrtc-call-answer"
  ]);

  const setVideoStatus = (text) => {
    el("video-status").textContent = text;
  };

  // Auto-accept (Section V2, specs/ui/video-call.md): requesting our own
  // camera+mic is how we both show local video AND have tracks to answer
  // with -- there is no separate accept/reject step for the MVP.
  async function acquireLocalStream() {
    if (state.localStream) return state.localStream;
    const stream = await doc.defaultView.navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    state.localStream = stream;
    el("video-local").srcObject = stream;
    addLocalMediaTracks(state.pc, stream);
    return stream;
  }

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
        setStatus(t("status.incomingRejected"));
        return;
      }
      const receivedAt = Date.now();
      appendChat(text, "in", receivedAt);
      if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
        await appendMessage(state.identityKeyPair.vaultKey, state.senderKey, state.peerFingerprint, {
          direction: "in",
          text,
          timestamp: receivedAt
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
        setStatus(t("status.announceFailed"));
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
          identityPubkeyWire: verified.identityPubkeyWire,
          nickname: verified.nickname || null
        });
        continuity = status === "known" ? t("status.knownContact") : t("status.newContact");
      }
      // A nickname is peer-CHOSEN, not proof of identity -- a different
      // fingerprint could announce the same nickname (impersonation-by-name,
      // flagged in exec review). The fingerprint must stay visible so TOFU
      // continuity is still checkable, never replaced by the nickname alone.
      const peerLabel = verified.nickname
        ? `${verified.nickname} (${formatSpiritId(verified.fingerprint)})`
        : formatSpiritId(verified.fingerprint);
      setStatus(t("status.peerVerified", { fp: peerLabel }) + continuity);
      // Known contact in profile mode: bring the prior conversation back
      // into the chat log before any new messages arrive.
      if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
        const history = await listMessages(state.identityKeyPair.vaultKey, state.senderKey, verified.fingerprint);
        for (const entry of history) {
          appendChat(entry.text, entry.direction, entry.timestamp);
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
      return;
    }

    if (control.type === "webrtc-call-offer") {
      // Same trust gate as plain chat text (line ~309 above): don't turn on
      // the camera/mic for a peer whose identity hasn't been verified yet.
      if (!state.peerFingerprint) {
        setVideoStatus(t("status.incomingRejected"));
        return;
      }
      try {
        await acquireLocalStream();
        const answer = await createRenegotiationAnswer(state.pc, control.sdp);
        state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify({ type: "webrtc-call-answer", sdp: answer })));
      } catch (err) {
        setVideoStatus(t("status.error", { msg: err.message }));
      }
      return;
    }

    if (control.type === "webrtc-call-answer") {
      await applyRenegotiationAnswer(state.pc, control.sdp);
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
          state.sessionEcdhWires.peerEcdhWire,
          state.nickname ?? ""
        );
        state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify(announce)));
        // Follow up with the own device list, if this profile maintains one --
        // the peer verifies it against the identity just announced.
        const ownDeviceList = await get("profile", ownDeviceListKey(state.senderKey));
        if (ownDeviceList) {
          state.channel.send(
            await encryptMessage(state.sessionKey, JSON.stringify({ type: "device-list-announce", list: ownDeviceList }))
          );
        }
      } catch (err) {
        setStatus(t("status.error", { msg: err.message })); // afterChannelOpen path is detached; nothing upstream catches
      }
    };
  }

  function wireChannelCallbacks(disarmIceTimeout, { onDecryptedMessage = handleChatMessage, afterChannelOpen } = {}) {
    return {
      onChannelOpen: (channel) => {
        state.channel = channel;
        setStatus(t("status.connected"));
        for (const id of ["btn-start-call", "btn-toggle-camera", "btn-toggle-mic"]) {
          el(id).disabled = false;
        }
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
          setStatus(t("status.error", { msg: err.message }));
        }
      },
      onChannelClose: () => {
        setStatus(t("status.closed"));
        for (const id of ["btn-start-call", "btn-toggle-camera", "btn-toggle-mic"]) {
          el(id).disabled = true;
        }
        if (state.localStream) {
          for (const track of state.localStream.getTracks()) track.stop();
          state.localStream = null;
        }
      },
      onError: (err) => {
        disarmIceTimeout(); // the local-description IIFE failed before onLocalOfferReady/onLocalAnswerReady
        // could ever fire to disarm it itself -- without this the stale ICE timeout
        // would later overwrite this real error with a misleading timeout message.
        setStatus(t("status.error", { msg: err.message }));
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
      onRemoteTrack: (stream) => {
        el("video-remote").srcObject = stream;
      },
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

          setStatus(t("status.waitingAnswer"));
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
          setStatus(t("status.error", { msg: err.message }));
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
      onRemoteTrack: (stream) => {
        el("video-remote").srcObject = stream;
      },
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
          setStatus(t("status.error", { msg: err.message }));
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
        setStatus(t("status.error", { msg: err.message }));
      } finally {
        button.disabled = false;
      }
    });
  }

  el("btn-generate").addEventListener("click", async () => {
    state.identityKeyPair = await generateIdentityKeyPair();
    state.senderKey = await fingerprint(state.identityKeyPair.publicKey);
    setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
    // Ephemeral quick-chat has no profile to administer -- go straight to
    // the room screen rather than the profile screen (used for permanent
    // profiles: unlock, backup, devices).
    router.navigate("room");
  });

  const setProfileStatus = (text) => {
    el("profile-status").textContent = text;
  };

  el("btn-create-profile").addEventListener("click", () => {
    el("profile-setup").hidden = false;
  });

  const DEFAULT_SESSION_TTL_HOURS = 24;

  // A non-positive TTL would produce an expiresAt already in the past,
  // silently making rememberSession() a no-op instead of erroring -- clamp
  // rather than trust raw field input (exec review finding).
  function readSessionTtlHours() {
    const hours = Number(el("session-ttl-hours").value);
    return Number.isFinite(hours) && hours >= 1 ? hours : DEFAULT_SESSION_TTL_HOURS;
  }

  // Section 18: TTL is user-configurable (Profile screen) but persists
  // across reloads via the "profile" store -- localStorage alone would work
  // too, but this keeps every durable setting in one place.
  (async () => {
    const stored = await get("profile", "settings:sessionTtlHours");
    if (stored) el("session-ttl-hours").value = String(stored);
  })().catch(() => {});
  el("session-ttl-hours").addEventListener("change", () => {
    put("profile", "settings:sessionTtlHours", readSessionTtlHours()).catch(() => {});
  });

  // Section 17/18: a returning user (stored profiles exist) sees the login
  // block instead of the create-account flow; a remembered, not-yet-expired
  // session preselects which profile so they only need to type the
  // passphrase -- the passphrase itself is never skipped or persisted.
  async function refreshProfileSelector() {
    const select = el("profile-select");
    select.innerHTML = "";
    const profiles = await listProfiles();
    for (const { id } of profiles) {
      const option = doc.createElement("option");
      option.value = id;
      option.textContent = id === "identity" ? t("profile.legacyOption") : formatSpiritId(id).slice(0, 26) + "…";
      select.appendChild(option);
    }
    // Hide once an identity is already active this session (e.g. right
    // after creating a profile) -- there's nothing to log into anymore.
    el("account-login-block").hidden = profiles.length === 0 || !!state.senderKey;
    const remembered = getRememberedProfileId();
    if (remembered && profiles.some((p) => p.id === remembered)) {
      select.value = remembered;
    }
  }
  // Fire-and-forget at startup; an empty selector is the correct state on error too.
  refreshProfileSelector().catch(() => {});

  withBusyButton(el("btn-profile-unlock"), async () => {
    const passphrase = el("unlock-passphrase").value;
    if (!passphrase) {
      setProfileStatus(t("unlock.needPassphrase"));
      return;
    }
    const selectedId = el("profile-select").value;
    if (!selectedId) {
      setProfileStatus(t("unlock.noProfiles"));
      return;
    }
    try {
      const profile = await loadPermanentProfile(selectedId, passphrase);
      el("unlock-passphrase").value = "";
      state.identityKeyPair = profile;
      state.senderKey = profile.profileId;
      state.nickname = await getNickname(state.senderKey);
      setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
      setProfileStatus("");
      // A legacy record migrates on unlock -- its id changes to the
      // fingerprint (profile.profileId), which is what must be remembered,
      // not the pre-migration `selectedId` ("identity") -- otherwise the
      // remembered id never matches on the next load's listProfiles().
      rememberSession(profile.profileId, readSessionTtlHours());
      await refreshProfileSelector();
      router.navigate(postIdentityRoute());
    } catch (err) {
      setProfileStatus(err.message);
    }
  });

  withBusyButton(el("btn-profile-confirm"), async () => {
    const passphrase = el("profile-passphrase").value;
    if (!passphrase) {
      setProfileStatus(t("profile.needPassphrase"));
      return;
    }
    state.identityKeyPair = await createPermanentProfile(passphrase);
    // Don't keep the secret sitting in a DOM input after it's been used.
    el("profile-passphrase").value = "";
    state.senderKey = await fingerprint(state.identityKeyPair.publicKey);
    const nickname = el("nickname-input").value.trim();
    if (nickname) {
      await setNickname(state.senderKey, nickname);
      state.nickname = nickname;
    }
    setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
    setProfileStatus("");
    el("backup-step").hidden = false;
    await refreshProfileSelector();
  });

  withBusyButton(el("btn-backup-mnemonic"), async () => {
    const scalar = await exportPrivateKeyScalar(state.identityKeyPair.privateKey);
    const words = await bytesToMnemonic(scalar);
    el("mnemonic-display").textContent = words.join(" ");
  });

  withBusyButton(el("btn-backup-keyfile"), async () => {
    const keyfilePassphrase = el("keyfile-passphrase").value;
    if (!keyfilePassphrase) {
      setProfileStatus(t("profile.needKeyfilePassphrase"));
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
    // Onboarding (account screen) is done. Usually that means profile
    // administration; an invite-link visitor instead goes straight to the
    // room screen, where Room ID/token are already pre-filled.
    router.navigate(postIdentityRoute());
  });

  withBusyButton(el("btn-google-verify"), async () => {
    if (!state.senderKey) {
      setGoogleStatus(t("status.createAccountFirst"));
      return;
    }
    const clientId = el("google-client-id").value;
    if (!clientId) {
      setGoogleStatus(t("google.needClientId"));
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
      setGoogleStatus(t("google.verified", { email: claims.email }));
    } catch (err) {
      setGoogleStatus(t("status.error", { msg: err.message }));
    }
  });

  withBusyButton(el("btn-initiate"), async () => {
    if (!state.senderKey) {
      setStatus(t("status.createAccountFirst"));
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
      // Chat entry point (unlike device linking, which reuses the same
      // session helpers but must NOT jump to the conversation screen):
      // once the data channel is actually open, the user has something to
      // look at, so move them straight to the conversation screen.
      channelOptions: {
        afterChannelOpen: () => {
          router.navigate("conversation");
          announce();
        }
      },
      onSessionReady: announce
    });
  });

  withBusyButton(el("btn-join"), async () => {
    if (!state.senderKey) {
      setStatus(t("status.createAccountFirst"));
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
      channelOptions: {
        afterChannelOpen: () => {
          router.navigate("conversation");
          announce();
        }
      },
      onSessionReady: announce
    });
  });

  const setDeviceLinkStatus = (text) => {
    el("device-link-status").textContent = text;
  };

  withBusyButton(el("btn-link-device"), async () => {
    const passphrase = el("link-passphrase").value;
    if (!passphrase) {
      setDeviceLinkStatus(t("unlock.needPassphrase"));
      return;
    }
    if (!state.senderKey) {
      setDeviceLinkStatus(t("link.needProfile"));
      return;
    }
    // The active profile id is the identity fingerprint (= senderKey).
    const activeProfileId = state.senderKey;
    // Re-deriving the raw identity from the vault both unlocks the bytes to
    // hand over AND makes linking require passphrase confirmation.
    const identityRaw = await exportRawIdentity(activeProfileId, passphrase);
    el("link-passphrase").value = "";

    const serverUrl = el("server-url").value;
    const rtcConfig = { iceServers: [{ urls: el("stun-url").value }] };
    const senderKey = randomSenderKey();

    const ecdhKeyPair = await generateEcdhKeyPair();
    const { roomId, inviteToken } = await createInvite(serverUrl, senderKey);
    el("room-id").value = roomId;
    el("invite-token").value = inviteToken;
    setDeviceLinkStatus(t("link.shareRoom"));

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
          const currentOwnList = (await get("profile", ownDeviceListKey(activeProfileId))) ?? null;
          const updatedOwnList = await appendDeviceToList(identityRaw, currentOwnList, grant.certificate);
          await put("profile", ownDeviceListKey(activeProfileId), updatedOwnList);
          setDeviceLinkStatus(t("link.done"));
        }
      }
    });
  });

  withBusyButton(el("btn-join-as-device"), async () => {
    const localPassphrase = el("device-local-passphrase").value;
    if (!localPassphrase) {
      setDeviceLinkStatus(t("device.needPassphrase"));
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
      setDeviceLinkStatus(t("device.waitingGrant"));
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
          setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
          setDeviceLinkStatus(t("device.done"));
          router.navigate("profile");
        }
      }
    });
  });

  // Disabled until a chat channel connects (enabled in wireChannelCallbacks'
  // onChannelOpen) -- there is no peer connection to add tracks to yet.
  for (const id of ["btn-start-call", "btn-toggle-camera", "btn-toggle-mic"]) {
    el(id).disabled = true;
  }

  withBusyButton(el("btn-start-call"), async () => {
    try {
      await acquireLocalStream();
      const offer = await createRenegotiationOffer(state.pc);
      state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify({ type: "webrtc-call-offer", sdp: offer })));
    } catch (err) {
      setVideoStatus(t("status.error", { msg: err.message }));
    }
  });

  el("btn-toggle-camera").addEventListener("click", () => {
    if (!state.localStream) return;
    for (const track of state.localStream.getTracks()) {
      if (track.kind === "video") track.enabled = !track.enabled;
    }
  });

  el("btn-toggle-mic").addEventListener("click", () => {
    if (!state.localStream) return;
    for (const track of state.localStream.getTracks()) {
      if (track.kind === "audio") track.enabled = !track.enabled;
    }
  });

  el("btn-send").addEventListener("click", async () => {
    if (!state.channel || !state.sessionKey) {
      setStatus(t("status.noActiveConnection"));
      return;
    }
    const text = el("message-input").value;
    const payload = await encryptMessage(state.sessionKey, text);
    state.channel.send(payload);
    el("message-input").value = "";
    const sentAt = Date.now();
    appendChat(text, "out", sentAt);
    // Profile mode + verified peer: keep the encrypted history (Section 14).
    // Ephemeral mode has no vaultKey; an unverified peer has no fingerprint
    // to file the message under -- both skip silently.
    if (state.identityKeyPair && state.identityKeyPair.vaultKey && state.peerFingerprint) {
      await appendMessage(state.identityKeyPair.vaultKey, state.senderKey, state.peerFingerprint, {
        direction: "out",
        text,
        timestamp: sentAt
      });
    }
  });
}
