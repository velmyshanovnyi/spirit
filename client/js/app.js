import {
  generateIdentityKeyPair,
  generateEcdhKeyPair,
  fingerprint,
  exportEcdhPublicKeyForWire,
  importEcdhPublicKeyFromWire,
  exportPrivateKeyScalar,
  exportPrivateKeyRaw,
  importPrivateKeyRaw
} from "./identity.js";
import { createPermanentProfile, exportRawIdentity, listProfiles, loadPermanentProfile, setNickname, getNickname, adoptScalarIdentity } from "./profile.js";
import { deriveAccountMaterial, generateAccountName } from "./deterministicIdentity.js";
import { generateStrongPassword } from "./passwordGenerator.js";
import { bytesToMnemonic } from "./mnemonic.js";
import { createKeyfile } from "./keyfile.js";
import { buildIdenticonSvg } from "./identicon.js";
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
import {
  rememberContact,
  getContact,
  updateContactDeviceList,
  updateContactProofSet,
  updateContactPushSubscription,
  listContacts
} from "./contacts.js";
import { buildPushSubscribeOptions, serializeSubscriptionForAnnounce, parsePushSubscriptionAnnounce } from "./pushSubscription.js";
import { VAPID_PUBLIC_KEY_RAW_BASE64URL } from "./vapidKeys.js";
import { sendPushNotification } from "./pushSend.js";
import { appendMessage, listMessages, listConversations } from "./historyStore.js";
import { splitSecret } from "./shamir.js";
import { buildRecoveryShareAnnounce, parseRecoveryShareAnnounce, encodeShareAsText } from "./recoveryShare.js";
import { computeSharedSafetyNumber, hexToEmoji } from "./safetyNumber.js";
import { saveTrustedShare, listTrustedShares, getTrustedShare } from "./trustedShares.js";
import { qrSvgMarkup } from "./qr.js";
import { recoverFromShares } from "./socialRecovery.js";
import { acceptNewerProofSet, addProofToSet, revokeProofFromSet } from "./proofSet.js";
import { createProofBlock, parseProofBlock, verifyProofBlock } from "./proofs.js";
import { fetchProofPageText } from "./fetchProof.js";
import { generateAnonymousNickname } from "./anonymousNickname.js";
import { splitFileIntoChunks, chunkToBase64, base64ToChunk, computeFileHash, createFileAssembler } from "./fileTransfer.js";
import { createGroup, getGroup, listGroups, updateGroupMembers } from "./groups.js";
import {
  saveImportedContact,
  listImportedContacts,
  getImportedContact,
  setMatchedFingerprint,
  deleteImportedContact,
  clearPendingMessages
} from "./importedContacts.js";
import { parseContactList, parseChatExport } from "./importParsers.js";

import {
  startAsInitiator,
  startAsJoiner,
  applyRemoteAnswer,
  addLocalMediaTracks,
  createRenegotiationOffer,
  createRenegotiationAnswer,
  applyRenegotiationAnswer,
  buildRtcConfig
} from "./webrtc.js";
import { createInvite, createOffer, getOffer, submitAnswer, pollForAnswer } from "./signalingClient.js";
import { deriveSessionKey, encryptMessage, decryptMessage } from "./e2ee.js";
import { deriveRootKey, deriveInitialChainKeys, ratchetStep } from "./ratchet.js";
import { promptGoogleSignIn, verifyGoogleIdToken } from "./googleOAuth.js";
import { t, setLocale, detectLocale, applyTranslations, getLocale, SUPPORTED_LOCALES } from "./i18n.js";
import { initTheme, toggleTheme } from "./theme.js";
import { formatSpiritId } from "./spiritId.js";
import { initRouter } from "./router.js";
import { adminLogin, getAdminConfig } from "./adminAuth.js";
import { rememberSession, getRememberedProfileId, recordRecentAccount, getRecentAccounts, forgetSession } from "./session.js";

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

const ROUTES = ["account", "profile", "server", "room", "conversation", "manage", "history"];
const GATED_ROUTES = ["profile", "conversation", "manage", "history"];

// Per-profile own device list record key in the "profile" store (Section 15:
// multiple accounts each maintain their own list).
const ownDeviceListKey = (profileId) => `deviceList:${profileId}`;
// Per-profile own proof set (Section C, specs/phase2c/identity-verification.md).
const ownProofSetKey = (profileId) => `proofSet:${profileId}`;
// Per-profile own push subscription (Section PN4, specs/phase5/push-notifications.md).
const ownPushSubscriptionKey = (profileId) => `pushSubscription:${profileId}`;

const DEFAULT_ICE_TIMEOUT_MS = 15000;
const DEFAULT_ANSWER_WAIT_TIMEOUT_MS = 5 * 60 * 1000; // matches the signaling node's default session TTL
export function initApp(doc, options) {
  const {
    iceTimeoutMs = DEFAULT_ICE_TIMEOUT_MS,
    answerWaitTimeoutMs = DEFAULT_ANSWER_WAIT_TIMEOUT_MS,
    // Bug report 2026-07-17: the browser's native camera/mic permission
    // prompt (triggered by Section F6's auto-preview) blocks clicks on the
    // REST of the page (including "Скопіювати запрошення", the very first
    // thing a user landing in the lobby is likely to reach for) until
    // answered. A short delay before requesting media gives that first,
    // high-value click a real window to land before the prompt appears --
    // doesn't eliminate the interruption (browser permission UX can't be
    // suppressed from page JS), just avoids it winning the race against the
    // most common first action. Defaults to 0 (instant) to match this
    // file's existing test suite's expectations; index.html explicitly
    // opts into the real production delay.
    localMediaPreviewDelayMs = 0,
    locale,
    // Overridable for tests -- jsdom doesn't implement real navigation, so
    // `location.search =` is a silent no-op there; production always uses
    // the real value.
    locationSearch = doc.defaultView.location.search,
    // Section H5 (specs/ui/chat-first-redesign.md): auto-start an ephemeral
    // chat with zero clicks on a genuinely fresh visit (no invite link, no
    // remembered session) -- defaults to true for real usage (index.html
    // calls initApp(document) with NO second argument at all), defaults to
    // false whenever an explicit options object is passed (every existing
    // test in app.test.js passes one), so this doesn't silently trigger
    // identity generation + network calls in tests that never opted into
    // exercising it via an explicit { autoStartChat: true }.
    autoStartChat = options === undefined
  } = options || {};
  const el = (id) => doc.getElementById(id);
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

  // Cross-origin rendezvous (Section N6): two independent signaling nodes
  // (e.g. spirit.kolo.media, spirit.kibr.com.ua) don't share a database or
  // CORS allowlist by design (docs/signaling-protocol.md) -- a room created
  // on one node doesn't exist on the other. An invite LINK sidesteps this
  // entirely by pointing the receiver at the INITIATOR's own origin (not
  // wherever they happen to be), so both ends always land on the same node.
  const joinParams = new URLSearchParams(locationSearch);
  const invitedRoomId = joinParams.get("room");
  const invitedToken = joinParams.get("token");
  // Section GC3 (specs/phase4/group-chats.md): closes the GC2 review gap
  // (specs/reviews/group-chats-GC2-iter1.md) -- an invite link minted by
  // startTaggedGroupInvite (GC2) now carries this alongside room/token, so
  // the JOINER's own state.peers entry can be tagged with the same groupId
  // the inviter tagged their side with, symmetrically.
  const invitedGroupId = joinParams.get("group");
  const cameFromInviteLink = !!(invitedRoomId && invitedToken);
  if (cameFromInviteLink) {
    el("room-id").value = invitedRoomId;
    el("invite-token").value = invitedToken;
  }

  // Section H1 (specs/ui/chat-first-redesign.md): a first-time visitor sees
  // a brief welcome + quick-start modal exactly once (localStorage flag),
  // never again on subsequent visits. Bug report 2026-07-17: an invite-link
  // visitor is joining someone ELSE's chat, not exploring the homepage cold
  // -- showing this modal renders ON TOP of the just-auto-joined chat
  // (both are fixed-position overlays) and made it look like the chat never
  // opened at all, so it's suppressed entirely for that case regardless of
  // the localStorage flag.
  const welcomeModal = doc.getElementById("welcome-modal");
  if (welcomeModal) {
    // localStorage can throw (private-mode/blocked site data) -- matches the
    // guarded pattern already used everywhere else in this codebase (theme.js,
    // i18n.js, the inline pre-paint script in index.html). Unguarded here
    // would take down the WHOLE app's init, not just the modal.
    let alreadySeen = false;
    try {
      alreadySeen = doc.defaultView.localStorage.getItem("spirit.welcomeSeen") === "1";
    } catch {
      // Storage unavailable -- fail open (show the modal every visit rather
      // than crash init); harmless since it's just a one-time hint.
    }
    welcomeModal.hidden = alreadySeen || cameFromInviteLink;
    doc.getElementById("btn-welcome-confirm")?.addEventListener("click", () => {
      welcomeModal.hidden = true;
      try {
        doc.defaultView.localStorage.setItem("spirit.welcomeSeen", "1");
      } catch {
        // Storage unavailable -- nothing to persist; the modal will simply
        // reappear next visit, which is an acceptable degraded UX.
      }
    });
  }

  const state = {
    identityKeyPair: null,
    senderKey: null,
    // Section GC0 (specs/phase4/group-chats.md): multi-connection
    // refactor. `peers` is now the single source of truth for every
    // per-connection field that used to be a poodinokyi (single) slot
    // directly on `state` (pc, channel, sessionKey, sessionEcdhWires,
    // sendChainKey, receiveChainKey, peerFingerprint,
    // peerIdentityPublicKey, isInviteOwner). Each entry is keyed by a
    // randomly-generated connectionId (see randomConnectionId below),
    // assigned at session-start time -- BEFORE peerFingerprint is known,
    // since identity is only verified once the connection is already
    // open. `activeConnectionId` tracks which entry the single
    // conversation-screen UI is bound to; during this section there is
    // always at most one entry (group logic is GC1-GC3, not implemented
    // yet), so in practice this is just "the current connection".
    //
    // state.pc / state.channel / state.sessionKey / state.sessionEcdhWires /
    // state.sendChainKey / state.receiveChainKey / state.peerFingerprint /
    // state.peerIdentityPublicKey / state.isInviteOwner are defined further
    // down (PEER_PROXY_FIELDS loop) as getters/setters that transparently
    // proxy to the active entry in this Map. Every existing call site that
    // reads/writes those fields keeps working completely unchanged -- same
    // syntax, same 1:1 behavior -- while the underlying data now lives in
    // state.peers, which is what makes multiple simultaneous connections
    // representable (the GC1-GC3 prerequisite). Teardown/reset call sites
    // were changed to call resetActiveConnection() instead of nulling
    // fields individually, so a torn-down session's entry is deleted from
    // the Map outright rather than left behind as stale all-null data.
    peers: new Map(),
    activeConnectionId: null,
    // Section RF9: 1:1 chat messages typed before a peer has connected yet
    // (or after an unstable connection drops mid-session) queue here
    // instead of being blocked outright -- drained the moment a channel +
    // session key are both available again (flushPendingOutgoingMessages).
    pendingOutgoingMessages: [],
    // Section RF10: "peer" shows each side's independently-verified fingerprint
    // of the OTHER party (asymmetric, the original behavior); "shared" shows
    // one order-independent value derived from BOTH fingerprints together
    // (computeSharedSafetyNumber), comparable banner-to-banner. Synced to
    // whichever peer(s) are connected via a safety-display-mode control
    // message the moment either side toggles it.
    safetyDisplayMode: "peer",
    sharedSafetyNumber: null,
    safetyHintVisible: false,
    // Own camera/mic MediaStream, acquired for local preview as soon as the
    // conversation lobby opens (Section F6) -- null before then and used by
    // the camera/mic toggle buttons.
    localStream: null,
    // Whether addLocalMediaTracks(state.pc, state.localStream) has already
    // run for the current call -- acquireLocalStream() must only add tracks
    // to the peer connection once, even though it may be called again.
    localTracksAddedToPeer: false,
    // The in-flight previewLocalMedia() promise, if any -- a second call
    // while getUserMedia is still pending (e.g. a fast double-click into the
    // conversation lobby) must await the SAME call, not start a second
    // concurrent getUserMedia prompt that would orphan the first stream.
    localMediaPreviewPromise: null,
    // The pending setTimeout id for the delayed auto-preview (Section F6
    // follow-up, bug report 2026-07-17) -- must be cancelled on logout/
    // channel-close, otherwise it fires after teardown and re-acquires
    // camera/mic for a session that no longer exists (exec review finding).
    localMediaPreviewTimeoutId: null,
    // Own display name (Section 16), loaded from profile.js's unencrypted
    // nickname record on create/unlock; null in ephemeral quick-chat mode.
    nickname: null,
    // Section FT2 (specs/phase4/file-transfer.md): outbound file-offers this
    // side originated, keyed by fileId, holding the already-chunked buffer
    // ready to stream the instant a matching file-accept arrives. An entry
    // is removed once fully sent, rejected, or the peer session resets.
    outgoingFileTransfers: {},
    // Inbound transfers this side has ACCEPTED (has a live assembler for),
    // keyed by fileId. A file-offer alone does NOT create an entry here --
    // only after the user clicks Accept -- see pendingFileOffers below.
    incomingFileTransfers: {},
    // Inbound file-offers awaiting the user's accept/reject decision, keyed
    // by fileId -- distinct from incomingFileTransfers so an unaccepted
    // offer never has an assembler (and therefore can never accept chunks).
    pendingFileOffers: {},
    // Section GC3 (specs/phase4/group-chats.md): which group's conversation
    // (if any) the shared conversation-screen UI is currently routed to --
    // null means "ordinary 1:1 chat" (the pre-GC3 default). Set by
    // openGroupConversation(), cleared by enterConversationLobby() (every
    // 1:1 session-entry path routes through there).
    activeGroupId: null,
    // Section GC3 exec-review iter1 finding: serializes wireChannelCallbacks'
    // onMessage across EVERY connection (see its own comment below) so
    // activeConnectionId is never rebound by two overlapping in-flight
    // message dispatches at once.
    messageDispatchLock: Promise.resolve()
  };

  // Section GC0 (specs/phase4/group-chats.md): connectionId generator --
  // same random-hex pattern used elsewhere in this file/codebase for IDs
  // (e.g. randomSenderKey below, historyStore.js's message-key suffix).
  function randomConnectionId() {
    return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // The full per-connection field set (Section GC0). `groupId: null` marks a
  // plain 1:1 connection, not (yet) attached to any group -- GC1-GC3 will
  // set this when a connection is created as part of a group.
  function createPeerEntry() {
    return {
      pc: null,
      channel: null,
      sessionKey: null,
      sessionEcdhWires: null,
      sendChainKey: null,
      receiveChainKey: null,
      peerFingerprint: null,
      peerIdentityPublicKey: null,
      isInviteOwner: false,
      groupId: null
    };
  }

  // Returns the currently-active peer entry, or undefined if there is none
  // (no session started yet, or the last one was torn down). This is the
  // ONLY 1:1-mode accessor every existing call site should use going
  // forward -- exposed for tests/future GC1-GC3 use via initApp's return
  // value.
  function getActivePeer() {
    return state.activeConnectionId ? state.peers.get(state.activeConnectionId) : undefined;
  }

  // Lazily creates a fresh peer entry (and makes it active) if none is
  // active yet, otherwise returns the existing active entry unchanged --
  // this is what lets state.pc = ... (etc, via the PEER_PROXY_FIELDS
  // setters below) keep working exactly like a plain assignment to a
  // single global slot for the 1:1 case, while still being backed by the
  // Map underneath.
  function ensureActivePeer() {
    let entry = getActivePeer();
    if (!entry) {
      const connectionId = randomConnectionId();
      entry = createPeerEntry();
      state.peers.set(connectionId, entry);
      state.activeConnectionId = connectionId;
    }
    return entry;
  }

  // For future group use (GC1-GC3): look up a peer entry by the fingerprint
  // of its VERIFIED peer identity. Unused by any 1:1 call site in this
  // section -- present now so GC1-GC3 doesn't need another state-shape
  // change.
  function getPeerByFingerprint(fingerprint) {
    for (const entry of state.peers.values()) {
      if (entry.peerFingerprint === fingerprint) return entry;
    }
    return undefined;
  }

  // For future group use (GC1-GC3): look up a peer entry directly by its
  // connectionId.
  function getPeerByConnectionId(connectionId) {
    return state.peers.get(connectionId);
  }

  // Tears down the CURRENTLY active connection: deletes its entry from
  // state.peers outright (rather than nulling fields on it, which would
  // leave a stale all-null entry behind -- an explicit spec requirement for
  // this section) and clears activeConnectionId. Every former "reset these
  // ~9 fields to null/false" teardown call site in this file now calls this
  // instead.
  function resetActiveConnection() {
    if (state.activeConnectionId) state.peers.delete(state.activeConnectionId);
    state.activeConnectionId = null;
  }

  // Section GC0: transparent proxy so every existing direct read/write of
  // state.pc / state.channel / state.sessionKey / state.sessionEcdhWires /
  // state.sendChainKey / state.receiveChainKey / state.peerFingerprint /
  // state.peerIdentityPublicKey / state.isInviteOwner throughout this file
  // keeps working unchanged, while the data actually lives in the active
  // entry of state.peers. Reading before any connection exists returns the
  // same "empty" value the old single-slot fields used to hold (null, or
  // false for isInviteOwner); writing lazily creates the active entry if
  // needed (ensureActivePeer), matching the old behavior where assigning to
  // any of these fields "just worked" regardless of prior state.
  const PEER_PROXY_FIELDS = [
    "pc",
    "channel",
    "sessionKey",
    "sessionEcdhWires",
    "sendChainKey",
    "receiveChainKey",
    "peerFingerprint",
    "peerIdentityPublicKey",
    "isInviteOwner"
  ];
  for (const field of PEER_PROXY_FIELDS) {
    Object.defineProperty(state, field, {
      enumerable: true,
      configurable: true,
      get() {
        const entry = getActivePeer();
        if (!entry) return field === "isInviteOwner" ? false : null;
        return entry[field];
      },
      set(value) {
        ensureActivePeer()[field] = value;
      }
    });
  }

  // Runtime values must survive language switches: the first dynamic write
  // strips the element's data-i18n so applyTranslations stops touching it.
  const setDynamicText = (element, text) => {
    element.removeAttribute("data-i18n");
    element.textContent = text;
  };
  const setStatus = (text) => {
    setDynamicText(el("connection-status"), text);
    // Section F6 follow-up (exec review): a guard message can fire while the
    // user is still on the "room" screen, BEFORE enterConversationLobby()
    // ever navigates away -- mirror it there too so it isn't invisible.
    const roomStatus = el("room-status");
    if (roomStatus) setDynamicText(roomStatus, text);
  };
  // Section P4 (security-hardening.md, exec review finding): every site that
  // resets state.peerFingerprint to null (logout, starting a fresh session,
  // joining a new one) must also hide a hint left over from a PREVIOUS
  // peer -- otherwise it stays visible, misleadingly labeled as being about
  // whichever peer connects next.
  const hideSafetyNumberHint = () => {
    const hintEl = el("safety-number-hint");
    if (hintEl) hintEl.hidden = true;
    // Section RF10: don't carry a "shared" choice over into an unrelated
    // next session/peer -- each new peer starts back at the default.
    state.safetyHintVisible = false;
    state.sharedSafetyNumber = null;
    state.safetyDisplayMode = "peer";
    // Section FT2 (file-transfer.md): every site that resets peerFingerprint
    // (logout, starting a fresh session, joining a new one) also invalidates
    // any in-flight file transfers with the PREVIOUS peer -- an outgoing
    // transfer must not keep streaming chunks into a channel that now
    // belongs to a different (or no) peer, and stale incoming offers/
    // assemblers from the old peer must not linger to be silently resumed
    // by a same-fileId collision from a new peer.
    state.outgoingFileTransfers = {};
    state.incomingFileTransfers = {};
    state.pendingFileOffers = {};
    const offerBanner = el("file-offer-banner");
    if (offerBanner) offerBanner.hidden = true;
  };
  // Section RF10: re-renders the safety-number banner from current state
  // (peerFingerprint/sharedSafetyNumber/safetyDisplayMode) -- called after
  // computing a fresh value AND after either toggling locally or receiving
  // the peer's toggle, so both call sites share one rendering path instead
  // of drifting apart.
  function renderSafetyHint() {
    const hintEl = el("safety-number-hint");
    if (!hintEl) return;
    if (!state.safetyHintVisible || !state.peerFingerprint) {
      hintEl.hidden = true;
      return;
    }
    hintEl.hidden = false;
    const shared = state.safetyDisplayMode === "shared" && state.sharedSafetyNumber;
    const value = shared ? state.sharedSafetyNumber : state.peerFingerprint;
    const textEl = el("safety-hint-text");
    if (textEl) {
      setDynamicText(
        textEl,
        shared ? t("safety.hintShared", { code: value }) : t("safety.hint", { fp: formatSpiritId(value) })
      );
    }
    const emojiEl = el("safety-hint-emoji");
    if (emojiEl) emojiEl.textContent = hexToEmoji(value);
    const toggleBtn = el("btn-safety-toggle-mode");
    if (toggleBtn) {
      setDynamicText(toggleBtn, shared ? t("safety.switchToPeer") : t("safety.switchToShared"));
    }
  }
  // Section RF10: tells whichever peer(s) are currently connected to switch
  // their own display to match -- the whole point of the toggle is that
  // both sides look at the same kind of value at the same time. Mirrors
  // sendGroupMessage's fan-out shape for the group case (best-effort, one
  // recipient's failure doesn't block the others).
  async function broadcastSafetyDisplayMode() {
    const payload = JSON.stringify({ type: "safety-display-mode", mode: state.safetyDisplayMode });
    if (state.activeGroupId) {
      for (const peer of state.peers.values()) {
        if (peer.groupId !== state.activeGroupId || !peer.channel || !peer.sessionKey) continue;
        try {
          peer.channel.send(await encryptMessage(peer.sessionKey, payload));
        } catch {
          // Best-effort fan-out, same philosophy as broadcastGroupMemberJoined.
        }
      }
      return;
    }
    if (state.channel && state.sessionKey) {
      state.channel.send(await encryptMessage(state.sessionKey, payload));
    }
  }
  el("btn-safety-toggle-mode")?.addEventListener("click", () => {
    state.safetyDisplayMode = state.safetyDisplayMode === "shared" ? "peer" : "shared";
    renderSafetyHint();
    void broadcastSafetyDisplayMode();
  });
  const setGoogleStatus = (text) => {
    el("google-verify-status").textContent = text;
  };
  const formatClockTime = (ms) => {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  // direction: "out" (this device sent it) or "in" (received from the peer).
  // imported (Section I3, specs/phase2b/import.md): true for a message that
  // came from parseChatExport + a manual match rather than a live P2P
  // handshake -- it never went through E2EE, so it gets a visible
  // "історичне (імпортоване)" badge distinguishing it from native messages.
  // Renders one message as an actual bubble element (not a text-blob append)
  // -- UI redesign (specs/ui/persistent-sidebar.md follow-up): visually
  // matches the agreed mockup's chat bubbles. A trailing "\n" text node
  // after each bubble keeps `chat-log.textContent` newline-delimited per
  // message, same as the old format, so existing line-splitting tests
  // (e.g. the imported-history-badge test) keep working unchanged --
  // `textContent` concatenates all descendant text with no added
  // whitespace between elements, so that separator has to be explicit.
  // `pending` (Section RF9): renders a queued-not-yet-sent outgoing message
  // (no active connection when the user sent it) with a small badge, and
  // returns the row so the caller can strip that badge off once the
  // message actually goes out -- same badge-then-clear shape as the
  // existing imported-history badge above it.
  const appendChat = (text, direction, timestamp = Date.now(), imported = false, pending = false) => {
    const log = el("chat-log");
    if (!log) return null;
    const row = doc.createElement("div");
    row.className = direction === "out" ? "row-out" : "row-in";
    const bubble = doc.createElement("div");
    bubble.className = "bubble";
    if (imported) {
      const badge = doc.createElement("span");
      badge.className = "imported-badge";
      badge.textContent = t("import.historyBadge");
      bubble.appendChild(badge);
      bubble.appendChild(doc.createElement("br"));
    }
    bubble.appendChild(doc.createTextNode(text));
    const meta = doc.createElement("span");
    meta.className = "bubble-meta";
    meta.textContent = formatClockTime(timestamp);
    if (pending) {
      const pendingWrap = doc.createElement("span");
      pendingWrap.className = "pending-badge-wrap";
      const pendingBadge = doc.createElement("span");
      pendingBadge.className = "pending-badge";
      pendingBadge.textContent = t("chat.queuedBadge");
      pendingWrap.appendChild(pendingBadge);
      pendingWrap.appendChild(doc.createElement("br"));
      bubble.appendChild(pendingWrap);
    }
    bubble.appendChild(meta);
    row.appendChild(bubble);
    log.appendChild(row);
    log.appendChild(doc.createTextNode("\n"));
    log.scrollTop = log.scrollHeight;
    return row;
  };
  // Clears a row's pending badge once its message actually goes out --
  // no-op if the row was never marked pending (or is gone/undefined).
  function clearPendingBadge(row) {
    row?.querySelector(".pending-badge-wrap")?.remove();
  }

  // Section GC3 (specs/phase4/group-chats.md): the group-conversation
  // equivalent of appendChat -- rendered into its own container (#group-chat-log,
  // separate from #chat-log) since a group conversation shows WHO said what,
  // unlike 1:1 chat where the peer is implicit. `senderLabel` is ignored for
  // outbound messages (always "you").
  const appendGroupChat = (text, direction, senderLabel, timestamp = Date.now()) => {
    const container = el("group-chat-log");
    if (!container) return;
    const label = direction === "out" ? t("groups.you") : senderLabel;
    const row = doc.createElement("div");
    row.className = direction === "out" ? "row-out" : "row-in";
    const bubble = doc.createElement("div");
    bubble.className = "bubble";
    const sender = doc.createElement("span");
    sender.className = "bubble-sender";
    sender.textContent = label;
    bubble.appendChild(sender);
    bubble.appendChild(doc.createElement("br"));
    bubble.appendChild(doc.createTextNode(text));
    const meta = doc.createElement("span");
    meta.className = "bubble-meta";
    meta.textContent = formatClockTime(timestamp);
    bubble.appendChild(meta);
    row.appendChild(bubble);
    container.appendChild(row);
    container.appendChild(doc.createTextNode("\n"));
    container.scrollTop = container.scrollHeight;
  };

  // Once identity is established, an invite-link visitor should land where
  // they can immediately join (room), not the usual profile-admin screen.
  const postIdentityRoute = () => (cameFromInviteLink ? "room" : "profile");

  const setInviteStatus = (text) => {
    el("invite-status").textContent = text;
  };

  // Factored out of copyInviteLink so the GC2 group-invite flow (which
  // never touches #room-id/#invite-token, since it may mint several
  // invites in one action) can build the same link text.
  // Section GC3: `groupId` optional third arg appends `&group=` so a
  // group-invite link (GC2's startTaggedGroupInvite) can be tagged the same
  // way room/token already are -- 1:1 invites (copyInviteLink) never pass
  // it, so their link shape is byte-for-byte unchanged.
  function buildInviteLinkText(roomId, inviteToken, groupId) {
    const link = new URL(doc.defaultView.location.pathname, doc.defaultView.location.origin);
    let search = `?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(inviteToken)}`;
    if (groupId) search += `&group=${encodeURIComponent(groupId)}`;
    link.search = search;
    link.hash = "#/room";
    return link.toString();
  }

  function copyInviteLink() {
    const roomId = el("room-id").value;
    const inviteToken = el("invite-token").value;
    if (!roomId || !inviteToken) {
      setInviteStatus(t("room.inviteMissing"));
      return;
    }
    const linkText = buildInviteLinkText(roomId, inviteToken);

    el("invite-link-display").textContent = linkText;
    setInviteStatus(t("room.inviteCopied"));
    // Best-effort: Clipboard API needs a secure context and isn't available
    // in every environment (jsdom, http://, older browsers) -- the visible
    // link text above is the reliable fallback either way.
    if (doc.defaultView.navigator.clipboard && doc.defaultView.navigator.clipboard.writeText) {
      doc.defaultView.navigator.clipboard.writeText(linkText).catch(() => {});
    }
  }
  el("btn-copy-invite").addEventListener("click", copyInviteLink);

  // Section F5 (specs/ui/ephemeral-spirit-mode.md): a temp nickname banner on
  // the conversation screen itself, shown only in ephemeral mode (a nickname
  // exists but there's no permanent-profile vault) -- a profile-mode identity
  // with its own nickname (Section 16) has no need for this, since it isn't
  // "one-time" in the same sense.
  function renderEphemeralBanner() {
    const banner = el("ephemeral-identity-banner");
    if (!banner) return;
    const isEphemeral = !!state.nickname && !(state.identityKeyPair && state.identityKeyPair.vaultKey);
    banner.hidden = !isEphemeral;
    if (isEphemeral) {
      el("ephemeral-nickname-display").textContent = state.nickname;
    }
  }

  // Section F6 (instant conversation lobby, 2026-07-17): the invite-copy
  // control is its own bar, independent of the ephemeral nickname banner --
  // it's for whichever side owns the pending invite (initiator, ephemeral OR
  // permanent-profile alike), not gated on ephemeral mode the way the
  // nickname display is.
  function renderInviteBar() {
    const bar = el("invite-bar");
    if (!bar) return;
    bar.hidden = !state.isInviteOwner;
  }
  el("btn-invite-from-chat").addEventListener("click", copyInviteLink);

  // Section H3 (specs/ui/chat-first-redesign.md): "Створити"/"Увійти" quick
  // actions in the header, visible only while no identity exists yet --
  // called at every identity-establishing/clearing point in this file,
  // mirroring the existing resetOwnProofsState() call-site pattern.
  function renderGuestQuickActions() {
    const bar = el("guest-quick-actions");
    if (!bar) return;
    bar.hidden = !!state.senderKey;
  }
  renderGuestQuickActions(); // set the correct initial visibility on load

  // Section PN4 (specs/phase5/push-notifications.md): the notifications
  // toggle only makes sense for a permanent profile (vaultKey present) --
  // ephemeral "spirits" have nowhere to persist a subscription. Same
  // call-site pattern as renderGuestQuickActions: called at every
  // identity-establishing/clearing point.
  function renderNotificationsCard() {
    const card = el("notifications-card");
    if (!card) return;
    card.hidden = !(state.identityKeyPair && state.identityKeyPair.vaultKey);
  }
  renderNotificationsCard();
    renderRecoveryCard(); // set the correct initial visibility on load

  // Section S2 (specs/phase5/social-recovery.md): same visibility gate as
  // renderNotificationsCard -- social recovery only makes sense for a
  // permanent profile (there is an identity worth protecting, and a vault
  // to re-derive the raw scalar from via the passphrase). Renders the list
  // of verified contacts as checkboxes (min 2 selectable), a threshold
  // <select> defaulting to "majority" (Math.ceil((N+1)/2)), and the list of
  // shares this device currently holds on behalf of OTHER people.
  async function renderRecoveryCard() {
    const card = el("recovery-card");
    if (!card) return;
    const isPermanentProfile = !!(state.identityKeyPair && state.identityKeyPair.vaultKey);
    card.hidden = !isPermanentProfile;
    if (!isPermanentProfile) return;

    const list = el("recovery-contacts-list");
    if (list) {
      const contacts = await listContacts();
      list.innerHTML = "";
      for (const contact of contacts) {
        const row = doc.createElement("label");
        row.className = "field checkbox-field";
        const checkbox = doc.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.recoveryContactFingerprint = contact.fingerprint;
        const span = doc.createElement("span");
        span.textContent = contact.nickname ? `${contact.nickname} (${formatSpiritId(contact.fingerprint)})` : formatSpiritId(contact.fingerprint);
        row.appendChild(checkbox);
        row.appendChild(span);
        list.appendChild(row);
      }
    }
    renderRecoveryThresholdOptions();

    const heldList = el("recovery-held-list");
    if (heldList) {
      const held = await listTrustedShares();
      heldList.innerHTML = "";
      if (held.length === 0) {
        const empty = doc.createElement("p");
        empty.className = "hint";
        empty.textContent = t("recovery.noHeldShares");
        heldList.appendChild(empty);
      }
      for (const share of held) {
        const row = doc.createElement("div");
        row.className = "list-row";
        const label = doc.createElement("span");
        label.textContent = t("recovery.heldFor", { fp: formatSpiritId(share.ownerFingerprint) });
        row.appendChild(label);
        // Section S3: trustee-side "view/export a held share" -- read-only
        // reveal of ALREADY-STORED data via the same encodeShareAsText used
        // by the owner-side setup export (Section S2). No extra
        // re-authentication gate here (exec-review judgment call, Section
        // S3): a single share below `threshold` is information-theoretically
        // useless on its own (Shamir's guarantee, shamir.js), so showing it
        // to whoever is already using this unlocked device/session reveals
        // nothing exploitable alone -- unlike revealing a full mnemonic or
        // keyfile passphrase, which by itself reconstructs the entire key.
        const showButton = doc.createElement("button");
        showButton.type = "button";
        showButton.textContent = t("recovery.showAsText");
        showButton.dataset.showHeldShareFor = share.ownerFingerprint;
        row.appendChild(showButton);
        heldList.appendChild(row);
      }
    }
  }

  el("recovery-held-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-show-held-share-for]");
    if (!button) return;
    const ownerFingerprint = button.dataset.showHeldShareFor;
    const share = await getTrustedShare(ownerFingerprint);
    const textEl = el("recovery-held-share-text");
    if (!textEl || !share) return;
    textEl.hidden = false;
    const shareText = encodeShareAsText(share);
    textEl.textContent = shareText;
    const qrEl = el("recovery-held-share-qr");
    if (qrEl) {
      qrEl.hidden = false;
      qrEl.innerHTML = qrSvgMarkup(shareText);
    }
  });

  /**
   * Rebuilds the threshold <select>'s options for the CURRENTLY checked
   * contact count N ([2, N]), keeping the "majority" default
   * (Math.ceil((N+1)/2), Section S2 decision) selected unless the user
   * already picked a different value that's still valid for the new N.
   */
  function renderRecoveryThresholdOptions() {
    const select = el("recovery-threshold");
    if (!select) return;
    const n = doc.querySelectorAll("[data-recovery-contact-fingerprint]:checked").length;
    const previous = select.value ? Number(select.value) : null;
    select.innerHTML = "";
    if (n < 2) return;
    const defaultThreshold = Math.ceil((n + 1) / 2);
    for (let k = 2; k <= n; k++) {
      const option = doc.createElement("option");
      option.value = String(k);
      option.textContent = `${k} / ${n}`;
      select.appendChild(option);
    }
    select.value = String(previous && previous >= 2 && previous <= n ? previous : defaultThreshold);
  }
  el("recovery-contacts-list")?.addEventListener("change", renderRecoveryThresholdOptions);

  const setRecoveryStatus = (text) => {
    const status = el("recovery-status");
    if (status) status.textContent = text;
  };

  // el("btn-setup-recovery") may be absent (older/minimal test fixtures that
  // don't include the recovery card markup) -- guard like the other
  // optional-element listeners in this file (e.g. notifications-enabled)
  // rather than assuming withBusyButton's non-null button.
  if (el("btn-setup-recovery")) withBusyButton(el("btn-setup-recovery"), async () => {
    const selected = [...doc.querySelectorAll("[data-recovery-contact-fingerprint]:checked")].map(
      (checkbox) => checkbox.dataset.recoveryContactFingerprint
    );
    if (selected.length < 2) {
      setRecoveryStatus(t("recovery.needTwoContacts"));
      return;
    }
    const threshold = Number(el("recovery-threshold").value);
    if (!Number.isInteger(threshold) || threshold < 2 || threshold > selected.length) {
      setRecoveryStatus(t("recovery.badThreshold"));
      return;
    }
    const passphrase = el("recovery-setup-passphrase").value;
    if (!passphrase) {
      setRecoveryStatus(t("unlock.needPassphrase"));
      return;
    }
    if (!state.senderKey) {
      setRecoveryStatus(t("status.createAccountFirst"));
      return;
    }

    // Re-deriving the raw identity from the vault (same pattern as
    // btn-link-device) is REQUIRED here: a logged-in permanent profile's
    // state.identityKeyPair.privateKey is deliberately non-extractable
    // (profile.js's reconstructKeyPairFromRaw), so the 32-byte scalar
    // cannot be read off it directly -- exportRawIdentity re-decrypts the
    // vault under the just-entered passphrase and hands back extractable
    // raw key bytes, from which the scalar can be exported. This works
    // identically for a portable account or a plain permanent profile.
    const identityRaw = await exportRawIdentity(state.senderKey, passphrase);
    el("recovery-setup-passphrase").value = "";
    const extractableKey = await importPrivateKeyRaw(identityRaw, { name: "ECDSA", namedCurve: "P-256" }, true);
    const scalar = await exportPrivateKeyScalar(extractableKey);

    const shares = splitSecret(scalar, { threshold, shares: selected.length });
    const exportRows = [];
    for (let i = 0; i < selected.length; i++) {
      const contactFingerprint = selected[i];
      const share = shares[i];
      exportRows.push({ contactFingerprint, shareText: encodeShareAsText(share) });
      if (contactFingerprint === state.peerFingerprint && state.channel && state.sessionKey) {
        // Currently connected to this contact right now -- send immediately,
        // no need to queue. Also drop any STALE entry left over from an
        // earlier setup run (exec review iter1 finding) -- otherwise it
        // would later overwrite this fresh share with one from a
        // superseded, incompatible split.
        state.channel.send(
          await encryptMessage(state.sessionKey, JSON.stringify(buildRecoveryShareAnnounce(share)))
        );
        await dequeueRecoveryShareForContact(contactFingerprint);
      } else {
        // Not connected to this contact right now -- persist for delivery
        // the next time their identity-announce is verified (drained in
        // handleChatMessage's identity-announce branch).
        await queueRecoveryShareForContact(contactFingerprint, share);
      }
    }

    const exportEl = el("recovery-text-export");
    if (exportEl) {
      exportEl.hidden = false;
      exportEl.innerHTML = "";
      // Один QR-код на рядок -- саме на ТОЙ shareText, що показаний поруч,
      // не на весь список одразу. Показувати комусь QR усього списку
      // означало б розкрити чужі частки поряд зі своєю -- кожен довірений
      // контакт має сканувати лише свій власний рядок.
      for (const { contactFingerprint, shareText } of exportRows) {
        const row = doc.createElement("div");
        row.className = "recovery-share-export-row";
        const label = doc.createElement("div");
        label.textContent = formatSpiritId(contactFingerprint);
        row.appendChild(label);
        const text = doc.createElement("div");
        text.className = "secret-output";
        text.textContent = shareText;
        row.appendChild(text);
        const qr = doc.createElement("div");
        qr.className = "recovery-share-qr";
        qr.innerHTML = qrSvgMarkup(shareText);
        row.appendChild(qr);
        exportEl.appendChild(row);
      }
    }
    setRecoveryStatus(t("recovery.setupDone", { n: selected.length, k: threshold }));
    await renderRecoveryCard();
  });

  // Section E (specs/phase2c/identity-verification.md): in-memory verification
  // status per (contact fingerprint, proof url) -- re-derived from a live
  // fetch each check, so it doesn't need to survive a reload. `null`
  // verifiedAt/failedAt means "not checked yet this session".
  const PROOF_FAILURE_THRESHOLD = 3;
  const proofVerification = new Map();
  const proofVerificationKey = (fingerprint, url) => `${fingerprint}|${url}`;

  async function renderContactsScreen() {
    const list = el("contacts-list");
    const empty = el("contacts-empty");
    if (!list || !empty) return; // screen not present in this document (e.g. older test fixture)
    const contacts = await listContacts();
    list.innerHTML = "";
    empty.hidden = contacts.length > 0;

    // Секція RF3 (shape-coded avatar system, "Тінь"): ефемерна "духова"
    // сесія (F3, specs/ui/ephemeral-spirit-mode.md) НЕ є контактом -- за
    // архітектурним інваріантом D1 (zero-database) нічого про неї не
    // зберігається, тож у папку/фільтр вона не потрапляє і зникає, щойно
    // з'єднання завершено. Це лише живий покажчик "зараз є активна ефемерна
    // розмова" -- shape-ghost-аватар, клік повертає до екрана розмови.
    // Умова -- та сама, що вже використовує ephemeral-identity-banner
    // (isEphemeral, рядок ~574): є тимчасовий нік, але немає vaultKey.
    const isEphemeral = !!state.nickname && !(state.identityKeyPair && state.identityKeyPair.vaultKey);
    if (isEphemeral && state.activeConnectionId) {
      const ghostRow = doc.createElement("div");
      ghostRow.className = "list-row";
      ghostRow.dataset.ephemeralSession = "1";
      const avatar = doc.createElement("div");
      avatar.className = "avatar shape-ghost";
      avatar.innerHTML = buildIdenticonSvg(state.activeConnectionId);
      ghostRow.appendChild(avatar);
      const cMain = doc.createElement("div");
      cMain.className = "c-main";
      const cTop = doc.createElement("div");
      cTop.className = "c-top";
      const nameEl = doc.createElement("span");
      nameEl.className = "contact-name";
      nameEl.textContent = state.nickname;
      cTop.appendChild(nameEl);
      cMain.appendChild(cTop);
      ghostRow.appendChild(cMain);
      ghostRow.addEventListener("click", () => router.navigate("conversation"));
      list.appendChild(ghostRow);
      empty.hidden = true;
    }

    for (const contact of contacts) {
      const row = doc.createElement("div");
      row.className = "list-row";
      row.dataset.contactFingerprint = contact.fingerprint;
      row.draggable = true;
      row.addEventListener("dragstart", () => {
        contactDragFingerprint = contact.fingerprint;
      });
      row.addEventListener("dragend", () => {
        contactDragFingerprint = null;
      });

      // Секція RF2 (specs/ui/redesign-foundation.md): identicon-аватар,
      // детермінований з fingerprint. Кожен контакт у цьому списку -- TOFU-
      // контакт із постійним профілем, тож форма завжди "shape-user" (коло);
      // "shape-group"/"shape-ghost" -- ті самі квадрат/привид-класи, що
      // тепер рендеряться нижче для груп і для активної ефемерної сесії.
      const avatar = doc.createElement("div");
      avatar.className = "avatar shape-user";
      avatar.innerHTML = buildIdenticonSvg(contact.fingerprint);
      row.appendChild(avatar);

      // Two-line row layout (UI redesign follow-up to SD1, matching the
      // agreed mockup): avatar on the left, name+trust-shield on the top
      // line, proof badges + message button on the line below. Nesting
      // doesn't affect existing selectors -- row.querySelector(...) finds
      // these by class/attribute regardless of depth.
      const cMain = doc.createElement("div");
      cMain.className = "c-main";
      const cTop = doc.createElement("div");
      cTop.className = "c-top";
      const cSub = doc.createElement("div");
      cSub.className = "c-sub";
      cMain.appendChild(cTop);
      cMain.appendChild(cSub);
      row.appendChild(cMain);

      const nameEl = doc.createElement("span");
      nameEl.className = "contact-name";
      nameEl.textContent = contact.nickname
        ? `${contact.nickname} (${formatSpiritId(contact.fingerprint)})`
        : formatSpiritId(contact.fingerprint);
      cTop.appendChild(nameEl);

      // Фаза 4 (docs/roadmap.md, TOFU-прогалина зафіксована 2026-07-18):
      // identity-announce вже автентифікує ECDH-сесію (Секція 12), але сам
      // identity-ключ при ПЕРШІЙ зустрічі приймається без позаканального
      // доказу (TOFU). Наявні proof-механізми (2c/2d) досі опційні й
      // непомітні. Секція RF2: замінює текстовий "не підтверджено" бейдж на
      // іконку щита довіри -- заповнений з галочкою, якщо хоч один proof
      // наразі показує підтверджений verifiedAt, інакше контурний (той самий
      // випадок, що й "жодного proof взагалі"). Текстовий еквівалент
      // лишається через aria-label/title для доступності.
      const hasVerifiedProof = (contact.proofSet?.proofs ?? []).some((proof) => {
        const v = proofVerification.get(proofVerificationKey(contact.fingerprint, proof.url));
        return !!v?.verifiedAt;
      });
      const shield = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
      shield.setAttribute("viewBox", "0 0 24 24");
      shield.setAttribute("class", hasVerifiedProof ? "trust-shield trust-shield-verified" : "trust-shield");
      shield.setAttribute("role", "img");
      const shieldLabel = hasVerifiedProof ? t("contacts.verified") : t("contacts.unverified");
      shield.setAttribute("aria-label", shieldLabel);
      const shieldTitle = doc.createElementNS("http://www.w3.org/2000/svg", "title");
      shieldTitle.textContent = shieldLabel;
      shield.appendChild(shieldTitle);
      const shieldPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
      shieldPath.setAttribute("d", "M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5l-8-3z");
      shieldPath.setAttribute("fill", "none");
      shieldPath.setAttribute("stroke", "currentColor");
      shieldPath.setAttribute("stroke-width", "1.5");
      shield.appendChild(shieldPath);
      if (hasVerifiedProof) {
        const checkPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        checkPath.setAttribute("d", "M8.5 12.5l2.5 2.5 4.5-5");
        checkPath.setAttribute("fill", "none");
        checkPath.setAttribute("stroke", "currentColor");
        checkPath.setAttribute("stroke-width", "1.5");
        shield.appendChild(checkPath);
      }
      shield.setAttribute("title", shieldTitle.textContent);
      cTop.appendChild(shield);
      row.dataset.verified = hasVerifiedProof ? "1" : "0";

      for (const proof of contact.proofSet?.proofs ?? []) {
        const badge = doc.createElement("span");
        badge.className = "proof-badge";
        const v = proofVerification.get(proofVerificationKey(contact.fingerprint, proof.url));
        if (v?.verifiedAt) {
          badge.textContent = ` ${proof.label}: ${t("proofs.verifiedAt", { date: new Date(v.verifiedAt).toLocaleString() })}`;
        } else if (v && v.consecutiveFailures >= PROOF_FAILURE_THRESHOLD) {
          badge.textContent = ` ${proof.label}: ${t("proofs.failedSince", { date: new Date(v.failedAt).toLocaleString() })}`;
        } else {
          badge.textContent = ` ${proof.label}`;
        }
        cSub.appendChild(badge);
      }
      const messageButton = doc.createElement("button");
      messageButton.type = "button";
      messageButton.className = "btn-icon";
      messageButton.dataset.i18n = "contacts.message";
      messageButton.textContent = t("contacts.message");
      cSub.appendChild(messageButton);
      list.appendChild(row);
    }

    // Секція RF3 (UI redesign follow-up, узгоджена концепція "Тінь"):
    // групи тепер показуються в тому самому сайдбар-списку, що й контакти
    // -- квадратна identicon-аватарка (shape-group), клік відкриває групову
    // розмову напряму, без переходу через екран "Керування". Групи можуть
    // прив'язуватись до папок тим самим drag&drop-шляхом, що й контакти
    // (нижче) -- те саме single-membership правило, той самий гейт на
    // folderEditMode. Груп немає у verified-фільтрі (немає proof-семантики),
    // звичайний пошук і далі працює через textContent.
    const groups = await listGroups();
    for (const group of groups) {
      const row = doc.createElement("div");
      row.className = "list-row";
      row.dataset.groupId = group.groupId;
      row.draggable = true;
      row.addEventListener("dragstart", () => {
        groupDragId = group.groupId;
      });
      row.addEventListener("dragend", () => {
        groupDragId = null;
      });

      const avatar = doc.createElement("div");
      avatar.className = "avatar shape-group";
      avatar.innerHTML = buildIdenticonSvg(group.groupId);
      row.appendChild(avatar);

      const cMain = doc.createElement("div");
      cMain.className = "c-main";
      const cTop = doc.createElement("div");
      cTop.className = "c-top";
      const nameEl = doc.createElement("span");
      nameEl.className = "contact-name";
      nameEl.textContent = group.name;
      cTop.appendChild(nameEl);
      cMain.appendChild(cTop);
      row.appendChild(cMain);

      row.addEventListener("click", () => openGroupConversation(group.groupId, group.name));
      list.appendChild(row);
    }

    applyContactsFilter();
  }

  // Section PN5 (specs/phase5/push-notifications.md): a single delegated
  // listener on the list container, rather than one per row (rows are
  // rebuilt on every renderContactsScreen() call). Every contact shown here
  // is, by construction, a saved contact with no live P2P channel right now
  // (if one existed, the app would already be on the conversation screen,
  // not the contacts list) -- so there is no separate "is this contact
  // online" check needed before starting a fresh invite-based session.
  el("contacts-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-i18n='contacts.message']");
    if (!button) return;
    const row = button.closest("[data-contact-fingerprint]");
    const targetFingerprint = row?.dataset.contactFingerprint;
    if (!targetFingerprint) return;
    const contact = await getContact(targetFingerprint);
    await initiateChatSession({ pushToContact: contact ?? null });
  });

  // Sidebar search (UI redesign follow-up to SD1): plain client-side
  // substring filter over already-rendered #contacts-list rows -- no
  // separate index, no server round-trip. Static per the original
  // sidebar-filters chips design; this input is the one genuinely wired
  // piece of the sidebar's "Пошук" affordance in this pass.
  let contactsVerifiedOnly = false;
  let selectedFolderId = null;
  // Комбінований набір id-шок (contactFingerprints + groupIds) -- namespace
  // не перетинається на практиці (64-символьний hex fingerprint проти
  // 32-символьного hex groupId), а кожен рядок звіряється лише зі СВОЇМ
  // атрибутом (contactFingerprint або groupId), тож об'єднання безпечне.
  function collectFolderMemberIds(node) {
    let ids = [...(node.contactFingerprints || []), ...(node.groupIds || [])];
    for (const child of node.children) ids = ids.concat(collectFolderMemberIds(child));
    return ids;
  }
  function applyContactsFilter() {
    const query = (el("sidebar-search-input")?.value ?? "").trim().toLowerCase();
    const selectedFolder = selectedFolderId && findFolder(folders, selectedFolderId);
    const folderMemberIds = selectedFolder ? new Set(collectFolderMemberIds(selectedFolder)) : null;
    for (const row of doc.querySelectorAll("#contacts-list .list-row")) {
      const matchesQuery = query.length === 0 || row.textContent.toLowerCase().includes(query);
      const matchesVerified = !contactsVerifiedOnly || row.dataset.verified === "1";
      const rowMemberId = row.dataset.contactFingerprint ?? row.dataset.groupId;
      const matchesFolder = !folderMemberIds || folderMemberIds.has(rowMemberId);
      row.hidden = !matchesQuery || !matchesVerified || !matchesFolder;
    }
  }
  el("sidebar-search-input")?.addEventListener("input", applyContactsFilter);

  // Section RF3 (UI redesign follow-up): "Групи" now navigates to the
  // manage screen via router.js's existing .nav-item[data-route] auto-wiring
  // (see index.html), so only "Усі"/"Верифіковані" need a click handler here
  // -- they toggle contactsVerifiedOnly and re-run the same filter the
  // search box uses, rather than being a separate filtering path. "Усі"
  // also clears any active folder selection (see renderFolderTree below),
  // since it means "show every contact, no filter at all".
  el("chip-filter-all")?.addEventListener("click", () => {
    contactsVerifiedOnly = false;
    selectedFolderId = null;
    el("chip-filter-all")?.classList.add("chip-active");
    el("chip-filter-verified")?.classList.remove("chip-active");
    renderFolderTree();
    applyContactsFilter();
  });
  el("chip-filter-verified")?.addEventListener("click", () => {
    contactsVerifiedOnly = true;
    el("chip-filter-verified")?.classList.add("chip-active");
    el("chip-filter-all")?.classList.remove("chip-active");
    applyContactsFilter();
  });

  // Дерево папок (UI redesign follow-up, специфіковано в мокапі): вкладені,
  // необмежена глибина, drag&drop переміщення/вкладення папок ОДНА В ОДНУ,
  // localStorage-персистентність (пристрій-рівень, не IndexedDB/профіль --
  // та сама причина, що й `spirit.signalingNodes`, Секція multi-node-ui).
  // Прив'язка КОНТАКТІВ до папок (drag контакту з #contacts-list на рядок
  // папки, клік на папку фільтрує список) реалізована нижче -- модель
  // "один контакт в одній папці одночасно" (перетягнення в іншу папку
  // видаляє з попередньої), той самий ментальний принцип, що й звичайні
  // файлові менеджери. Синхронізація між пристроями лишається майбутньою
  // секцією (той самий локальний-лише статус, що й уся ця фіча).
  const FOLDER_STORAGE_KEY = "spirit.folders";
  function normalizeFolderNodes(nodes) {
    for (const n of nodes) {
      if (!Array.isArray(n.contactFingerprints)) n.contactFingerprints = [];
      if (!Array.isArray(n.groupIds)) n.groupIds = [];
      normalizeFolderNodes(n.children);
    }
    return nodes;
  }
  function loadFolders() {
    try {
      const raw = localStorage.getItem(FOLDER_STORAGE_KEY);
      return normalizeFolderNodes(raw ? JSON.parse(raw) : []);
    } catch {
      return [];
    }
  }
  function saveFolders(nodes) {
    try {
      localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(nodes));
    } catch {
      // Best-effort only -- a full/unavailable localStorage just means
      // folders won't persist across reloads, not a functional break.
    }
  }
  const folders = loadFolders();
  const folderCollapsed = new Set();
  let folderDragId = null;
  let contactDragFingerprint = null;
  let groupDragId = null;
  let folderRenamingId = null;
  let folderPendingDeleteId = null;
  // Один перемикач "олівець" на рівні заголовка "Мої папки" вмикає/вимикає
  // ВСІ структурні зміни (перейменування, видалення, додавання підпапки,
  // перетягування папок одна в одну, перетягування контакту на папку).
  // У вимкненому стані (типовий, за замовчуванням) папки працюють лише як
  // навігація -- згорнути/розгорнути (chev) і клік для фільтрації списку
  // контактів лишаються завжди активними незалежно від цього перемикача,
  // оскільки це не зміна структури, а звичайний перегляд.
  let folderEditMode = false;

  function removeFingerprintFromAllFolders(nodes, fingerprint) {
    for (const n of nodes) {
      n.contactFingerprints = n.contactFingerprints.filter((fp) => fp !== fingerprint);
      removeFingerprintFromAllFolders(n.children, fingerprint);
    }
  }
  function removeGroupIdFromAllFolders(nodes, groupId) {
    for (const n of nodes) {
      n.groupIds = n.groupIds.filter((id) => id !== groupId);
      removeGroupIdFromAllFolders(n.children, groupId);
    }
  }

  function findFolder(nodes, id) {
    for (const n of nodes) {
      if (n.id === id) return n;
      const found = findFolder(n.children, id);
      if (found) return found;
    }
    return null;
  }
  function isFolderDescendant(node, id) {
    if (node.id === id) return true;
    return node.children.some((c) => isFolderDescendant(c, id));
  }
  function removeFolder(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return nodes.splice(i, 1)[0];
      const found = removeFolder(nodes[i].children, id);
      if (found) return found;
    }
    return null;
  }
  function randomFolderId() {
    return "fd" + Math.random().toString(36).slice(2, 10);
  }
  // Видалення папки НЕ каскадно видаляє дочірні -- вони підіймаються на
  // рівень видаленої (той самий принцип, що й видалення папки у звичайному
  // файловому менеджері: втрачається сама папка й прив'язка ЇЇ ВЛАСНИХ
  // контактів, але не вкладений вміст). Повертає true, якщо щось видалено.
  function deleteFolder(nodes, id) {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        nodes.splice(i, 1, ...nodes[i].children);
        return true;
      }
      if (deleteFolder(nodes[i].children, id)) return true;
    }
    return false;
  }
  function renderFolderNodes(nodes) {
    return nodes
      .map((n) => {
        const collapsed = folderCollapsed.has(n.id);
        const hasKids = n.children.length > 0;
        const selected = selectedFolderId === n.id;
        const renaming = folderEditMode && folderRenamingId === n.id;
        const pendingDelete = folderEditMode && folderPendingDeleteId === n.id;
        const memberCount = n.contactFingerprints.length + n.groupIds.length;
        const nameMarkup = renaming
          ? `<input type="text" class="folder-rename-input" data-folder-rename-input>`
          : `<span class="folder-name"></span>` +
            (memberCount > 0 ? `<span class="folder-count">${memberCount}</span>` : "");
        const actionsMarkup = !folderEditMode
          ? ""
          : renaming
            ? `<span class="folder-actions">
                <button type="button" class="folder-action" data-folder-rename-save title="${t("sidebar.folderRenameSave")}">✓</button>
                <button type="button" class="folder-action" data-folder-rename-cancel title="${t("sidebar.folderRenameCancel")}">✕</button>
              </span>`
            : `<span class="folder-actions">
                <button type="button" class="folder-action" data-folder-rename title="${t("sidebar.folderRename")}">✎</button>
                <button type="button" class="folder-action" data-folder-add-child title="${t("sidebar.folderAddChild")}">+</button>
                <button type="button" class="folder-action folder-action-delete ${pendingDelete ? "confirming" : ""}" data-folder-delete title="${t(pendingDelete ? "sidebar.folderDeleteConfirm" : "sidebar.folderDelete")}">${pendingDelete ? "✓" : "×"}</button>
              </span>`;
        return `
          <div class="folder-row ${collapsed ? "collapsed" : ""} ${selected ? "selected" : ""}" data-folder-id="${n.id}" draggable="${folderEditMode && !renaming}">
            <span class="chev">${hasKids ? "▾" : ""}</span>
            ${nameMarkup}
            ${actionsMarkup}
          </div>
          ${hasKids ? `<div class="folder-children ${collapsed ? "collapsed" : ""}">${renderFolderNodes(n.children)}</div>` : ""}
        `;
      })
      .join("");
  }
  function renderFolderTree() {
    const treeEl = el("folder-tree");
    if (!treeEl) return;
    treeEl.innerHTML =
      `<div class="folder-tree-label"><span>${t("sidebar.foldersHeading")}</span>` +
      `<button type="button" class="folder-action ${folderEditMode ? "active" : ""}" data-folder-edit-toggle title="${t("sidebar.folderEditToggle")}">✎</button>` +
      (folderEditMode ? `<button type="button" data-add-folder title="${t("sidebar.addFolder")}">+</button>` : "") +
      `</div>` +
      renderFolderNodes(folders);
    treeEl.querySelector("[data-folder-edit-toggle]")?.addEventListener("click", () => {
      folderEditMode = !folderEditMode;
      if (!folderEditMode) {
        folderRenamingId = null;
        folderPendingDeleteId = null;
      }
      renderFolderTree();
    });
    treeEl.querySelectorAll("[data-folder-id]").forEach((rowEl) => {
      const id = rowEl.dataset.folderId;
      const node = findFolder(folders, id);
      if (!node) return;
      // Ім'я йде через textContent, а не в innerHTML-шаблон вище, тож
      // користувацька назва папки ніколи не зможе інʼєктнути розмітку.
      const nameEl = rowEl.querySelector(".folder-name");
      if (nameEl) nameEl.textContent = node.name;
      const renameInput = rowEl.querySelector("[data-folder-rename-input]");
      if (renameInput) {
        renameInput.value = node.name;
        renameInput.focus();
        renameInput.select();
      }

      rowEl.addEventListener("dragstart", () => {
        if (!folderEditMode) return;
        folderDragId = id;
      });
      rowEl.addEventListener("dragover", (event) => {
        if (!folderEditMode) return;
        event.preventDefault();
        if (contactDragFingerprint || groupDragId) {
          rowEl.classList.add("drag-over");
          return;
        }
        const dragged = folderDragId && findFolder(folders, folderDragId);
        if (dragged && folderDragId !== id && !isFolderDescendant(dragged, id)) {
          rowEl.classList.add("drag-over");
        }
      });
      rowEl.addEventListener("dragleave", () => rowEl.classList.remove("drag-over"));
      rowEl.addEventListener("click", (event) => {
        if (event.target.closest(".chev") || event.target.closest(".folder-actions") || event.target.closest("[data-folder-rename-input]")) return;
        selectedFolderId = selectedFolderId === id ? null : id;
        folderPendingDeleteId = null;
        renderFolderTree();
        applyContactsFilter();
      });

      function commitRename() {
        const input = rowEl.querySelector("[data-folder-rename-input]");
        const value = input?.value.trim();
        if (value) node.name = value;
        folderRenamingId = null;
        saveFolders(folders);
        renderFolderTree();
      }
      renameInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") commitRename();
        if (event.key === "Escape") {
          folderRenamingId = null;
          renderFolderTree();
        }
      });
      rowEl.querySelector("[data-folder-rename-save]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        commitRename();
      });
      rowEl.querySelector("[data-folder-rename-cancel]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        folderRenamingId = null;
        renderFolderTree();
      });
      rowEl.querySelector("[data-folder-rename]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        folderRenamingId = id;
        folderPendingDeleteId = null;
        renderFolderTree();
      });
      rowEl.querySelector("[data-folder-add-child]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        node.children.push({ id: randomFolderId(), name: t("sidebar.newFolder"), children: [], contactFingerprints: [], groupIds: [] });
        folderCollapsed.delete(id);
        saveFolders(folders);
        renderFolderTree();
      });
      rowEl.querySelector("[data-folder-delete]")?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (folderPendingDeleteId !== id) {
          folderPendingDeleteId = id;
          renderFolderTree();
          return;
        }
        folderPendingDeleteId = null;
        if (selectedFolderId === id) selectedFolderId = null;
        deleteFolder(folders, id);
        saveFolders(folders);
        renderFolderTree();
        applyContactsFilter();
      });
      rowEl.addEventListener("drop", (event) => {
        if (!folderEditMode) return;
        event.preventDefault();
        rowEl.classList.remove("drag-over");
        // Dropping a contact assigns it to this folder (single-membership --
        // it's first removed from every other folder, same mental model as
        // an ordinary file manager), independent of the folder-onto-folder
        // reorder/nest path below.
        if (contactDragFingerprint) {
          const fingerprint = contactDragFingerprint;
          contactDragFingerprint = null;
          removeFingerprintFromAllFolders(folders, fingerprint);
          const target = findFolder(folders, id);
          if (target && !target.contactFingerprints.includes(fingerprint)) {
            target.contactFingerprints.push(fingerprint);
          }
          saveFolders(folders);
          renderFolderTree();
          applyContactsFilter();
          return;
        }
        if (groupDragId) {
          const groupId = groupDragId;
          groupDragId = null;
          removeGroupIdFromAllFolders(folders, groupId);
          const target = findFolder(folders, id);
          if (target && !target.groupIds.includes(groupId)) {
            target.groupIds.push(groupId);
          }
          saveFolders(folders);
          renderFolderTree();
          applyContactsFilter();
          return;
        }
        if (!folderDragId || folderDragId === id) return;
        const dragged = findFolder(folders, folderDragId);
        if (!dragged || isFolderDescendant(dragged, id)) return;
        removeFolder(folders, folderDragId);
        const target = findFolder(folders, id);
        target.children.push(dragged);
        folderCollapsed.delete(id);
        saveFolders(folders);
        renderFolderTree();
      });
      rowEl.querySelector(".chev")?.addEventListener("click", (event) => {
        event.stopPropagation();
        folderCollapsed.has(id) ? folderCollapsed.delete(id) : folderCollapsed.add(id);
        renderFolderTree();
      });
    });
    treeEl.querySelector("[data-add-folder]")?.addEventListener("click", () => {
      folders.push({ id: randomFolderId(), name: t("sidebar.newFolder"), children: [], contactFingerprints: [], groupIds: [] });
      saveFolders(folders);
      renderFolderTree();
    });
  }
  renderFolderTree();

  const setGroupStatus = (text) => {
    const status = el("group-status");
    if (status) status.textContent = text;
  };

  /**
   * Section GC2: renders the "create group" contact checkboxes (mirrors
   * #recovery-contacts-list's pattern exactly, Section S2) plus the list of
   * already-created groups, each with a per-group "add member" contact
   * picker for contacts not already in that group's roster.
   */
  async function renderGroupsCard() {
    const card = el("groups-card");
    if (!card) return;
    const contacts = await listContacts();

    const createList = el("group-contacts-list");
    if (createList) {
      createList.innerHTML = "";
      for (const contact of contacts) {
        const row = doc.createElement("label");
        row.className = "field checkbox-field";
        const checkbox = doc.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.groupContactFingerprint = contact.fingerprint;
        const span = doc.createElement("span");
        span.textContent = contact.nickname ? `${contact.nickname} (${formatSpiritId(contact.fingerprint)})` : formatSpiritId(contact.fingerprint);
        row.appendChild(checkbox);
        row.appendChild(span);
        createList.appendChild(row);
      }
    }

    const groupsList = el("groups-list");
    const groupsEmpty = el("groups-empty");
    if (groupsList) {
      const groups = await listGroups();
      groupsList.innerHTML = "";
      if (groupsEmpty) groupsEmpty.hidden = groups.length > 0;
      for (const group of groups) {
        const row = doc.createElement("div");
        row.className = "list-row";
        const label = doc.createElement("span");
        label.textContent = `${group.name} (${group.memberFingerprints.length})`;
        row.appendChild(label);

        // Section GC3 design point 5: opens this group's conversation in
        // the shared conversation-screen UI (openGroupConversation, wired
        // via the groups-list click delegate below).
        const openButton = doc.createElement("button");
        openButton.type = "button";
        openButton.textContent = t("btn.openGroup");
        openButton.dataset.openGroupBtn = group.groupId;
        openButton.dataset.openGroupName = group.name;
        row.appendChild(openButton);

        const addable = contacts.filter((c) => !group.memberFingerprints.includes(c.fingerprint));
        if (addable.length > 0) {
          const select = doc.createElement("select");
          select.dataset.addMemberSelect = group.groupId;
          for (const contact of addable) {
            const option = doc.createElement("option");
            option.value = contact.fingerprint;
            option.textContent = contact.nickname ? `${contact.nickname} (${formatSpiritId(contact.fingerprint)})` : formatSpiritId(contact.fingerprint);
            select.appendChild(option);
          }
          row.appendChild(select);
          const addButton = doc.createElement("button");
          addButton.type = "button";
          addButton.textContent = t("btn.addMember");
          addButton.dataset.addMemberBtn = group.groupId;
          row.appendChild(addButton);
        }
        groupsList.appendChild(row);
      }
    }
  }

  if (el("btn-create-group")) withBusyButton(el("btn-create-group"), async () => {
    const name = el("group-name").value.trim();
    const selected = [...doc.querySelectorAll("[data-group-contact-fingerprint]:checked")].map(
      (checkbox) => checkbox.dataset.groupContactFingerprint
    );
    if (!name) {
      setGroupStatus(t("groups.needName"));
      return;
    }
    if (!state.senderKey) {
      setGroupStatus(t("status.createAccountFirst"));
      return;
    }
    const group = await createGroup({ name, memberFingerprints: selected });
    const lines = [];
    // GC2 exec-review iter1 finding: only the FIRST selected contact gets a
    // real, live, listening session right now (startLiveSession: true) --
    // see startTaggedGroupInvite's doc comment for why running several
    // concurrent initiator handshakes would corrupt each other's session
    // state. Every other selected contact's invite link is minted
    // (createInvite only) for the owner to share out-of-band and connect
    // to individually later, one at a time.
    for (let i = 0; i < selected.length; i++) {
      const fingerprint = selected[i];
      const contact = await getContact(fingerprint);
      const memberLabel = contact?.nickname || formatSpiritId(fingerprint);
      const { roomId, inviteToken } = await startTaggedGroupInvite({ groupId: group.groupId, startLiveSession: i === 0 });
      lines.push(t("groups.inviteLine", { name: memberLabel, link: buildInviteLinkText(roomId, inviteToken, group.groupId) }));
    }
    const linksEl = el("group-invite-links");
    if (linksEl) {
      linksEl.hidden = false;
      linksEl.textContent = lines.join("\n");
    }
    el("group-name").value = "";
    setGroupStatus(t("groups.created", { name }));
    await renderGroupsCard();
  });

  // Section GC3: separate delegate for "open group conversation", checked
  // first -- a row can have BOTH an open button and an add-member button.
  el("groups-list")?.addEventListener("click", async (event) => {
    const openButton = event.target.closest("[data-open-group-btn]");
    if (!openButton) return;
    await openGroupConversation(openButton.dataset.openGroupBtn, openButton.dataset.openGroupName);
  });

  el("groups-list")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-add-member-btn]");
    if (!button) return;
    const groupId = button.dataset.addMemberBtn;
    const select = doc.querySelector(`[data-add-member-select="${groupId}"]`);
    const fingerprint = select?.value;
    if (!fingerprint) return;
    const contact = await getContact(fingerprint);
    const memberLabel = contact?.nickname || formatSpiritId(fingerprint);
    const { roomId, inviteToken } = await startTaggedGroupInvite({ groupId });
    const linksEl = el("group-invite-links");
    if (linksEl) {
      linksEl.hidden = false;
      linksEl.textContent = t("groups.inviteLine", { name: memberLabel, link: buildInviteLinkText(roomId, inviteToken, groupId) });
    }
    setGroupStatus(t("groups.memberAdded", { name: memberLabel }));
    await renderGroupsCard();
  });

  const setImportStatus = (text) => {
    const status = el("import-status");
    if (status) status.textContent = text;
  };

  /**
   * Section I2 (specs/phase2b/import.md): renders the pending-import list on
   * the Contacts screen. A pending import with no matchedFingerprint shows a
   * <select> of every REAL Spirit contact (never a pre-filtered "likely
   * match" -- matching is manual-only by design, see docs/migration.md) plus
   * a Match button; once matched it shows the matched contact's identity
   * instead. An unmatched import persists indefinitely -- there is no
   * expiry/auto-delete path anywhere in this function.
   */
  async function renderImportedContactsScreen() {
    const list = el("import-pending-list");
    const empty = el("import-pending-empty");
    if (!list) return; // screen not present in this document (e.g. older test fixture)
    const [imports, contacts] = await Promise.all([listImportedContacts(), listContacts()]);
    list.innerHTML = "";
    if (empty) empty.hidden = imports.length > 0;
    for (const record of imports) {
      const row = doc.createElement("div");
      row.className = "list-row";
      row.dataset.importedId = record.id;

      const label = doc.createElement("span");
      label.textContent = `${record.displayName} (${record.sourceIdentifier})`;
      if (record.pendingMessages?.length) {
        label.textContent += ` ${t("import.pendingMessagesCount", { count: record.pendingMessages.length })}`;
      }
      row.appendChild(label);

      if (record.matchedFingerprint) {
        const matchedContact = contacts.find((c) => c.fingerprint === record.matchedFingerprint);
        const matchedLabel = matchedContact?.nickname
          ? `${matchedContact.nickname} (${formatSpiritId(record.matchedFingerprint)})`
          : formatSpiritId(record.matchedFingerprint);
        const matchedSpan = doc.createElement("span");
        matchedSpan.textContent = ` ${t("import.matchedWith", { contact: matchedLabel })}`;
        row.appendChild(matchedSpan);
      } else {
        const select = doc.createElement("select");
        const placeholderOption = doc.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = t("import.matchPlaceholder");
        select.appendChild(placeholderOption);
        for (const contact of contacts) {
          const option = doc.createElement("option");
          option.value = contact.fingerprint;
          option.textContent = contact.nickname
            ? `${contact.nickname} (${formatSpiritId(contact.fingerprint)})`
            : formatSpiritId(contact.fingerprint);
          select.appendChild(option);
        }
        row.appendChild(select);

        const matchButton = doc.createElement("button");
        matchButton.type = "button";
        matchButton.textContent = t("import.matchButton");
        matchButton.dataset.matchBtn = record.id;
        row.appendChild(matchButton);
      }

      const deleteButton = doc.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = t("import.delete");
      deleteButton.dataset.deleteBtn = record.id;
      row.appendChild(deleteButton);

      list.appendChild(row);
    }
  }

  /**
   * Section I3 (specs/phase2b/import.md): picks a display name for a
   * pending "imported history" record out of the parsed messages, since
   * parseChatExport's return shape ({ timestamp, sender, text }[]) carries
   * no separate chat/contact name. Heuristic (documented, not guaranteed
   * accurate): the first sender that does NOT match the currently active
   * profile's own nickname, so the label names "the other person" rather
   * than "me" when that's determinable; falls back to the very first
   * message's sender, then to a fixed placeholder for an empty batch.
   */
  function deriveImportedHistoryDisplayName(messages) {
    const ownName = (state.nickname || "").trim().toLowerCase();
    const other = messages.find((m) => (m.sender || "").trim().toLowerCase() !== ownName);
    return (other || messages[0])?.sender || t("import.historyFallbackName");
  }

  /**
   * Section I3: there is no cryptographic "sent by me via Spirit" vs
   * "received via Spirit" distinction for historical import -- the message
   * never went through this device's E2EE session. Best-effort heuristic:
   * if the message's `sender` string matches the active profile's own
   * nickname (case-insensitive, trimmed), treat it as "out"; otherwise (and
   * whenever the own nickname isn't confidently known) default to "in".
   * This is explicitly a heuristic, not a reliable authorship signal.
   */
  function inferImportedDirection(sender) {
    const ownName = (state.nickname || "").trim().toLowerCase();
    if (ownName && (sender || "").trim().toLowerCase() === ownName) return "out";
    return "in";
  }

  const importFileInput = el("import-file-input");
  if (importFileInput) {
    importFileInput.addEventListener("change", async () => {
      const file = importFileInput.files && importFileInput.files[0];
      importFileInput.value = "";
      if (!file) return;
      const format = el("import-format")?.value || "vcard";
      try {
        const text = await file.text();
        if (format === "whatsapp-txt") {
          // History-only format (Section I3): WhatsApp .txt exports carry
          // no structured contact list (see importParsers.js), so
          // parseContactList is never attempted for this format -- only
          // parseChatExport, with the parsed messages queued as a single
          // pending "imported history" record awaiting manual match.
          const messages = parseChatExport(text, format);
          if (messages.length > 0) {
            await saveImportedContact({
              displayName: deriveImportedHistoryDisplayName(messages),
              sourceIdentifier: t("import.historySourceIdentifier"),
              source: format,
              pendingMessages: messages
            });
          }
        } else {
          const parsed = parseContactList(text, format);
          for (const entry of parsed) {
            await saveImportedContact({
              displayName: entry.displayName,
              sourceIdentifier: entry.sourceIdentifier,
              source: format
            });
          }
          // The same Telegram-JSON export file commonly carries chat
          // history alongside (or instead of) a contact list
          // (docs/migration.md). Attempt parseChatExport on the SAME text
          // too; a contacts-only export has no top-level `messages` array
          // and parseChatExport throws -- that failure is EXPECTED and
          // silently ignored here, it must not invalidate the successful
          // contact import above.
          if (format === "telegram-json") {
            try {
              const messages = parseChatExport(text, "telegram-json");
              if (messages.length > 0) {
                await saveImportedContact({
                  displayName: deriveImportedHistoryDisplayName(messages),
                  sourceIdentifier: t("import.historySourceIdentifier"),
                  source: "telegram-json-history",
                  pendingMessages: messages
                });
              }
            } catch {
              // Contacts-only Telegram export -- no messages array. Expected.
            }
          }
        }
        setImportStatus("");
      } catch (e) {
        setImportStatus(t("import.parseError", { detail: e.message }));
      }
      await renderImportedContactsScreen();
    });
  }

  // Single delegated listener on the pending-import list container (rows
  // are rebuilt on every renderImportedContactsScreen() call), same pattern
  // as #contacts-list's message-button delegate above.
  el("import-pending-list")?.addEventListener("click", async (event) => {
    const matchButton = event.target.closest("[data-match-btn]");
    if (matchButton) {
      const row = matchButton.closest("[data-imported-id]");
      const select = row?.querySelector("select");
      const fingerprint = select?.value;
      if (!fingerprint) return;
      const importedId = matchButton.dataset.matchBtn;
      await setMatchedFingerprint(importedId, fingerprint);
      // Section I3: this is the ONLY place parsed history messages get
      // written into historyStore.js -- exclusively right after a manual
      // match, never speculatively before one (docs/migration.md's
      // manual-match invariant applies to imported history too).
      const record = await getImportedContact(importedId);
      if (record?.pendingMessages?.length) {
        if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
          for (const msg of record.pendingMessages) {
            await appendMessage(state.identityKeyPair.vaultKey, state.senderKey, fingerprint, {
              direction: inferImportedDirection(msg.sender),
              text: msg.text,
              timestamp: msg.timestamp,
              imported: true
            });
          }
          await clearPendingMessages(importedId);
        } else {
          // No persistent history without a vault key (ephemeral mode --
          // historyStore.js is never written to there, docs/e2ee.md). Left
          // unhandled, pendingMessages would be silently stranded once the
          // record shows as matched (the Match UI disappears). Surface it
          // instead of losing the imported history with no feedback.
          setImportStatus(t("import.ephemeralHistorySkipped"));
        }
      }
      await renderImportedContactsScreen();
      return;
    }
    const deleteButton = event.target.closest("[data-delete-btn]");
    if (deleteButton) {
      await deleteImportedContact(deleteButton.dataset.deleteBtn);
      await renderImportedContactsScreen();
    }
  });

  /**
   * Re-checks every contact's held proofs against their live publication --
   * called on demand ("Перевірити зараз") and on the periodic timer below.
   * A single fetch/verify failure doesn't flip the badge to "failed"
   * immediately (transient network hiccups are common); only
   * PROOF_FAILURE_THRESHOLD consecutive failures do (docs/identity-verification.md).
   */
  async function checkContactProofs() {
    const contacts = await listContacts();
    for (const contact of contacts) {
      for (const proof of contact.proofSet?.proofs ?? []) {
        const key = proofVerificationKey(contact.fingerprint, proof.url);
        const prev = proofVerification.get(key);
        try {
          const text = await fetchProofPageText(el("server-url").value, state.senderKey, proof.url);
          const parsed = parseProofBlock(text);
          const ok = await verifyProofBlock(parsed, contact.identityPubkeyWire);
          if (ok) {
            proofVerification.set(key, { verifiedAt: Date.now(), failedAt: null, consecutiveFailures: 0 });
          } else {
            proofVerification.set(key, {
              verifiedAt: null,
              failedAt: Date.now(),
              consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1
            });
          }
        } catch {
          proofVerification.set(key, {
            verifiedAt: null,
            failedAt: Date.now(),
            consecutiveFailures: (prev?.consecutiveFailures ?? 0) + 1
          });
        }
      }
    }
    const route = win.location.hash.replace(/^#\/?/, "");
    // Section SD1 (specs/ui/persistent-sidebar.md): the sidebar's contact
    // list is always visible now regardless of the active route, so it must
    // re-render unconditionally -- only the manage-screen's groups/import
    // cards stay gated to the "manage" route.
    await renderContactsScreen();
    if (route === "manage") {
      await renderGroupsCard();
      await renderImportedContactsScreen();
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

  // Section SD1 (specs/ui/persistent-sidebar.md): populate the persistent
  // sidebar's contact list immediately at startup, before any navigation or
  // hashchange fires, so it isn't empty on first paint.
  renderContactsScreen();

  // Mobile responsive stacking (SD1): initRouter() above already resolved
  // and rendered a real screen synchronously (e.g. "account" for a
  // brand-new visitor) WITHOUT firing a hashchange event -- if main-active
  // were only ever set from onScreenChange's hashchange listener, a mobile
  // first-time visitor would see an empty sidebar with the account-creation
  // screen invisible behind it until their first navigation. Mirror
  // onScreenChange's toggle here once at startup so the just-rendered
  // screen is actually visible on mobile from the first paint.
  doc.body.classList.add("main-active");
  // Section RF4: the invite/call/camera/mic toolbar and the floating video
  // window both live OUTSIDE the router's [data-screen] mechanism (fixed
  // chrome, not a screen), so they need their own route-based show/hide --
  // a `function` declaration (hoisted) so it can be called here, before its
  // own definition further down, exactly like main-active's manual mirror
  // above needs to run before onScreenChange's hashchange listener exists.
  // .conversation-toolbar sits right under the global header, but as fixed
  // chrome outside normal flow it can't just rely on being next in the DOM
  // -- its `top` has to match the header's real rendered height (which
  // varies with locale/font/zoom), recomputed on resize too. Its OWN
  // rendered height (which varies with content -- the ephemeral "Ви
  // зараз" banner, connection-status text length, etc.) is published as a
  // CSS variable so .app-body's push-down margin can match it exactly
  // instead of a guessed fixed pixel value (exec-review-caught bug: a
  // hardcoded 40px left a visible gap/overlap once the toolbar grew
  // taller than that guess).
  function positionConversationToolbar() {
    const header = doc.querySelector(".app-header");
    const toolbar = el("conversation-toolbar");
    if (header && toolbar) toolbar.style.top = `${header.getBoundingClientRect().height}px`;
    if (toolbar) {
      doc.documentElement.style.setProperty("--conversation-toolbar-height", `${toolbar.offsetHeight}px`);
    }
  }
  function setConversationChromeVisible(visible) {
    const toolbar = el("conversation-toolbar");
    if (toolbar) toolbar.hidden = !visible;
    const floatingVideo = el("floating-video");
    if (floatingVideo) floatingVideo.hidden = !visible;
    // Section RF6: call/camera/mic icons moved into the global header
    // itself (still gated on the same route check as the toolbar above).
    const headerCallControls = el("header-call-controls");
    if (headerCallControls) headerCallControls.hidden = !visible;
    doc.body.classList.toggle("conversation-toolbar-visible", visible);
    // Re-measure now that .hidden just changed -- a hidden element reports
    // offsetHeight 0, so this only produces a meaningful value once shown.
    positionConversationToolbar();
  }
  // Mirrors main-active above: a direct #/conversation load (or the
  // zero-click quick-chat flow, which navigates before any hashchange
  // listener is attached) must not leave this chrome stuck hidden.
  setConversationChromeVisible(doc.defaultView.location.hash.replace(/^#\/?/, "") === "conversation");
  doc.defaultView.addEventListener("resize", positionConversationToolbar);
  // The toolbar's content can change height on its own (the ephemeral "Ви
  // зараз" banner appearing, a longer connection-status message wrapping
  // to a second line, ...) without any of the above call sites firing --
  // ResizeObserver catches every case uniformly. Guarded for jsdom, same
  // as the floating-video panel's observer below.
  if (doc.defaultView.ResizeObserver && el("conversation-toolbar")) {
    new doc.defaultView.ResizeObserver(positionConversationToolbar).observe(el("conversation-toolbar"));
  }

  // Section RF4: floating video window -- draggable via its handle bar,
  // resizable via the native CSS `resize` on .floating-video itself (no
  // custom resize logic needed), both persisted the same way as
  // spirit.folders/spirit.theme (device-level localStorage, not account
  // data). ResizeObserver/PointerEvent are guarded since jsdom's test
  // environment doesn't implement either.
  const FLOATING_VIDEO_STORAGE_KEY = "spirit.floatingVideoRect";
  function loadFloatingVideoRect() {
    try {
      const raw = localStorage.getItem(FLOATING_VIDEO_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function saveFloatingVideoRect(rect) {
    try {
      localStorage.setItem(FLOATING_VIDEO_STORAGE_KEY, JSON.stringify(rect));
    } catch {
      // Best-effort only -- a full/unavailable localStorage just means the
      // window resets to its default corner next load, not a functional break.
    }
  }
  {
    const panel = el("floating-video");
    const handle = el("floating-video-handle");
    if (panel) {
      const win = doc.defaultView;
      const saved = loadFloatingVideoRect();
      const defaultWidth = 320;
      const defaultHeight = 240;
      const rect = saved || {
        left: Math.max(16, win.innerWidth - defaultWidth - 16),
        top: Math.max(16, win.innerHeight - defaultHeight - 16),
        width: defaultWidth,
        height: defaultHeight
      };
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.width = `${rect.width}px`;
      panel.style.height = `${rect.height}px`;

      const persistCurrentRect = () =>
        saveFloatingVideoRect({
          left: parseFloat(panel.style.left) || panel.offsetLeft,
          top: parseFloat(panel.style.top) || panel.offsetTop,
          width: panel.offsetWidth,
          height: panel.offsetHeight
        });

      if (handle) {
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let dragging = false;
        handle.addEventListener("pointerdown", (event) => {
          dragging = true;
          const panelRect = panel.getBoundingClientRect();
          dragOffsetX = event.clientX - panelRect.left;
          dragOffsetY = event.clientY - panelRect.top;
          handle.setPointerCapture?.(event.pointerId);
        });
        handle.addEventListener("pointermove", (event) => {
          if (!dragging) return;
          panel.style.left = `${event.clientX - dragOffsetX}px`;
          panel.style.top = `${event.clientY - dragOffsetY}px`;
        });
        const endDrag = () => {
          if (!dragging) return;
          dragging = false;
          persistCurrentRect();
        };
        handle.addEventListener("pointerup", endDrag);
        handle.addEventListener("pointercancel", endDrag);
      }

      // The native `resize: both` handle changes the panel's box size
      // without firing any dedicated JS event -- ResizeObserver is the
      // standard way to notice that and persist it.
      if (win.ResizeObserver) {
        let firstCallback = true;
        const observer = new win.ResizeObserver(() => {
          // The observer's own initial callback fires once on `observe()`
          // with the size we JUST set above -- skip it, nothing changed yet.
          if (firstCallback) {
            firstCallback = false;
            return;
          }
          persistCurrentRect();
        });
        observer.observe(panel);
      }
    }
  }

  // Section H2 (specs/ui/chat-first-redesign.md): the old always-visible top
  // nav collapsed into a "⚙️ Налаштування" dropdown, in the same spirit as
  // Telegram's settings menu -- opens on toggle click, closes on selecting an
  // item, closes on an outside click, toggles closed on a second press of
  // the button itself.
  // Section SD1 (specs/ui/persistent-sidebar.md): mobile responsive
  // stacking's reverse toggle -- clicking "back" hides main content and
  // shows the sidebar again, a plain CSS class removal (see onScreenChange
  // above for where the class gets added).
  el("btn-sidebar-back")?.addEventListener("click", () => {
    doc.body.classList.remove("main-active");
  });

  const settingsToggle = el("btn-settings-toggle");
  const settingsMenu = el("settings-menu");
  if (settingsToggle && settingsMenu) {
    const closeSettingsMenu = () => {
      settingsMenu.hidden = true;
      settingsToggle.setAttribute("aria-expanded", "false");
    };
    const openSettingsMenu = () => {
      settingsMenu.hidden = false;
      settingsToggle.setAttribute("aria-expanded", "true");
    };
    settingsToggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (settingsMenu.hidden) openSettingsMenu();
      else closeSettingsMenu();
    });
    settingsMenu.addEventListener("click", (event) => {
      // Let the nav-item's own navigation/logout handler run first, then
      // close -- this listener only needs to react to "some item was picked."
      if (event.target.closest(".nav-item")) closeSettingsMenu();
    });
    doc.addEventListener("click", (event) => {
      if (!settingsMenu.hidden && !settingsMenu.contains(event.target) && event.target !== settingsToggle) {
        closeSettingsMenu();
      }
    });
  }

  // Section H3: quick "Створити"/"Увійти" header actions for guests -- reuse
  // the account screen's existing create/login toggle rather than duplicate
  // it. The account screen itself renders as a modal over the chat (Section
  // H4, client/css/style.css .modal-screen), not a full page navigation.
  el("btn-quick-create")?.addEventListener("click", () => {
    router.navigate("account");
    el("link-switch-to-create")?.click();
  });
  el("btn-quick-login")?.addEventListener("click", () => {
    router.navigate("account");
    el("link-switch-to-login")?.click();
  });
  // Section H4: dismiss the account modal back to the chat. Safe to call
  // unconditionally -- if there's no identity yet, the router's own gating
  // redirects "conversation" straight back to "account" anyway.
  el("btn-account-close")?.addEventListener("click", () => {
    router.navigate("conversation");
  });

  el("btn-logout")?.addEventListener("click", () => {
    if (state.localMediaPreviewTimeoutId) {
      clearTimeout(state.localMediaPreviewTimeoutId);
      state.localMediaPreviewTimeoutId = null;
    }
    if (state.channel) state.channel.close?.();
    if (state.pc) state.pc.close?.();
    if (state.localStream) {
      for (const track of state.localStream.getTracks()) track.stop();
    }
    forgetSession();
    state.identityKeyPair = null;
    state.senderKey = null;
    state.nickname = null;
    state.localStream = null;
    updateCallButtonStates();
    el("video-remote").hidden = true;
    el("video-remote").srcObject = null;
    hideSafetyNumberHint();
    // Section GC0: deletes the active state.peers entry outright (pc,
    // channel, sessionKey, sessionEcdhWires, sendChainKey, receiveChainKey,
    // peerFingerprint, peerIdentityPublicKey, isInviteOwner all go with it)
    // instead of nulling each field individually -- avoids leaving a stale
    // all-null entry behind in the Map (exec review requirement for this
    // section).
    resetActiveConnection();
    // exec review finding: without this, a fresh post-logout session could
    // inherit stale flags from the ended one -- e.g. acquireLocalStream()'s
    // one-time addLocalMediaTracks guard staying "already added" and silently
    // skipping media on the NEW peer connection.
    state.localTracksAddedToPeer = false;
    setDynamicText(el("pub-key-display"), "");
    renderGuestQuickActions();
    renderNotificationsCard();
    renderRecoveryCard();
    router.navigate("account");
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

  // Section: multi-node signaling/TURN UI (specs/phase4/multi-node-ui.md).
  // localStorage, not the "profile" IndexedDB store -- this is a
  // browser/device-level setting (which signaling node this machine talks
  // to), independent of which Spirit account is currently active, same
  // storage tier as spirit.theme/spirit.locale. Guarded try/catch on every
  // access matches the pattern already used for spirit.welcomeSeen above:
  // storage can throw (private-mode/blocked site data) or hold malformed
  // JSON (e.g. hand-edited or corrupted by another script) -- either case
  // must fail open to an empty list, never take down the whole Server
  // screen's init.
  const SIGNALING_NODES_KEY = "spirit.signalingNodes";

  function loadSignalingNodes() {
    try {
      const raw = doc.defaultView.localStorage.getItem(SIGNALING_NODES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveSignalingNodes(nodes) {
    try {
      doc.defaultView.localStorage.setItem(SIGNALING_NODES_KEY, JSON.stringify(nodes));
    } catch {
      // Storage unavailable -- the in-memory list still rendered for this
      // page view, but it won't persist across reloads. Acceptable
      // degraded UX, matches spirit.welcomeSeen's fail-open policy.
    }
  }

  function randomSignalingNodeId() {
    return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function renderSignalingNodesList() {
    const list = el("signaling-nodes-list");
    const empty = el("signaling-nodes-empty");
    if (!list) return;
    const nodes = loadSignalingNodes();
    list.innerHTML = "";
    if (empty) empty.hidden = nodes.length > 0;
    for (const node of nodes) {
      const row = doc.createElement("div");
      row.className = "list-row";

      const selectButton = doc.createElement("button");
      selectButton.type = "button";
      selectButton.dataset.signalingNodeSelect = node.id;
      // Defensive against a hand-edited/foreign localStorage array element
      // missing expected string fields (loadSignalingNodes only validates
      // that the top level is an array, not each element's shape) -- falls
      // back to "" rather than throwing and breaking the whole Server
      // screen, matching the fail-open intent of the storage guards above.
      const url = typeof node.serverUrl === "string" ? node.serverUrl : "";
      const shortUrl = url.length > 40 ? `${url.slice(0, 37)}...` : url;
      selectButton.textContent = `${node.name ?? ""} (${shortUrl})`;
      row.appendChild(selectButton);

      const deleteButton = doc.createElement("button");
      deleteButton.type = "button";
      deleteButton.dataset.signalingNodeDelete = node.id;
      deleteButton.textContent = t("btn.deleteSignalingNode");
      row.appendChild(deleteButton);

      list.appendChild(row);
    }
  }
  renderSignalingNodesList();

  if (el("btn-save-signaling-node")) el("btn-save-signaling-node").addEventListener("click", () => {
    const name = el("signaling-node-name").value.trim();
    if (!name) return;
    const nodes = loadSignalingNodes();
    nodes.push({
      id: randomSignalingNodeId(),
      name,
      serverUrl: el("server-url").value,
      stunUrl: el("stun-url").value,
      forceTurnRelay: el("force-turn-relay").checked
    });
    saveSignalingNodes(nodes);
    el("signaling-node-name").value = "";
    renderSignalingNodesList();
  });

  el("signaling-nodes-list")?.addEventListener("click", (event) => {
    const selectButton = event.target.closest("[data-signaling-node-select]");
    if (selectButton) {
      const node = loadSignalingNodes().find((n) => n.id === selectButton.dataset.signalingNodeSelect);
      if (node) {
        // Purely fills the fields -- matches the existing manual-apply
        // philosophy of server-url/stun-url/force-turn-relay (spec design
        // note): no auto-reconnect of any in-progress session.
        el("server-url").value = node.serverUrl;
        el("stun-url").value = node.stunUrl;
        el("force-turn-relay").checked = !!node.forceTurnRelay;
      }
      return;
    }
    const deleteButton = event.target.closest("[data-signaling-node-delete]");
    if (deleteButton) {
      const nodes = loadSignalingNodes().filter((n) => n.id !== deleteButton.dataset.signalingNodeDelete);
      saveSignalingNodes(nodes);
      renderSignalingNodesList();
    }
  });

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
    // Sidebar's contact list is always in the DOM now (SD1) -- keep it live
    // on every route change, not just when the "manage" screen is active.
    renderContactsScreen();
    // Mobile responsive stacking (SD1): any navigation away from the
    // neutral/no-route state means the user is looking at a screen, so
    // flip to showing main content full-width (a plain CSS class toggle,
    // not a router route -- see #btn-sidebar-back below for the reverse).
    doc.body.classList.add("main-active");
    if (route === "manage") {
      renderGroupsCard();
      renderImportedContactsScreen();
    }
    if (route === "history") renderHistoryScreen();
    if (route === "profile") renderOwnProofsList();
    if (route === "conversation") renderEphemeralBanner();
    // Group AND 1:1 chat both route to "conversation" (Section GC3), so
    // this single check covers both.
    setConversationChromeVisible(route === "conversation");
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
    "proof-set-announce",
    "push-subscription-announce",
    "recovery-share-announce",
    "webrtc-call-offer",
    "webrtc-call-answer",
    "file-offer",
    "file-accept",
    "file-reject",
    "file-chunk",
    "group-member-joined",
    "group-message",
    "safety-display-mode"
  ]);

  // Section FT2 (specs/phase4/file-transfer.md), architectural decisions:
  // 16KB raw-byte chunks (base64'd into JSON control messages, consistent
  // with the existing "everything is JSON text" control pattern); a 1MB
  // bufferedAmount backpressure threshold, to avoid overflowing the WebRTC
  // SCTP send buffer on large files; and a 100MB soft UI warning (no hard
  // limit -- the whole file is held in RAM for the duration of a transfer,
  // by deliberate zero-database design).
  const FILE_CHUNK_SIZE = 16 * 1024;
  const BUFFERED_AMOUNT_HIGH_THRESHOLD = 1024 * 1024;
  const FILE_SIZE_WARNING_BYTES = 100 * 1024 * 1024;

  function randomFileId() {
    return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Renders/updates a one-line status row for a given transfer inside the
  // file-transfers list, creating it on first use. Returns the row element
  // so callers (e.g. the download-ready path) can append richer content
  // (a download link) beyond plain text.
  function renderFileTransferStatus(fileId, text) {
    const container = el("file-transfers");
    if (!container) return null;
    let row = doc.getElementById(`file-transfer-${fileId}`);
    if (!row) {
      row = doc.createElement("div");
      row.id = `file-transfer-${fileId}`;
      row.className = "file-transfer-row";
      container.appendChild(row);
    }
    row.textContent = text;
    return row;
  }

  function renderFileOfferBanner(offer) {
    const banner = el("file-offer-banner");
    if (!banner) return;
    setDynamicText(el("file-offer-text"), t("fileTransfer.offer", { name: offer.name, size: formatFileSize(offer.size) }));
    banner.hidden = false;
    banner.dataset.fileId = offer.fileId;
  }

  // Called once the last chunk of an accepted transfer has been verified
  // against its announced SHA-256 -- exposes the reassembled bytes as a
  // downloadable link. NEVER called on a hash mismatch (see the file-chunk
  // branch in handleChatMessage): a corrupted/incomplete file must never
  // reach this function, so there is no code path here that could offer an
  // unverified Blob as if it were a completed, trustworthy download.
  function renderFileTransferDownload(fileId, name, mimeType, buffer) {
    const row = renderFileTransferStatus(fileId, t("fileTransfer.complete", { name }));
    if (!row) return;
    const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement("a");
    link.href = url;
    link.download = name;
    link.textContent = t("fileTransfer.downloadLink");
    row.appendChild(link);
  }

  // Backpressure (spec Section, "Архітектурні рішення" #3): before sending
  // each chunk, checked against channel.bufferedAmount; if over threshold,
  // waits for the channel's bufferedamountlow event rather than firing all
  // chunks synchronously, which could overflow the WebRTC send buffer and
  // tear down the connection on large files.
  function waitForBufferedAmountLow(channel) {
    return new Promise((resolve) => {
      channel.onbufferedamountlow = () => {
        channel.onbufferedamountlow = null;
        resolve();
      };
    });
  }

  // Streams the chunks of an already-accepted outgoing transfer. Only ever
  // invoked from the "file-accept" branch of handleChatMessage below -- NOT
  // from the file-picker handler -- so no chunk is ever sent before the
  // peer has explicitly accepted the offer.
  async function sendFileChunks(fileId) {
    const transfer = state.outgoingFileTransfers[fileId];
    if (!transfer || !state.channel || !state.sessionKey) return;
    const channel = state.channel;
    channel.bufferedAmountLowThreshold = BUFFERED_AMOUNT_HIGH_THRESHOLD;
    for (let index = transfer.sentCount; index < transfer.chunks.length; index++) {
      // The transfer can vanish mid-flight (peer session reset) -- stop
      // rather than keep pushing chunks nobody will ever assemble.
      if (!state.outgoingFileTransfers[fileId] || state.channel !== channel) return;
      if (channel.bufferedAmount > BUFFERED_AMOUNT_HIGH_THRESHOLD) {
        await waitForBufferedAmountLow(channel);
      }
      const data = chunkToBase64(transfer.chunks[index]);
      channel.send(await encryptMessage(state.sessionKey, JSON.stringify({ type: "file-chunk", fileId, index, data })));
      transfer.sentCount = index + 1;
      renderFileTransferStatus(
        fileId,
        t("fileTransfer.progressSending", { name: transfer.name, sent: transfer.sentCount, total: transfer.chunks.length })
      );
    }
    delete state.outgoingFileTransfers[fileId];
  }

  const setVideoStatus = (text) => {
    el("video-status").textContent = text;
  };

  // Section S2 (specs/phase5/social-recovery.md), KEY DESIGN DECISION:
  // "announce a recovery share to N specific trusted contacts" has no close
  // precedent in this codebase -- every existing *-announce (device-list,
  // proof-set, push-subscription) only ever reaches whoever you happen to be
  // chatting with RIGHT NOW (makeIdentityAnnouncer below), because there is
  // no persistent broadcast (zero-database invariant). Recovery setup picks
  // N contacts who are very likely NOT all connected at setup time.
  //
  // Simplest correct design chosen here: send immediately to any selected
  // contact who IS the live peer at setup time; for the rest, persist a
  // durable "outbound pending announce" queue (one entry per contact,
  // keyed by this profile's own senderKey so multiple local profiles don't
  // collide) and drain it opportunistically -- the same moment ANY peer's
  // identity-announce is verified (handleChatMessage's "identity-announce"
  // branch), check whether that peer is owed a queued share and send it
  // then. This mirrors how the other announces piggyback on connection,
  // just keyed per-recipient instead of "send to whoever is there".
  // Tradeoff: a selected contact who never reconnects while queued never
  // receives their share -- acceptable for a first cut (documented in the
  // spec) since re-running setup re-splits and re-queues anyway.
  function recoveryShareOutboxKey(senderKey) {
    return `recoveryShareOutbox:${senderKey}`;
  }

  async function queueRecoveryShareForContact(contactFingerprint, share) {
    const key = recoveryShareOutboxKey(state.senderKey);
    const existing = (await get("profile", key)) || [];
    const filtered = existing.filter((entry) => entry.contactFingerprint !== contactFingerprint);
    filtered.push({ contactFingerprint, announce: buildRecoveryShareAnnounce(share) });
    await put("profile", key, filtered);
  }

  /**
   * Removes any queued-but-not-yet-sent outbox entry for `contactFingerprint`,
   * without sending it. Exec review iter1 finding: the immediate-send branch
   * of btn-setup-recovery must call this for whichever contact it just sent
   * to directly -- otherwise a STALE entry from an earlier setup run (e.g.
   * that contact was offline last time, got queued, and is the live peer
   * this time) survives in the outbox and is delivered on their NEXT
   * reconnect, silently overwriting the fresh share just sent with a share
   * from an incompatible, superseded split (trustedShares.js's overwrite-on-
   * save then keeps the stale one, since it arrives later).
   */
  async function dequeueRecoveryShareForContact(contactFingerprint) {
    const key = recoveryShareOutboxKey(state.senderKey);
    const existing = (await get("profile", key)) || [];
    const filtered = existing.filter((entry) => entry.contactFingerprint !== contactFingerprint);
    if (filtered.length !== existing.length) {
      await put("profile", key, filtered);
    }
  }

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

  async function drainRecoveryShareOutboxForPeer(peerFingerprint) {
    if (!state.identityKeyPair || !state.identityKeyPair.vaultKey || !state.channel || !state.sessionKey) return;
    const key = recoveryShareOutboxKey(state.senderKey);
    const existing = (await get("profile", key)) || [];
    const index = existing.findIndex((entry) => entry.contactFingerprint === peerFingerprint);
    if (index === -1) return;
    const { announce } = existing[index];
    state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify(announce)));
    const remaining = existing.filter((_, i) => i !== index);
    await put("profile", key, remaining);
  }

  // Reflects real on/off state on the icon call-controls (.active, styled in
  // style.css) rather than leaving them looking identical whether camera/mic
  // are live or not -- a plain :hover/:focus ring isn't enough to tell.
  // btn-start-call is "active" once there's a local stream at all (a call is
  // underway or at least being previewed); camera/mic reflect their own
  // track.enabled.
  function updateCallButtonStates() {
    const hasStream = !!state.localStream;
    el("btn-start-call")?.classList.toggle("active", hasStream);
    const tracks = hasStream ? state.localStream.getTracks() : [];
    const videoEnabled = tracks.some((track) => track.kind === "video" && track.enabled);
    const audioEnabled = tracks.some((track) => track.kind === "audio" && track.enabled);
    el("btn-toggle-camera")?.classList.toggle("active", videoEnabled);
    el("btn-toggle-mic")?.classList.toggle("active", audioEnabled);
  }

  // Section F6 (instant conversation lobby, 2026-07-17): local camera/mic
  // preview only -- no peer connection involved, so this is safe to call the
  // moment the conversation screen opens, before any peer has joined. Errors
  // (permission denied, no camera) are reported via video-status but never
  // block the chat itself.
  async function previewLocalMedia() {
    if (state.localStream) return state.localStream;
    if (state.localMediaPreviewPromise) return state.localMediaPreviewPromise;
    state.localMediaPreviewPromise = (async () => {
      try {
        const stream = await doc.defaultView.navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        state.localStream = stream;
        el("video-local").srcObject = stream;
        el("btn-toggle-camera").disabled = false;
        el("btn-toggle-mic").disabled = false;
        updateCallButtonStates();
        return stream;
      } catch (err) {
        setVideoStatus(t("status.error", { msg: err.message }));
        return null;
      } finally {
        state.localMediaPreviewPromise = null;
      }
    })();
    return state.localMediaPreviewPromise;
  }

  // Auto-accept (Section V2, specs/ui/video-call.md): actually PUSHING our
  // camera+mic to the peer, once a chat channel exists to renegotiate over.
  // Reuses whatever previewLocalMedia() already acquired rather than
  // prompting getUserMedia a second time, and only ever adds tracks to the
  // peer connection once (a second btn-start-call click must not duplicate
  // tracks on the same pc).
  async function acquireLocalStream() {
    const stream = await previewLocalMedia();
    if (stream && !state.localTracksAddedToPeer) {
      addLocalMediaTracks(state.pc, stream);
      state.localTracksAddedToPeer = true;
    }
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
      // Section P4 (security-hardening.md): a peer verified for the first
      // time -- either a brand-new profile-mode contact, or ANY peer in
      // ephemeral mode (nothing persists there, so every meeting is
      // effectively first) -- gets a persistent on-screen hint to verify
      // the fingerprint out-of-band (safety number). A KNOWN contact
      // doesn't: TOFU continuity is already the trust signal there.
      let isFirstMeeting = true;
      // Persist the contact only in permanent-profile mode (the vault key's
      // presence is what distinguishes it) -- ephemeral sessions store nothing.
      if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
        const { status } = await rememberContact({
          fingerprint: verified.fingerprint,
          identityPubkeyWire: verified.identityPubkeyWire,
          nickname: verified.nickname || null
        });
        continuity = status === "known" ? t("status.knownContact") : t("status.newContact");
        isFirstMeeting = status !== "known";
      }
      state.safetyHintVisible = isFirstMeeting;
      state.sharedSafetyNumber = isFirstMeeting
        ? await computeSharedSafetyNumber(state.senderKey, verified.fingerprint)
        : null;
      renderSafetyHint();
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
          appendChat(entry.text, entry.direction, entry.timestamp, entry.imported === true);
        }
      }
      // Section GC2 (specs/phase4/group-chats.md): if the connection that
      // just verified this peer's identity was tagged with a groupId (a
      // group-invite session, see startTaggedGroupInvite below), record the
      // new member in that group's local roster and best-effort notify any
      // OTHER currently-connected members of the same group. Gated on
      // permanent-profile mode, same as rememberContact just above -- there
      // is no group storage to update in ephemeral mode.
      if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
        const joinedGroupId = getActivePeer()?.groupId;
        if (joinedGroupId) {
          const group = await getGroup(joinedGroupId);
          if (group && !group.memberFingerprints.includes(verified.fingerprint)) {
            await updateGroupMembers(joinedGroupId, [...group.memberFingerprints, verified.fingerprint]);
          }
          await broadcastGroupMemberJoined(joinedGroupId, verified.fingerprint, verified.nickname || null);
        }
      }
      // Section S2: this peer may be owed a still-pending recovery-share
      // announce from an earlier setup where they weren't connected yet.
      await drainRecoveryShareOutboxForPeer(verified.fingerprint);
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

    if (control.type === "safety-display-mode") {
      // Section RF10: applies the PEER's chosen display mode to this side
      // too, so both ends look at the same kind of value at the same
      // time -- no identity gate needed, this is a display preference,
      // not a trust decision.
      state.safetyDisplayMode = control.mode === "shared" ? "shared" : "peer";
      renderSafetyHint();
      return;
    }

    if (control.type === "proof-set-announce") {
      // Same gate as device-list-announce: meaningless before identity is
      // verified, pointless in ephemeral mode (nothing persists).
      if (!state.peerFingerprint || !state.identityKeyPair || !state.identityKeyPair.vaultKey) return;
      const contact = await getContact(state.peerFingerprint);
      const heldSet = contact ? contact.proofSet : null;
      const accepted = await acceptNewerProofSet(state.peerIdentityPublicKey, heldSet, control.set);
      if (accepted !== heldSet) {
        await updateContactProofSet(state.peerFingerprint, accepted);
      }
      return;
    }

    if (control.type === "push-subscription-announce") {
      // Same gate as device-list-announce/proof-set-announce: meaningless
      // before identity is verified, pointless in ephemeral mode (nothing
      // persists, and ephemeral "spirits" have nowhere to store a subscription).
      if (!state.peerFingerprint || !state.identityKeyPair || !state.identityKeyPair.vaultKey) return;
      const parsed = parsePushSubscriptionAnnounce(control);
      if (!parsed) return;
      await updateContactPushSubscription(state.peerFingerprint, parsed);
      return;
    }

    if (control.type === "recovery-share-announce") {
      // Section S2 (specs/phase5/social-recovery.md): same trust gate as
      // device-list-announce/push-subscription-announce -- meaningless
      // before the peer's identity is verified (nothing to attribute the
      // share to), and pointless in ephemeral mode (nothing persists).
      if (!state.peerFingerprint || !state.identityKeyPair || !state.identityKeyPair.vaultKey) return;
      const parsed = parseRecoveryShareAnnounce(control);
      if (!parsed) return;
      await saveTrustedShare({ ownerFingerprint: state.peerFingerprint, ...parsed, receivedAt: Date.now() });
      return;
    }

    if (control.type === "group-member-joined") {
      // Section GC2 trust gate -- same shape as every other *-announce:
      // meaningless before THIS connection's own peer identity is verified,
      // pointless in ephemeral mode (nothing persists). On top of that,
      // this control message makes a claim about a THIRD party (not the
      // sender itself), so two more checks are required before trusting it:
      // (1) the connection it arrived on must actually be tagged with the
      // groupId being claimed -- a peer cannot inject membership for a
      // group it was never invited into via a mismatched/forged groupId;
      // (2) the group must already exist locally -- learning about a group
      // this device isn't tracking is silently ignored, since there is
      // nothing sensible to attach an unknown member to.
      if (!state.peerFingerprint || !state.identityKeyPair || !state.identityKeyPair.vaultKey) return;
      if (typeof control.groupId !== "string" || typeof control.memberFingerprint !== "string") return;
      const activePeerEntry = getActivePeer();
      if (!activePeerEntry || activePeerEntry.groupId !== control.groupId) return;
      const group = await getGroup(control.groupId);
      if (!group) return;
      if (!group.memberFingerprints.includes(control.memberFingerprint)) {
        await updateGroupMembers(control.groupId, [...group.memberFingerprints, control.memberFingerprint]);
      }
      return;
    }

    if (control.type === "group-message") {
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
      // via the profile-mode UI paths), same existence check as
      // group-member-joined above -- a message for a group this device
      // isn't locally tracking is silently ignored rather than rendered/
      // persisted under an unknown groupId.
      if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
        const group = await getGroup(control.groupId);
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
      return;
    }

    // Section FT2 (specs/phase4/file-transfer.md): same trust gate as plain
    // chat text -- an unverified peer must not be able to push file offers
    // or consume this side's attention/bandwidth before proving identity.
    if (control.type === "file-offer") {
      if (!state.peerFingerprint) return;
      state.pendingFileOffers[control.fileId] = control;
      renderFileOfferBanner(control);
      return;
    }

    if (control.type === "file-accept") {
      if (!state.peerFingerprint) return;
      // Ignore accepts for a fileId this side never offered (or already
      // finished/rejected) -- defensive against stale/duplicate/spoofed
      // control messages, mirrors how the other branches above silently
      // drop unexpected input rather than throwing.
      if (!state.outgoingFileTransfers[control.fileId]) return;
      void sendFileChunks(control.fileId);
      return;
    }

    if (control.type === "file-reject") {
      if (!state.peerFingerprint) return;
      const transfer = state.outgoingFileTransfers[control.fileId];
      if (!transfer) return;
      delete state.outgoingFileTransfers[control.fileId];
      renderFileTransferStatus(control.fileId, t("fileTransfer.rejected", { name: transfer.name }));
      return;
    }

    if (control.type === "file-chunk") {
      if (!state.peerFingerprint) return;
      // Only accepted for a fileId THIS side genuinely has an active
      // assembler for -- a peer sending a file-chunk for a fileId that was
      // never offered/accepted (or reusing another transfer's fileId to
      // inject chunks into an in-progress assembly) is silently dropped.
      const transfer = state.incomingFileTransfers[control.fileId];
      if (!transfer) return;
      let bytes;
      try {
        bytes = base64ToChunk(control.data);
        transfer.assembler.addChunk(control.index, bytes);
      } catch {
        return; // malformed base64 or out-of-range index -- drop, not throw
      }
      const received = transfer.totalChunks - transfer.assembler.missingIndices().length;
      renderFileTransferStatus(
        control.fileId,
        t("fileTransfer.progressReceiving", { name: transfer.name, received, total: transfer.totalChunks })
      );
      if (transfer.assembler.isComplete()) {
        const buffer = transfer.assembler.assemble();
        const hash = await computeFileHash(buffer);
        if (hash === transfer.sha256) {
          renderFileTransferDownload(control.fileId, transfer.name, transfer.mimeType, buffer);
        } else {
          // Explicit failure per spec: a hash mismatch must NEVER offer a
          // download link for the corrupted/incomplete result.
          renderFileTransferStatus(control.fileId, t("fileTransfer.hashMismatch", { name: transfer.name }));
        }
        delete state.incomingFileTransfers[control.fileId];
      }
      return;
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
        const ownProofSet = await get("profile", ownProofSetKey(state.senderKey));
        if (ownProofSet) {
          state.channel.send(
            await encryptMessage(state.sessionKey, JSON.stringify({ type: "proof-set-announce", set: ownProofSet }))
          );
        }
        const ownPushSubscription = await get("profile", ownPushSubscriptionKey(state.senderKey));
        if (ownPushSubscription) {
          state.channel.send(
            await encryptMessage(
              state.sessionKey,
              JSON.stringify({ type: "push-subscription-announce", ...ownPushSubscription })
            )
          );
        }
      } catch (err) {
        setStatus(t("status.error", { msg: err.message })); // afterChannelOpen path is detached; nothing upstream catches
      }
    };
  }

  function wireChannelCallbacks(disarmIceTimeout, { onDecryptedMessage = handleChatMessage, afterChannelOpen } = {}) {
    // Section GC0 exec-review iter2 finding: snapshot which connection this
    // set of callbacks belongs to at wiring time. onChannelOpen can fire
    // asynchronously (ICE/DTLS completion) after logout has already torn
    // down the session -- without this guard, state.channel = channel would
    // resurrect a phantom state.peers entry the same way the ratchet
    // writeback could (see serializedChainStep above).
    const ownerConnectionIdAtWireTime = state.activeConnectionId;
    return {
      onChannelOpen: (channel) => {
        // Skip if the session this callback belongs to was already torn
        // down (logout) or superseded by a newer one before the channel
        // actually finished opening -- otherwise this write would resurrect
        // a phantom state.peers entry for a session that no longer exists.
        if (ownerConnectionIdAtWireTime !== null && state.activeConnectionId !== ownerConnectionIdAtWireTime) return;
        state.channel = channel;
        setStatus(t("status.connected"));
        for (const id of ["btn-start-call", "btn-toggle-camera", "btn-toggle-mic"]) {
          el(id).disabled = false;
        }
        // Section RF9: the session key may already have been derived before
        // the channel finished opening (or may not be -- see the other
        // flush call site after onSessionReady below); only actually sends
        // anything once BOTH are true.
        void flushPendingOutgoingMessages();
        if (afterChannelOpen) afterChannelOpen();
      },
      onMessage: (payload) => {
        // Section GC3 (specs/phase4/group-chats.md): once multiple
        // connections can be simultaneously open (group chats -- this
        // section is what first makes that real, GC0-GC2 kept at most one
        // live session at a time), a message arriving on a BACKGROUND
        // connection's channel must still decrypt/dispatch using THAT
        // connection's own sessionKey/chain keys/peerFingerprint, not
        // whichever connection happens to be "active" right now (the
        // PEER_PROXY_FIELDS/getActivePeer() machinery otherwise always
        // resolves against activeConnectionId). Temporarily point
        // activeConnectionId at this callback's OWN connection for the
        // duration of processing, restoring whatever it was before
        // afterward -- transparent to every existing 1:1 caller, where
        // there is only ever one connection and this is a same-value no-op.
        //
        // GC3 exec-review iter1 finding: mutating the shared
        // activeConnectionId across `await` points is only race-free if two
        // different connections' onMessage bodies never interleave -- two
        // messages arriving on DIFFERENT channels back-to-back could
        // otherwise both be "in flight" at once, with the second one's
        // activeConnectionId write landing while the first is still
        // mid-await, corrupting the first's dispatch (mis-routes it to the
        // second connection's peer entry). Fixed the same way the ratchet
        // chain steps already serialize concurrent callers (state.sendChainLock/
        // receiveChainLock, see serializedChainStep above): every onMessage
        // call, regardless of which connection it belongs to, is chained
        // onto ONE shared queue (state.messageDispatchLock) so at most one
        // message is ever being processed -- and activeConnectionId ever
        // rebound -- at a time app-wide.
        const task = state.messageDispatchLock.then(async () => {
          // Skips silently (same guard style as onChannelOpen above) if this
          // connection was already torn down by the time its turn in the
          // queue arrived.
          if (ownerConnectionIdAtWireTime !== null && !state.peers.has(ownerConnectionIdAtWireTime)) return;
          const previousActiveConnectionId = state.activeConnectionId;
          if (ownerConnectionIdAtWireTime !== null) state.activeConnectionId = ownerConnectionIdAtWireTime;
          try {
            if (!state.sessionKey) return; // message arrived before session key derived; drop rather than throw
            const isRatcheted = payload.startsWith(RATCHET_WIRE_PREFIX);
            if (isRatcheted && !state.receiveChainKey) return; // arrived in the brief window before the chain was derived; drop rather than throw
            try {
              const text = isRatcheted
                ? await decryptMessage(await nextReceiveMessageKey(), payload.slice(RATCHET_WIRE_PREFIX.length))
                : await decryptMessage(state.sessionKey, payload);
              await onDecryptedMessage(text);
            } catch (err) {
              // This callback runs detached from any button handler, so nothing
              // upstream can catch a rejection here.
              setStatus(t("status.error", { msg: err.message }));
            }
          } finally {
            state.activeConnectionId = previousActiveConnectionId;
          }
        });
        // Keep the queue alive even if this message's processing rejects --
        // one connection's failure must not wedge dispatch for every other
        // connection's subsequent messages (same pattern as serializedChainStep's
        // lock-chain below).
        state.messageDispatchLock = task.then(
          () => {},
          () => {}
        );
        return task;
      },
      onChannelClose: () => {
        setStatus(t("status.closed"));
        // Section RF9: without this, sendChatMessage's "is there a live
        // connection" check would keep seeing a truthy (but dead) channel
        // reference after a drop, and try to .send() on a closed
        // RTCDataChannel instead of queuing -- this is what makes
        // reconnect-and-resync share the exact same queuing path as
        // "never connected yet".
        state.channel = null;
        for (const id of ["btn-start-call", "btn-toggle-camera", "btn-toggle-mic"]) {
          el(id).disabled = true;
        }
        if (state.localMediaPreviewTimeoutId) {
          clearTimeout(state.localMediaPreviewTimeoutId);
          state.localMediaPreviewTimeoutId = null;
        }
        if (state.localStream) {
          for (const track of state.localStream.getTracks()) track.stop();
          state.localStream = null;
        }
        state.localTracksAddedToPeer = false;
        updateCallButtonStates();
        // Section RF5: hides the small remote-video corner overlay again --
        // otherwise it'd sit there as an empty dark box once the stream
        // that was filling it is gone.
        el("video-remote").hidden = true;
        el("video-remote").srcObject = null;
      },
      onError: (err) => {
        disarmIceTimeout(); // the local-description IIFE failed before onLocalOfferReady/onLocalAnswerReady
        // could ever fire to disarm it itself -- without this the stale ICE timeout
        // would later overwrite this real error with a misleading timeout message.
        setStatus(t("status.error", { msg: err.message }));
      }
    };
  }

  // Wire-format marker for ratchet-encrypted payloads (chat text only, Section
  // P2b). Everything else (announces, calls, device-linking) stays on the
  // unmarked static sessionKey, unchanged from before this section.
  const RATCHET_WIRE_PREFIX = "R1:";

  // ratchetStep is a stateful, sequential step over shared mutable state
  // (state.sendChainKey/receiveChainKey): each call must read the current
  // chain key, await the crypto step, then mutate it before the NEXT call
  // reads it. Two overlapping calls (e.g. two chat messages arriving back to
  // back) would otherwise both read the same chain key and desync the
  // session irrecoverably. These locks force strictly sequential execution
  // regardless of how many callers invoke them concurrently.
  state.sendChainLock = Promise.resolve();
  state.receiveChainLock = Promise.resolve();

  function serializedChainStep(lockField, chainField) {
    // Section GC0 exec-review iter2 finding: `ratchetStep` awaits a real
    // crypto.subtle call, yielding the event loop -- if btn-logout's
    // resetActiveConnection() runs during that await, the writeback below
    // would otherwise hit the PEER_PROXY_FIELDS setter's ensureActivePeer(),
    // which -- finding no active entry -- lazily resurrects a brand-new
    // phantom state.peers entry post-logout (a real divergence from the
    // original flat-state code, where a late write just landed on an inert
    // dead field). Snapshotting the connectionId before the await and
    // skipping the writeback if it no longer matches the active connection
    // avoids resurrecting an entry for a session that no longer exists.
    const connectionIdAtStart = state.activeConnectionId;
    const step = state[lockField].then(async () => {
      const { messageKey, nextChainKeyBytes } = await ratchetStep(state[chainField]);
      if (state.activeConnectionId === connectionIdAtStart) {
        state[chainField] = nextChainKeyBytes;
      }
      return messageKey;
    });
    state[lockField] = step.then(
      () => {},
      () => {} // keep the lock chain alive even if this step's crypto call rejects
    );
    return step;
  }

  async function nextSendMessageKey() {
    return serializedChainStep("sendChainLock", "sendChainKey");
  }

  async function nextReceiveMessageKey() {
    return serializedChainStep("receiveChainLock", "receiveChainKey");
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
        const remoteVideo = el("video-remote");
        remoteVideo.srcObject = stream;
        remoteVideo.hidden = false;
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
          const rootKey = await deriveRootKey(ecdhKeyPair.privateKey, peerEcdhPubkey);
          ({ sendChainKey: state.sendChainKey, receiveChainKey: state.receiveChainKey } =
            await deriveInitialChainKeys(rootKey, ecdhPubkey, peerEcdhPubkeyWire));
          if (onSessionReady) await onSessionReady();
          void flushPendingOutgoingMessages(); // Section RF9: session key just landed -- channel may already be open
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
        const remoteVideo = el("video-remote");
        remoteVideo.srcObject = stream;
        remoteVideo.hidden = false;
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
          const rootKey = await deriveRootKey(ecdhKeyPair.privateKey, peerEcdhPubkey);
          ({ sendChainKey: state.sendChainKey, receiveChainKey: state.receiveChainKey } =
            await deriveInitialChainKeys(rootKey, ecdhPubkey, peerEcdhPubkeyWire));
          if (onSessionReady) await onSessionReady();
          void flushPendingOutgoingMessages(); // Section RF9: session key just landed -- channel may already be open
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

  // Superseded by btn-quick-chat (Section F3) in the real UI -- kept only
  // for test fixtures that still use it as identity-setup boilerplate for
  // unrelated features, so guarded rather than removed outright.
  if (el("btn-generate")) {
    el("btn-generate").addEventListener("click", async () => {
      state.identityKeyPair = await generateIdentityKeyPair();
      state.senderKey = await fingerprint(state.identityKeyPair.publicKey);
      setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
      resetOwnProofsState();
      renderGuestQuickActions();
      renderNotificationsCard();
    renderRecoveryCard();
      router.navigate("room");
    });
  }

  const setProfileStatus = (text) => {
    el("profile-status").textContent = text;
  };

  el("btn-create-profile").addEventListener("click", () => {
    el("profile-setup").hidden = false;
  });

  // Section H3: offer a generated password by default when the user opts
  // into a portable account, without clobbering anything they've already
  // typed (e.g. re-checking the box after editing the field).
  el("portable-account-checkbox").addEventListener("change", () => {
    if (el("portable-account-checkbox").checked && !el("profile-passphrase").value) {
      el("profile-passphrase").value = generateStrongPassword();
    }
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

  // Section PN4 (specs/phase5/push-notifications.md): enabling push
  // notifications. Mostly untested runtime glue -- Notification,
  // navigator.serviceWorker and PushManager don't exist in jsdom (same split
  // as sw.js in PN3: pure helpers in pushSubscription.js are tested, this
  // wiring isn't). Permanent-profile only (gated by vaultKey, same as
  // renderNotificationsCard's own visibility).
  /* c8 ignore start */
  async function enableNotifications() {
    const checkbox = el("notifications-enabled");
    const setNotificationsStatus = (text) => {
      el("notifications-status").textContent = text;
    };
    if (!state.identityKeyPair || !state.identityKeyPair.vaultKey) {
      if (checkbox) checkbox.checked = false;
      return;
    }
    if (!("Notification" in doc.defaultView) || !("serviceWorker" in doc.defaultView.navigator)) {
      setNotificationsStatus(t("notifications.notSupported"));
      if (checkbox) checkbox.checked = false;
      return;
    }
    try {
      const permission = await doc.defaultView.Notification.requestPermission();
      if (permission !== "granted") {
        setNotificationsStatus(t("notifications.permissionDenied"));
        if (checkbox) checkbox.checked = false;
        return;
      }
      const registration = await doc.defaultView.navigator.serviceWorker.ready;
      // Avoid double-subscribing (and rotating the endpoint/keys for no
      // reason) if this profile already has an active push subscription.
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe(
          buildPushSubscribeOptions(VAPID_PUBLIC_KEY_RAW_BASE64URL)
        );
      }
      const serialized = serializeSubscriptionForAnnounce(subscription);
      if (!serialized) {
        setNotificationsStatus(t("status.error", { msg: "invalid subscription" }));
        if (checkbox) checkbox.checked = false;
        return;
      }
      const { endpoint, keys } = serialized;
      await put("profile", ownPushSubscriptionKey(state.senderKey), { endpoint, keys });
      if (state.channel && state.sessionKey) {
        state.channel.send(
          await encryptMessage(state.sessionKey, JSON.stringify({ type: "push-subscription-announce", endpoint, keys }))
        );
      }
      setNotificationsStatus(t("notifications.enabled"));
    } catch (err) {
      setNotificationsStatus(t("status.error", { msg: err.message }));
      if (checkbox) checkbox.checked = false;
    }
  }
  el("notifications-enabled")?.addEventListener("change", () => {
    if (el("notifications-enabled").checked) {
      enableNotifications();
    }
  });
  /* c8 ignore stop */

  // Section E: publishing/managing own linked-identity proofs.
  const setProofsStatus = (text) => {
    el("proofs-status").textContent = text;
  };
  // Kept only for this session (not persisted): re-parsed to get the exact
  // identity wire this block was signed for, so "Додати" can sanity-check
  // the fetched publication against OUR OWN block without needing to
  // re-export the (possibly non-extractable) identity public key.
  let lastGeneratedProofBlockText = null;
  // Cached in memory rather than re-read from storage on every render --
  // both because it avoids a round-trip and because it's simply the
  // in-flight value this tab is editing (mirrors ownDeviceList's own
  // get()-on-demand pattern, but this one changes multiple times per
  // session via add/revoke, so a cache avoids a stale-read race between a
  // just-completed put() and an immediately following get()).
  let ownProofSetCache = undefined; // undefined = not loaded yet; null = loaded, empty

  /**
   * Called whenever a DIFFERENT identity becomes active in this tab
   * (quick-chat, unlock, create-profile, device-join) -- without this, an
   * earlier profile's cached proof set / just-generated block would leak
   * into the newly-active profile's UI and, worse, get persisted under the
   * new profile's storage key (exec review finding, Section E).
   */
  function resetOwnProofsState() {
    lastGeneratedProofBlockText = null;
    ownProofSetCache = undefined;
    if (el("proof-block-display")) el("proof-block-display").textContent = "";
    if (el("own-proofs-list")) el("own-proofs-list").innerHTML = "";
  }

  async function loadOwnProofSet() {
    if (ownProofSetCache === undefined) {
      ownProofSetCache = (await get("profile", ownProofSetKey(state.senderKey))) ?? null;
    }
    return ownProofSetCache;
  }

  async function renderOwnProofsList() {
    const list = el("own-proofs-list");
    if (!list) return;
    list.innerHTML = "";
    const ownSet = await loadOwnProofSet();
    for (const proof of ownSet?.proofs ?? []) {
      const row = doc.createElement("div");
      row.className = "list-row";
      row.textContent = `${proof.label}: ${proof.url} `;
      const revokeBtn = doc.createElement("button");
      revokeBtn.type = "button";
      revokeBtn.textContent = t("btn.revokeProof");
      revokeBtn.addEventListener("click", async () => {
        ownProofSetCache = await revokeProofFromSet(state.identityKeyPair.privateKey, ownProofSetCache, proof.url);
        await put("profile", ownProofSetKey(state.senderKey), ownProofSetCache);
        await renderOwnProofsList();
      });
      row.appendChild(revokeBtn);
      list.appendChild(row);
    }
  }

  withBusyButton(el("btn-generate-proof"), async () => {
    const block = await createProofBlock(
      state.identityKeyPair.privateKey,
      state.identityKeyPair.publicKey,
      formatSpiritId(state.senderKey)
    );
    lastGeneratedProofBlockText = block;
    el("proof-block-display").textContent = block;
  });

  withBusyButton(el("btn-add-proof"), async () => {
    const url = el("proof-url-input").value.trim();
    if (!url) {
      setProofsStatus(t("proofs.needUrl"));
      return;
    }
    if (!lastGeneratedProofBlockText) {
      setProofsStatus(t("proofs.needGenerateFirst"));
      return;
    }
    try {
      const ownWire = parseProofBlock(lastGeneratedProofBlockText)?.identity;
      const text = await fetchProofPageText(el("server-url").value, state.senderKey, url);
      const parsed = parseProofBlock(text);
      if (!(await verifyProofBlock(parsed, ownWire))) {
        setProofsStatus(t("proofs.sanityCheckFailed"));
        return;
      }
      const label = new URL(url).hostname;
      const current = await loadOwnProofSet();
      ownProofSetCache = await addProofToSet(state.identityKeyPair.privateKey, current, { url, label, added_at: Date.now() });
      await put("profile", ownProofSetKey(state.senderKey), ownProofSetCache);
      el("proof-url-input").value = "";
      setProofsStatus("");
      await renderOwnProofsList();
    } catch (err) {
      setProofsStatus(t("status.error", { msg: err.message }));
    }
  });

  withBusyButton(el("btn-check-proofs-now"), async () => {
    el("proofs-check-status").textContent = "";
    await checkContactProofs();
  });

  // Periodic re-check (Section 18 decision: a real setInterval while the
  // tab is open, not just on-screen-open) -- deduplicated the same way as
  // the router's/app's own hashchange listeners, so re-initializing (tests,
  // HMR) never stacks a second interval ticking in the background.
  const PROOF_RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
  if (doc.defaultView.__spiritProofRecheckInterval) {
    doc.defaultView.clearInterval(doc.defaultView.__spiritProofRecheckInterval);
  }
  doc.defaultView.__spiritProofRecheckInterval = doc.defaultView.setInterval(() => {
    checkContactProofs().catch(() => {});
  }, PROOF_RECHECK_INTERVAL_MS);

  // Section 17/18: a returning user (stored profiles exist) sees the login
  // block instead of the create-account flow; a remembered, not-yet-expired
  // session preselects which profile so they only need to type the
  // passphrase -- the passphrase itself is never skipped or persisted.
  async function refreshProfileSelector() {
    const select = el("profile-select");
    select.innerHTML = "";
    const profiles = await listProfiles();
    // Browser-wide MRU list (Section G1) -- recently used accounts first,
    // capped at 10 total so the list can't grow unboundedly on a
    // shared/public machine; anything beyond that still exists in storage,
    // it's just not offered here until it's used again some other way.
    const recentIds = getRecentAccounts();
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const ordered = [
      ...recentIds.map((id) => byId.get(id)).filter(Boolean),
      ...profiles.filter((p) => !recentIds.includes(p.id))
    ].slice(0, 10);
    for (const { id } of ordered) {
      const option = doc.createElement("option");
      option.value = id;
      option.textContent = id === "identity" ? t("profile.legacyOption") : formatSpiritId(id).slice(0, 26) + "…";
      select.appendChild(option);
    }
    // Hide once an identity is already active this session (e.g. right
    // after creating a profile) -- there's nothing to log into anymore.
    // Create/login are mutually exclusive (Section F2) -- one always shows
    // when the other is hidden, defaulting to login for a returning user.
    el("account-login-block").hidden = profiles.length === 0 || !!state.senderKey;
    el("account-create-mode").hidden = !el("account-login-block").hidden;
    const remembered = getRememberedProfileId();
    if (remembered && profiles.some((p) => p.id === remembered)) {
      select.value = remembered;
    }
  }
  // Fire-and-forget at startup; an empty selector is the correct state on error too.
  refreshProfileSelector().catch(() => {});

  // Section F2: manual override of the default create/login mode -- e.g. a
  // returning user (default: login) wants to create ANOTHER account, or
  // vice versa.
  el("link-switch-to-login").addEventListener("click", () => {
    el("account-login-block").hidden = false;
    el("account-create-mode").hidden = true;
  });
  el("link-switch-to-create").addEventListener("click", () => {
    el("account-create-mode").hidden = false;
    el("account-login-block").hidden = true;
  });

  // Section H4 (specs/ui/deterministic-accounts.md): cross-node login --
  // available regardless of whether this browser has any local profile
  // record for this account (that's the entire point: it works on a node
  // that has NEVER seen this account before).
  const setPortableLoginStatus = (text) => {
    el("portable-login-status").textContent = text;
  };
  el("link-toggle-portable-login").addEventListener("click", () => {
    el("portable-login-form").hidden = !el("portable-login-form").hidden;
  });
  const PORTABLE_LOGIN_PATTERN = /^spirit([a-z0-9]{10})([A-Za-z0-9_-]{16})$/;
  withBusyButton(el("btn-login-portable"), async () => {
    const login = el("portable-login-input").value.trim();
    const password = el("portable-password-input").value;
    const match = PORTABLE_LOGIN_PATTERN.exec(login);
    if (!match) {
      setPortableLoginStatus(t("portable.invalidLogin"));
      return;
    }
    const [, name, expectedTail] = match;
    const { privateKeyScalar, verifierTail } = await deriveAccountMaterial(name, password);
    if (verifierTail !== expectedTail) {
      setPortableLoginStatus(t("portable.wrongCredentials"));
      return;
    }
    state.identityKeyPair = await adoptScalarIdentity(privateKeyScalar, password);
    state.senderKey = state.identityKeyPair.profileId;
    // Exec review: every other identity-establishing path loads the
    // account's own nickname -- skipping this would leak a STALE nickname
    // (e.g. a prior ephemeral quick-chat one) to peers on the next
    // identity-announce, under a completely different identity.
    state.nickname = await getNickname(state.senderKey);
    el("portable-password-input").value = "";
    resetOwnProofsState();
    renderGuestQuickActions();
    renderNotificationsCard();
    renderRecoveryCard();
    setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
    setPortableLoginStatus("");
    // Exec review: same session/MRU bookkeeping as the regular unlock path,
    // so this account is offered via profile-select on a later visit too.
    rememberSession(state.senderKey, readSessionTtlHours());
    recordRecentAccount(state.senderKey);
    await refreshProfileSelector();
    router.navigate(postIdentityRoute());
  });

  // Section S3 (specs/phase5/social-recovery.md): owner-side recovery --
  // combine >= threshold pasted share-text strings back into the identity
  // scalar, then land in a logged-in state via the EXACT SAME post-scalar
  // adoption path as portable-login above (adoptScalarIdentity -> senderKey
  // -> nickname -> re-render cards -> remember session -> navigate). No new
  // security posture invented here, just a different way to arrive at the
  // same scalar.
  const setRecoveryRestoreStatus = (text) => {
    const status = el("recovery-restore-status");
    if (status) status.textContent = text;
  };
  el("link-toggle-recovery-restore")?.addEventListener("click", () => {
    el("recovery-restore-form").hidden = !el("recovery-restore-form").hidden;
  });
  if (el("btn-recover-from-shares")) withBusyButton(el("btn-recover-from-shares"), async () => {
    const shareTexts = el("recovery-restore-shares").value.split("\n");
    const passphrase = el("recovery-restore-passphrase").value;

    const result = recoverFromShares(shareTexts);
    if (!result.ok) {
      if (result.reason === "empty") setRecoveryRestoreStatus(t("recovery.restoreEmpty"));
      else if (result.reason === "malformed") setRecoveryRestoreStatus(t("recovery.restoreMalformed", { detail: result.detail }));
      else if (result.reason === "inconsistent") setRecoveryRestoreStatus(t("recovery.restoreInconsistent"));
      else if (result.reason === "insufficient") {
        const [have, need] = result.detail.match(/\d+/g) || [];
        setRecoveryRestoreStatus(t("recovery.restoreInsufficient", { have, need }));
      } else setRecoveryRestoreStatus(result.detail || result.reason);
      return;
    }
    if (!passphrase) {
      setRecoveryRestoreStatus(t("recovery.restoreNeedPassphrase"));
      return;
    }

    let identityKeyPair;
    try {
      identityKeyPair = await adoptScalarIdentity(result.scalar, passphrase);
    } catch {
      // Per Shamir's guarantee (shamir.js's combineShares doc comment),
      // combining an inconsistent/insufficient set of shares can't be
      // detected mathematically -- the only signal available is whether the
      // resulting bytes fail to import as a valid P-256 scalar (the known
      // ~2^-32 edge case, deterministicIdentity.js) or, more commonly here,
      // that the caller pasted shares from the wrong set that still happen
      // to be self-consistent. Either way: a clear, actionable message, not
      // a cryptic stack trace, per the spec's explicit UX requirement.
      // Exec review nice-to-have: don't wipe the pasted shares on a
      // RETRYABLE failure -- the UX copy explicitly invites the user to
      // "try again", and the individual share texts are below-threshold-
      // useless on their own (no security reason to force a full re-paste
      // mid-recovery-crisis). Only the passphrase is cleared here.
      el("recovery-restore-passphrase").value = "";
      setRecoveryRestoreStatus(t("recovery.restoreImportFailed"));
      return;
    }
    // Don't leave the reconstructed key material or passphrase sitting in
    // DOM inputs any longer than needed (same care as every other
    // raw-key-handling path in this file, e.g. btn-backup-mnemonic) -- only
    // on the success path, once the shares are no longer needed.
    el("recovery-restore-shares").value = "";
    el("recovery-restore-passphrase").value = "";

    state.identityKeyPair = identityKeyPair;
    state.senderKey = state.identityKeyPair.profileId;
    state.nickname = await getNickname(state.senderKey);
    resetOwnProofsState();
    renderGuestQuickActions();
    renderNotificationsCard();
    renderRecoveryCard();
    setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
    // Exec-review-flagged residual limitation (spec, Section S3): combining
    // shares can never cryptographically prove "this is definitely the
    // right key" -- the resulting fingerprint is surfaced prominently here
    // so the user can visually confirm it against what they expected
    // (a fingerprint they wrote down, or contacts recognizing it), the same
    // class of residual risk mnemonic restore already has.
    setRecoveryRestoreStatus(t("recovery.restoreSuccess", { fp: formatSpiritId(state.senderKey) }));
    rememberSession(state.senderKey, readSessionTtlHours());
    recordRecentAccount(state.senderKey);
    await refreshProfileSelector();
    router.navigate(postIdentityRoute());
  });

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
      resetOwnProofsState();
      renderGuestQuickActions();
      renderNotificationsCard();
    renderRecoveryCard();
      setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
      setProfileStatus("");
      // A legacy record migrates on unlock -- its id changes to the
      // fingerprint (profile.profileId), which is what must be remembered,
      // not the pre-migration `selectedId` ("identity") -- otherwise the
      // remembered id never matches on the next load's listProfiles().
      rememberSession(profile.profileId, readSessionTtlHours());
      recordRecentAccount(profile.profileId);
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
    // Section H3 (specs/phase3/deterministic-accounts.md): opt-in portable
    // account -- identity is derived from (name, password) via Argon2id
    // instead of generated at random, so the SAME account can be recreated
    // on any independent node (Section H4). Default (unchecked) path below
    // is completely unchanged -- existing local-only accounts still work
    // exactly as before.
    if (el("portable-account-checkbox").checked) {
      const name = generateAccountName();
      const { privateKeyScalar, verifierTail } = await deriveAccountMaterial(name, passphrase);
      state.identityKeyPair = await adoptScalarIdentity(privateKeyScalar, passphrase);
      state.senderKey = state.identityKeyPair.profileId;
      el("portable-login-display").textContent = `spirit${name}${verifierTail}`;
    } else {
      state.identityKeyPair = await createPermanentProfile(passphrase);
      state.senderKey = await fingerprint(state.identityKeyPair.publicKey);
    }
    // Don't keep the secret sitting in a DOM input after it's been used.
    el("profile-passphrase").value = "";
    resetOwnProofsState();
    renderGuestQuickActions();
    renderNotificationsCard();
    renderRecoveryCard();
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

  /**
   * Section F6 (instant conversation lobby, 2026-07-17): land on the
   * conversation screen (invite bar + local camera/mic preview, both usable
   * before any peer has joined) the moment THIS side's own session starts --
   * not only once the data channel actually opens. Shared by both the
   * initiator (owns the invite) and the joiner (doesn't).
   */
  function enterConversationLobby({ ownsInvite }) {
    state.isInviteOwner = ownsInvite;
    // Section GC3: entering an ordinary 1:1 session always routes the
    // shared conversation screen back to 1:1 mode, even if a group
    // conversation was open moments ago.
    state.activeGroupId = null;
    const groupHeading = el("group-conversation-heading");
    if (groupHeading) groupHeading.hidden = true;
    const groupLog = el("group-chat-log");
    if (groupLog) groupLog.hidden = true;
    const oneToOneLog = el("chat-log");
    if (oneToOneLog) oneToOneLog.hidden = false;
    router.navigate("conversation");
    renderEphemeralBanner();
    renderInviteBar();
    if (localMediaPreviewDelayMs > 0) {
      state.localMediaPreviewTimeoutId = setTimeout(() => {
        state.localMediaPreviewTimeoutId = null;
        // Defensive (exec review finding): if logout/channel-close happened
        // during the delay window but somehow didn't clear this timer, don't
        // re-acquire media for a session that no longer has an identity.
        if (!state.senderKey) return;
        void previewLocalMedia();
      }, localMediaPreviewDelayMs);
    } else {
      void previewLocalMedia();
    }
  }

  /**
   * Shared by "Ініціювати чат" (explicit, profile-mode-friendly) and the
   * zero-click "Швидкий анонімний чат" (Section F3, specs/ui/ephemeral-spirit-mode.md)
   * -- both need an already-established state.senderKey/identityKeyPair.
   */
  async function initiateChatSession({ pushToContact = null } = {}) {
    const serverUrl = el("server-url").value;
    const rtcConfig = buildRtcConfig(el("stun-url").value, { forceTurnRelay: el("force-turn-relay").checked });
    const senderKey = state.senderKey;

    const ecdhKeyPair = await generateEcdhKeyPair();
    // Section SR2 (specs/phase5/sybil-resistance.md): createInvite() now
    // solves a PoW before it can POST, which can take a noticeable moment
    // (up to ~1s at the recommended difficulty, longer on weak/mobile
    // devices) -- surface that as a status message rather than leaving the
    // UI looking stuck with no feedback.
    const { roomId, inviteToken } = await createInvite(serverUrl, senderKey, {
      onPowStart: () => setStatus(t("status.solvingPow"))
    });
    el("room-id").value = roomId;
    el("invite-token").value = inviteToken;
    // Section PN5: notifying a specific offline contact out-of-band via Web
    // Push, on top of the invite link this already produces. Fire-and-forget
    // -- sendPushNotification never throws (fails soft internally), and this
    // must never block or gate landing in the lobby: the invite link is
    // always shown/copyable regardless of whether the push itself succeeds.
    if (pushToContact?.pushSubscription) {
      void sendPushNotification(pushToContact.pushSubscription, { room: roomId, token: inviteToken });
    }
    // Land on the conversation lobby immediately, before a peer has joined --
    // otherwise the initiator (quick-chat especially) has no way to share
    // the link or test their camera/mic, and "opening the chat" silently
    // does nothing from their point of view.
    enterConversationLobby({ ownsInvite: true });

    state.peerFingerprint = null;
    hideSafetyNumberHint();
    state.sessionEcdhWires = null;
    const announce = makeIdentityAnnouncer();
    startInitiatorSession({
      senderKey,
      ecdhKeyPair,
      roomId,
      inviteToken,
      serverUrl,
      rtcConfig,
      // Device linking reuses these same session helpers but must NOT jump
      // to the conversation screen -- it passes its own channelOptions
      // without afterChannelOpen, so this default is unaffected there.
      channelOptions: {
        afterChannelOpen: () => {
          announce();
        }
      },
      onSessionReady: announce
    });
  }

  /**
   * Section GC2 (specs/phase4/group-chats.md): mints one 1:1 invite tagged
   * with `groupId`, used both by group creation (once per initial member)
   * and by "add member to an existing group" (once, for a single new
   * contact). Deliberately does NOT call enterConversationLobby/navigate
   * anywhere -- per the spec's own scope-narrowing (2026-07-18, star/tree
   * invite topology, no presence detection), inviting several people to a
   * group is NOT "connect to N people at once from one UI action"; it's
   * "mint N one-shot invite links, shown as copyable text, joined
   * asynchronously whenever convenient". Unlike initiateChatSession, this
   * ALWAYS creates a brand-new state.peers entry (never reuses whatever is
   * currently active) so it never clobbers an unrelated 1:1 conversation
   * the user might already be in.
   *
   * `startLiveSession` (GC2 exec-review iter1 finding): the app's
   * PEER_PROXY_FIELDS/wireChannelCallbacks machinery (Section GC0) reads
   * and writes every per-connection field through "whichever entry is
   * CURRENTLY active" -- correct and race-free as long as at most one
   * initiator handshake is ever pending at a time (true for every existing
   * 1:1 flow). Starting a SECOND real startInitiatorSession while the first
   * is still awaiting pollForAnswer would move activeConnectionId out from
   * under it, so the first handshake's eventual completion (sessionKey,
   * chain keys, even which pc gets the remote answer applied) would land on
   * the SECOND entry instead -- silent session corruption. Rather than
   * rebuild the whole active-connection model into a per-connectionId
   * router (a GC3-scale change, out of scope here), GC2 keeps this
   * invariant intact: only ONE contact per group-invite action gets a real,
   * live, listening WebRTC session (`startLiveSession: true`, tagged and
   * wired exactly like a normal 1:1 invite); every other selected contact
   * only gets its invite link MINTED (a plain createInvite() call, no
   * session, no state.peers entry) for the owner to share out-of-band --
   * consistent with the spec's own note that group-invite joining happens
   * "sequentially/asynchronously", not simultaneously.
   */
  async function startTaggedGroupInvite({ groupId, startLiveSession = true }) {
    const serverUrl = el("server-url").value;
    const senderKey = state.senderKey;

    if (!startLiveSession) {
      return createInvite(serverUrl, senderKey, { onPowStart: () => setGroupStatus(t("status.solvingPow")) });
    }

    const rtcConfig = buildRtcConfig(el("stun-url").value, { forceTurnRelay: el("force-turn-relay").checked });
    const ecdhKeyPair = await generateEcdhKeyPair();
    const { roomId, inviteToken } = await createInvite(serverUrl, senderKey, {
      onPowStart: () => setGroupStatus(t("status.solvingPow"))
    });

    const connectionId = randomConnectionId();
    const entry = createPeerEntry();
    entry.groupId = groupId;
    state.peers.set(connectionId, entry);
    state.activeConnectionId = connectionId;

    const announce = makeIdentityAnnouncer();
    startInitiatorSession({
      senderKey,
      ecdhKeyPair,
      roomId,
      inviteToken,
      serverUrl,
      rtcConfig,
      channelOptions: {
        afterChannelOpen: () => {
          announce();
        }
      },
      onSessionReady: announce
    });

    return { roomId, inviteToken };
  }

  withBusyButton(el("btn-initiate"), async () => {
    if (!state.senderKey) {
      setStatus(t("status.createAccountFirst"));
      return;
    }
    await initiateChatSession();
  });

  // Section F3: fully automatic ephemeral "spirit mode" -- one click does
  // everything btn-generate + btn-initiate used to require separately:
  // ephemeral identity, a throwaway anonymous nickname, invite creation,
  // and the handshake itself, landing straight on the conversation screen.
  withBusyButton(el("btn-quick-chat"), async () => {
    state.identityKeyPair = await generateIdentityKeyPair();
    state.senderKey = await fingerprint(state.identityKeyPair.publicKey);
    state.nickname = generateAnonymousNickname();
    setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
    resetOwnProofsState();
    renderGuestQuickActions();
    renderNotificationsCard();
    renderRecoveryCard();
    await initiateChatSession();
  });

  withBusyButton(el("btn-join"), async () => {
    if (!state.senderKey) {
      setStatus(t("status.createAccountFirst"));
      return;
    }
    state.peerFingerprint = null;
    hideSafetyNumberHint();
    state.sessionEcdhWires = null;
    // Section GC3: the peerFingerprint write above already lazily created
    // this connection's state.peers entry (PEER_PROXY_FIELDS/ensureActivePeer)
    // -- tag it with the group carried by the invite link, mirroring how
    // startTaggedGroupInvite (GC2) tags the INVITER's side.
    if (invitedGroupId) ensureActivePeer().groupId = invitedGroupId;
    const announce = makeIdentityAnnouncer();
    await startJoinerSession({
      senderKey: state.senderKey,
      roomId: el("room-id").value,
      inviteToken: el("invite-token").value,
      serverUrl: el("server-url").value,
      rtcConfig: buildRtcConfig(el("stun-url").value, { forceTurnRelay: el("force-turn-relay").checked }),
      channelOptions: {
        afterChannelOpen: () => {
          announce();
        }
      },
      onSessionReady: announce
    });
    // Land on the conversation lobby (camera/mic preview) immediately --
    // the joiner never owns the invite (Section F6).
    enterConversationLobby({ ownsInvite: false });
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
    const rtcConfig = buildRtcConfig(el("stun-url").value, { forceTurnRelay: el("force-turn-relay").checked });
    const senderKey = randomSenderKey();

    const ecdhKeyPair = await generateEcdhKeyPair();
    const { roomId, inviteToken } = await createInvite(serverUrl, senderKey, {
      onPowStart: () => setDeviceLinkStatus(t("status.solvingPow"))
    });
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
      rtcConfig: buildRtcConfig(el("stun-url").value, { forceTurnRelay: el("force-turn-relay").checked }),
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
          resetOwnProofsState();
          renderGuestQuickActions();
          renderNotificationsCard();
    renderRecoveryCard();
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
      updateCallButtonStates();
    } catch (err) {
      setVideoStatus(t("status.error", { msg: err.message }));
    }
  });

  el("btn-toggle-camera").addEventListener("click", () => {
    if (!state.localStream) return;
    for (const track of state.localStream.getTracks()) {
      if (track.kind === "video") track.enabled = !track.enabled;
    }
    updateCallButtonStates();
  });

  el("btn-toggle-mic").addEventListener("click", () => {
    if (!state.localStream) return;
    for (const track of state.localStream.getTracks()) {
      if (track.kind === "audio") track.enabled = !track.enabled;
    }
    updateCallButtonStates();
  });

  // Section RF9: actually encrypts+transmits ONE message over the current
  // channel and persists it to history -- shared by the immediate-send
  // path and the queue drain, so both go through the exact same ratchet
  // (nextSendMessageKey) and history-write sequence. `row` (if given) is
  // the already-rendered bubble from when the message was first queued;
  // its pending badge is cleared once the send actually succeeds.
  async function sendSingleChatMessage(text, sentAt, row) {
    const messageKey = await nextSendMessageKey();
    const payload = RATCHET_WIRE_PREFIX + (await encryptMessage(messageKey, text));
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

  /**
   * Section GC3 design point 5: opens a group's conversation in the SAME
   * conversation screen 1:1 chat uses, routed by state.activeGroupId rather
   * than a dedicated screen -- reuses existing chat-log/input/send
   * infrastructure per this project's usual preference. Replays this
   * group's stored history first (mirrors the identity-announce history
   * replay for 1:1 chat). Received messages were stored with sender
   * attribution embedded in the `text` field itself (JSON-encoded) since
   * historyStore.js's schema (direction/text/timestamp only) is
   * deliberately unchanged (GC1) -- outbound messages need no such
   * encoding, the sender is always "you".
   */
  async function openGroupConversation(groupId, groupName) {
    state.activeGroupId = groupId;
    const heading = el("group-conversation-heading");
    if (heading) {
      setDynamicText(heading, t("groups.chatHeading", { name: groupName }));
      heading.hidden = false;
    }
    const container = el("group-chat-log");
    if (container) {
      container.textContent = "";
      container.hidden = false;
    }
    const oneToOneLog = el("chat-log");
    if (oneToOneLog) oneToOneLog.hidden = true;
    if (state.identityKeyPair && state.identityKeyPair.vaultKey) {
      const history = await listMessages(state.identityKeyPair.vaultKey, state.senderKey, groupId);
      for (const entry of history) {
        if (entry.direction === "out") {
          appendGroupChat(entry.text, "out", null, entry.timestamp);
          continue;
        }
        let body = entry.text;
        let label = t("groups.unknownMember");
        try {
          const parsed = JSON.parse(entry.text);
          if (parsed && typeof parsed === "object" && typeof parsed.body === "string") {
            body = parsed.body;
            label = parsed.senderNickname || formatSpiritId(parsed.senderFingerprint || "");
          }
        } catch {
          // Pre-GC3/malformed row -- fall back to rendering the raw text
          // with an "unknown member" label rather than throwing.
        }
        appendGroupChat(body, "in", label, entry.timestamp);
      }
    }
    router.navigate("conversation");
  }

  el("btn-send").addEventListener("click", () => {
    // Section GC3: routes to the group fan-out send when a group
    // conversation is currently open, otherwise the existing 1:1 path --
    // unchanged behavior for every pre-GC3 caller (state.activeGroupId is
    // null until openGroupConversation sets it).
    const text = el("message-input").value;
    if (!text) return;
    if (state.activeGroupId) {
      el("message-input").value = "";
      void sendGroupMessage(state.activeGroupId, text);
    } else {
      void sendChatMessage();
    }
  });

  // Section FT2 (specs/phase4/file-transfer.md): selecting a file only ever
  // computes its hash/chunks and sends a file-offer -- chunks are NEVER
  // sent here. Actual chunk streaming happens exclusively in
  // sendFileChunks(), which is only reachable from the "file-accept" branch
  // of handleChatMessage above, once the peer has explicitly accepted.
  const fileInput = el("file-input");
  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file || !state.channel || !state.sessionKey || !state.peerFingerprint) return;
      const buffer = await file.arrayBuffer();
      const sha256 = await computeFileHash(buffer);
      const chunks = splitFileIntoChunks(buffer, FILE_CHUNK_SIZE);
      const fileId = randomFileId();
      state.outgoingFileTransfers[fileId] = {
        chunks,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        sentCount: 0
      };
      state.channel.send(
        await encryptMessage(
          state.sessionKey,
          JSON.stringify({
            type: "file-offer",
            fileId,
            name: file.name,
            size: file.size,
            mimeType: file.type,
            sha256,
            totalChunks: chunks.length
          })
        )
      );
      const statusText =
        file.size > FILE_SIZE_WARNING_BYTES
          ? t("fileTransfer.sizeWarning", { name: file.name })
          : t("fileTransfer.progressSending", { name: file.name, sent: 0, total: chunks.length });
      renderFileTransferStatus(fileId, statusText);
    });
  }

  const btnFileAccept = el("btn-file-accept");
  if (btnFileAccept) {
    btnFileAccept.addEventListener("click", async () => {
      const banner = el("file-offer-banner");
      const fileId = banner && banner.dataset.fileId;
      const offer = fileId && state.pendingFileOffers[fileId];
      if (!offer || !state.channel || !state.sessionKey) return;
      delete state.pendingFileOffers[fileId];
      banner.hidden = true;
      state.incomingFileTransfers[fileId] = {
        assembler: createFileAssembler(offer.totalChunks),
        name: offer.name,
        mimeType: offer.mimeType,
        sha256: offer.sha256,
        totalChunks: offer.totalChunks
      };
      renderFileTransferStatus(
        fileId,
        t("fileTransfer.progressReceiving", { name: offer.name, received: 0, total: offer.totalChunks })
      );
      state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify({ type: "file-accept", fileId })));
    });
  }

  const btnFileReject = el("btn-file-reject");
  if (btnFileReject) {
    btnFileReject.addEventListener("click", async () => {
      const banner = el("file-offer-banner");
      const fileId = banner && banner.dataset.fileId;
      const offer = fileId && state.pendingFileOffers[fileId];
      if (!offer || !state.channel || !state.sessionKey) return;
      delete state.pendingFileOffers[fileId];
      banner.hidden = true;
      state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify({ type: "file-reject", fileId })));
    });
  }
  // Bug report 2026-07-17: Enter alone must send, same as clicking "Надіслати"
  // -- Shift+Enter is left alone in case a future multi-line input wants it
  // for a newline (the input is a single-line <input> today, so it's a no-op,
  // but reserving the combination now avoids relitigating it later).
  el("message-input").addEventListener("keydown", (event) => {
    // event.isComposing (and the legacy keyCode 229 fallback some browsers
    // still use during IME composition) -- an Enter that COMMITS a CJK/other
    // composed-input candidate must not also send the still-in-progress text.
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      void sendChatMessage();
    }
  });

  // Section F4 (specs/ui/ephemeral-spirit-mode.md): visiting an invite link
  // requires ZERO clicks -- no identity exists yet at this point in a fresh
  // page load, so auto-generate one (+ a throwaway anonymous nickname) and
  // join immediately, exactly like btn-quick-chat does for the initiator.
  if (cameFromInviteLink) {
    (async () => {
      // Defensive (exec review): every real load starts with a clean
      // `state`, so this is always true today, but it guards against a
      // future auto-restore-session-on-load path silently clobbering an
      // already-active identity's WebRTC session with a fresh ephemeral one.
      if (state.senderKey) return;
      // A manual click on btn-quick-chat while auto-join is still in
      // flight would otherwise start a SECOND, competing initiator session
      // that stomps state.identityKeyPair/senderKey/pc out from under the
      // joiner session (exec review finding) -- disable it for the duration.
      const quickChatButton = el("btn-quick-chat");
      quickChatButton.disabled = true;
      try {
        state.identityKeyPair = await generateIdentityKeyPair();
        state.senderKey = await fingerprint(state.identityKeyPair.publicKey);
        state.nickname = generateAnonymousNickname();
        setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
        resetOwnProofsState();
        renderGuestQuickActions();
        renderNotificationsCard();
    renderRecoveryCard();

        state.peerFingerprint = null;
        hideSafetyNumberHint();
        state.sessionEcdhWires = null;
        // Section GC3: same joiner-side group tagging as btn-join above, for
        // the zero-click auto-join path (Section F4).
        if (invitedGroupId) ensureActivePeer().groupId = invitedGroupId;
        const announce = makeIdentityAnnouncer();
        await startJoinerSession({
        senderKey: state.senderKey,
        roomId: invitedRoomId,
        inviteToken: invitedToken,
        serverUrl: el("server-url").value,
        rtcConfig: buildRtcConfig(el("stun-url").value, { forceTurnRelay: el("force-turn-relay").checked }),
        channelOptions: {
          afterChannelOpen: () => {
            announce();
          }
        },
          onSessionReady: announce
        });
        // Land on the conversation lobby (camera/mic preview) immediately --
        // the joiner never owns the invite (Section F6).
        enterConversationLobby({ ownsInvite: false });
      } finally {
        quickChatButton.disabled = false;
      }
    })().catch((err) => setStatus(t("status.error", { msg: err.message })));
  } else if (autoStartChat && !getRememberedProfileId()) {
    // Section H5 (specs/ui/chat-first-redesign.md): a genuinely fresh visit
    // -- no invite link, no remembered profile session -- gets an ephemeral
    // chat with ZERO clicks, exactly what btn-quick-chat does manually.
    // Stored profiles (IndexedDB) are deliberately NOT checked here (would
    // require an async round-trip before this synchronous branch could even
    // run) -- a user with a stored-but-not-remembered profile still reaches
    // it via the Section H3 "Увійти" quick action; this only skips the
    // zero-click ephemeral path for the common "remembered session" case.
    (async () => {
      if (state.senderKey) return; // defensive, mirrors the F4 guard above
      const quickChatButton = el("btn-quick-chat");
      quickChatButton.disabled = true;
      try {
        state.identityKeyPair = await generateIdentityKeyPair();
        state.senderKey = await fingerprint(state.identityKeyPair.publicKey);
        state.nickname = generateAnonymousNickname();
        setDynamicText(el("pub-key-display"), formatSpiritId(state.senderKey));
        resetOwnProofsState();
        renderGuestQuickActions();
        renderNotificationsCard();
    renderRecoveryCard();
        await initiateChatSession();
      } finally {
        quickChatButton.disabled = false;
      }
    })().catch((err) => setStatus(t("status.error", { msg: err.message })));
  }

  // Section GC0 (specs/phase4/group-chats.md): expose the refactored
  // multi-connection internals for tests (and future GC1-GC3 code) --
  // additive only, nothing previously consumed initApp's return value
  // (index.html calls initApp(document) and discards it), so this cannot
  // change any existing behavior.
  return { state, getActivePeer, getPeerByFingerprint, getPeerByConnectionId };
}
