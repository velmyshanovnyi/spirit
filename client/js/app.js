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
import { APP_VERSION } from "./version.js";
import { acceptNewerDeviceList } from "./deviceLinking.js";
import { get, put } from "./db.js";
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
import { getSetting } from "./settingsRegistry.js";
import { applyDesignSettings, getDesignSetting } from "./designSettingsRegistry.js";
import { applyFooterSettings } from "./footerRegistry.js";
import { initSettingsPanelUI } from "./settingsPanelUI.js";
import { initSidebarFoldersUI } from "./sidebarFoldersUI.js";
import { saveTrustedShare, listTrustedShares, getTrustedShare } from "./trustedShares.js";
import { qrSvgMarkup } from "./qr.js";
import { recoverFromShares } from "./socialRecovery.js";
import { acceptNewerProofSet, addProofToSet, revokeProofFromSet } from "./proofSet.js";
import { createProofBlock, parseProofBlock, verifyProofBlock } from "./proofs.js";
import { fetchProofPageText } from "./fetchProof.js";
import { generateAnonymousNickname } from "./anonymousNickname.js";
import { chunkToBase64, base64ToChunk, computeFileHash, readFileChunk } from "./fileTransfer.js";
import { getGroup, listGroups, updateGroupMembers, ensureGroupBootstrap } from "./groups.js";
import { initGroupsUI } from "./groupsUI.js";
import { initDeviceLinkingUI } from "./deviceLinkingUI.js";
import { initFileTransferUI } from "./fileTransferUI.js";
import { isAdvancedModeUnlocked, isFeatureEnabled } from "./advancedMode.js";
import { initAdvancedModeUI } from "./advancedModeUI.js";
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
// Section SM3 (specs/ui/simplified-ephemeral-mode.md): everything except the
// ephemeral conversation itself, hidden by default until Advanced Mode is
// unlocked. "account" is deliberately excluded -- see the spec for why
// (it would cascade-loop against "conversation"'s own identity gate).
const ADVANCED_ROUTES = ["profile", "server", "room", "manage", "history"];

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
  // Section RF14: applies any stored color/shape/typography overrides as
  // inline :root custom properties -- must run on every load regardless of
  // which screen the user starts on, same as theme itself.
  applyDesignSettings(doc);
  // Section FC2 (specs/ui/footer-customization.md): footer visibility/
  // order + custom HTML blocks -- must run on every load same as design
  // settings, before the footer's own static content would otherwise be
  // visible in its unconfigured order.
  applyFooterSettings(doc);
  applyTranslations(doc);

  // Section footer-1 (2026-07-31, user request): static build marker, no
  // reactivity needed -- set once at boot, same as the rest of this block.
  const appVersionEl = el("app-version");
  if (appVersionEl) {
    appVersionEl.textContent = APP_VERSION;
  }

  // Section SM3 (specs/ui/simplified-ephemeral-mode.md): brief, dismissible
  // notice for a redirected-away restricted route -- same fade timeout
  // pattern as showCopiedTooltip below, but a fixed DOM slot (index.html)
  // rather than a dynamically anchored one, since it isn't tied to a click.
  function showAdvancedModeNotice() {
    const notice = el("advanced-mode-notice");
    if (!notice) return;
    notice.textContent = t("footer.advancedModeRestricted");
    notice.hidden = false;
    clearTimeout(notice.dataset.hideTimeoutId);
    notice.dataset.hideTimeoutId = doc.defaultView.setTimeout(() => {
      notice.hidden = true;
    }, 4000);
  }

  // User request (2026-08-08): the notice alone left a locked-out user
  // with the real password no actionable path forward -- router.js's
  // onRestricted (wired below, at initRouter()) now ALSO opens the
  // password modal directly, remembering which route they actually
  // wanted here so a successful unlock can take them straight there
  // instead of leaving them on whatever the redirect happened to land on.
  // Cleared on cancel (advancedModeUIHandle's onCancel below) so a
  // canceled attempt never carries over into some LATER, unrelated
  // unlock (e.g. via the footer toggle).
  let pendingRestrictedRoute = null;

  // renderGuestQuickActions is defined later in this closure (hoisted
  // function declaration) but only CALLED here on a later click, never at
  // this wiring line -- same hoisting-safety pattern as the *UI.js
  // extractions (Section G1). onVisibilityChange also re-dispatches
  // hashchange so the router (created further down, also hoisting-safe
  // since this only runs on a later click) re-evaluates the CURRENT route
  // against the now-changed lock state -- exec review finding 1: without
  // this, locking while on an advanced screen (e.g. #/server) left that
  // whole screen visible, only the sidebar/gear actually hid.
  const advancedModeUIHandle = initAdvancedModeUI({
    doc,
    el,
    t,
    onVisibilityChange: () => {
      renderGuestQuickActions();
      doc.defaultView.dispatchEvent(new Event("hashchange"));
      // isAdvancedModeUnlocked() distinguishes "just unlocked" from "just
      // locked" -- onVisibilityChange fires for both, but only a genuine
      // unlock should ever auto-navigate anywhere.
      if (isAdvancedModeUnlocked() && pendingRestrictedRoute) {
        const route = pendingRestrictedRoute;
        pendingRestrictedRoute = null;
        router.navigate(route);
      }
    },
    onCancel: () => {
      pendingRestrictedRoute = null;
    }
  });

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
      // Section C6 (specs/reviews/spirit-evaluation-triage.md):
      // renderSettingsRegistry()/renderDesignSettings() read entry.labelKey/
      // descriptionKey through t() at render time, but applyTranslations()
      // above only touches elements with a data-i18n attribute -- these two
      // panels are built imperatively and carry none, so without this call
      // they'd keep showing the PREVIOUS locale's text until the user
      // happened to edit or reset a field.
      renderSettingsRegistry();
      renderDesignSettings();
      // Section FC3 (specs/ui/footer-customization.md): same imperative-
      // render class of bug as the two calls just above -- footer item
      // labels are read through t() at render time too.
      renderFooterSettings();
      // Section GE3 (specs/ui/granular-feature-flags.md): same imperative-
      // render class of bug as the two calls just above -- feature-flag row
      // labels are read through t() at render time too.
      renderFeatureFlagsSettings();
      // Exec review finding 5 (specs/reviews/simplified-ephemeral-mode-SM2-SM3-iter1.md):
      // same class of bug as the C6 fix just above -- the footer toggle's
      // label is set imperatively (footer.advancedModeUnlock/Lock, chosen
      // by current lock state, not a fixed data-i18n key), so it needs its
      // own explicit re-render on language switch too.
      advancedModeUIHandle?.refreshToggleLabel();
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

  // User report (screenshot, 2026-07-31): the "Акаунт" create/login modal
  // visibly flashed on load before the F4/H5 zero-click auto-start flows
  // below navigate away from it. router.js's own gate resolution is
  // SYNCHRONOUS (settles to "account" before this function has even
  // finished running, since "conversation" is itself identity-gated and
  // no identity exists yet) -- but the actual navigate-away only happens
  // once the async identity-generation + createInvite/PoW/join-handshake
  // work resolves, which can take up to a second or more, not just one
  // microtask. Both auto-leave conditions are knowable SYNCHRONOUSLY,
  // right here, well before router init -- so suppress the modal's
  // VISUAL display via a body class (CSS-only, does not touch router.js's
  // own `.hidden` bookkeeping, which must keep resolving to "account" as
  // its gated fallback) whenever we're about to leave it anyway. Removed
  // in the F4/H5 branches' own `finally` blocks below, regardless of
  // success or failure -- on success the screen is already hidden by then
  // (no-op), on failure the user sees the normal, usable account screen
  // instead of being stuck looking at nothing.
  const willAutoLeaveAccountScreen = cameFromInviteLink || (autoStartChat && !getRememberedProfileId());
  if (willAutoLeaveAccountScreen) {
    doc.body.classList.add("account-modal-suppressed");
  }
  // User follow-up (2026-07-31): suppressing the account modal alone
  // replaced the WRONG-content flash with a BLANK gap -- live measurement
  // showed up to ~2.6s can elapse before the first network request even
  // fires (createInvite's client-side PoW solve, SR2). The existing
  // "Вирішення PoW..." status message lives in #conversation-toolbar,
  // itself hidden until the identity-gated "conversation" route is
  // reachable -- invisible for exactly this window. A dedicated
  // indicator, driven by the SAME synchronous predicate (no new async
  // logic), replaces the blank gap with visible feedback.
  //
  // 2026-08-03 follow-up: #auto-start-loading is now VISIBLE by default
  // in index.html's raw markup (no `hidden` attribute), same principle
  // as #app-header/#app-body being hidden by default below -- covers not
  // just the predicted-auto-start window but also the (rarer, but real
  // on a slow connection/device) gap before this very module has even
  // finished loading/parsing. revealAppChrome() below is the ONLY thing
  // that ever hides it now; nothing here needs to explicitly show it.
  // User request (2026-07-31, DOM-structure follow-up): patching each
  // individual flash symptom (account modal, then the loading gap, then
  // the enterConversationLobby gap) one at a time left new ones
  // discoverable every time. Structural fix instead: #app-header and
  // #app-body (everything real -- sidebar, cards, all [data-screen]
  // content) are `hidden` by DEFAULT in index.html now, same as the
  // screens inside them. revealAppChrome() (defined below, hoisted --
  // called here immediately for the common case, and again later at the
  // exact synchronous point real content is ready) reveals both in one
  // statement, and also cleans up the loading indicator/suppression
  // class, so every "we're done, show the real UI" call site only needs
  // this one function instead of three separate lines repeated at each.
  function revealAppChrome() {
    if (el("app-header")) el("app-header").hidden = false;
    if (el("app-body")) el("app-body").hidden = false;
    doc.body.classList.remove("account-modal-suppressed");
    if (el("auto-start-loading")) el("auto-start-loading").hidden = true;
  }
  if (!willAutoLeaveAccountScreen) {
    revealAppChrome();
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
    // Section GC4 (specs/phase4/group-chats.md): pending relayed
    // mesh-connect attempts this device initiated, keyed by relayId so an
    // eventual mesh-relay-answer can be matched back to the right
    // connectionId/ecdhKeyPair regardless of how many concurrent attempts
    // are in flight.
    pendingMeshRelays: new Map(),
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

  // Section GC4: like getPeerByFingerprint, but scoped to a specific
  // groupId -- used both to check "am I already mesh-connected to this
  // member" and to find the relay target for an outgoing mesh-relay-*
  // message.
  function getGroupPeerByFingerprint(groupId, targetFingerprint) {
    for (const entry of state.peers.values()) {
      if (entry.groupId === groupId && entry.peerFingerprint === targetFingerprint) return entry;
    }
    return undefined;
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
    // Section B6 exec-review finding F2: a pending device-link verification
    // prompt is scoped to the connection it was shown for -- if the human
    // leaves it unconfirmed and a NEW connection replaces the active one
    // (e.g. starting an ordinary chat), the stale "confirm" handler must not
    // silently send the raw identity key over the NEW session instead of
    // the one whose SAS code was actually compared.
    const verificationBlock = el("link-verification-block");
    if (verificationBlock && !verificationBlock.hidden) {
      verificationBlock.hidden = true;
      el("btn-confirm-device-link").onclick = null;
      el("btn-reject-device-link").onclick = null;
    }
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
  // Section RF11: `blink` requests the 5x attention animation -- only
  // passed `true` by the identity-announce handler on an actual first
  // reveal (hidden -> visible for a NEW peer), never on a toggle-driven
  // re-render (local click or the peer's synced choice), so it draws the
  // eye exactly once per new connection, not on every mode switch.
  function renderSafetyHint({ blink = false } = {}) {
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
    if (blink) {
      hintEl.classList.remove("safety-hint-attention");
      void hintEl.offsetWidth; // forces reflow so re-adding the class restarts the animation
      hintEl.classList.add("safety-hint-attention");
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

  // Section RF12 (bug report): #btn-invite-from-chat is an icon-only button
  // in the fixed toolbar -- #invite-status (the existing text feedback)
  // lives on the Room screen only, so clicking the toolbar icon gave no
  // visible confirmation at all. A small tooltip positioned right at
  // whichever button was actually clicked works for both call sites
  // without needing per-button markup.
  function showCopiedTooltip(anchorEl) {
    if (!anchorEl) return;
    let tooltip = el("copied-tooltip");
    if (!tooltip) {
      tooltip = doc.createElement("div");
      tooltip.id = "copied-tooltip";
      tooltip.className = "copied-tooltip";
      doc.body.appendChild(tooltip);
    }
    tooltip.textContent = t("room.inviteCopied");
    const rect = anchorEl.getBoundingClientRect();
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.top = `${rect.bottom + 6}px`;
    tooltip.classList.remove("copied-tooltip-visible");
    void tooltip.offsetWidth; // forces reflow so re-adding the class restarts the fade-in
    tooltip.classList.add("copied-tooltip-visible");
    clearTimeout(tooltip.dataset.hideTimeoutId);
    tooltip.dataset.hideTimeoutId = doc.defaultView.setTimeout(() => {
      tooltip.classList.remove("copied-tooltip-visible");
    }, 1500);
  }

  function copyInviteLink() {
    const roomId = el("room-id").value;
    const inviteToken = el("invite-token").value;
    if (!roomId || !inviteToken) {
      setInviteStatus(t("room.inviteMissing"));
      return false;
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
    return true;
  }
  el("btn-copy-invite").addEventListener("click", (event) => {
    if (copyInviteLink()) showCopiedTooltip(event.currentTarget);
  });

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
  el("btn-invite-from-chat").addEventListener("click", (event) => {
    if (copyInviteLink()) showCopiedTooltip(event.currentTarget);
  });

  // Section H3 (specs/ui/chat-first-redesign.md): "Створити"/"Увійти" quick
  // actions in the header, visible only while no identity exists yet --
  // called at every identity-establishing/clearing point in this file,
  // mirroring the existing resetOwnProofsState() call-site pattern.
  function renderGuestQuickActions() {
    const bar = el("guest-quick-actions");
    if (!bar) return;
    // Section SM3 (specs/ui/simplified-ephemeral-mode.md): the only
    // clickable path to the account/login screen is these two buttons --
    // stay hidden while advanced mode is locked regardless of identity
    // state, checked here (not just once in applyAdvancedModeVisibility)
    // because this function re-runs at every identity-establishing/
    // clearing point, which would otherwise re-show it.
    bar.hidden = !!state.senderKey || !isAdvancedModeUnlocked();
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
        setContactDragFingerprint(contact.fingerprint);
      });
      row.addEventListener("dragend", () => {
        setContactDragFingerprint(null);
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
        } else if (v && v.consecutiveFailures >= getSetting("proofFailureThreshold")) {
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
        setGroupDragId(group.groupId);
      });
      row.addEventListener("dragend", () => {
        setGroupDragId(null);
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
    await initiateChatSession({ pushToContact: contact ?? null, expectedFingerprint: targetFingerprint });
  });

  // Sidebar search (UI redesign follow-up to SD1): plain client-side
  // substring filter over already-rendered #contacts-list rows -- no
  // separate index, no server round-trip. Static per the original
  // sidebar-filters chips design; this input is the one genuinely wired
  // piece of the sidebar's "Пошук" affordance in this pass.
  // Section G1 (specs/reviews/spirit-evaluation-triage.md): second module
  // extracted out of this closure -- see sidebarFoldersUI.js. Contact/group
  // row dragstart/dragend handlers below call setContactDragFingerprint/
  // setGroupDragId instead of assigning a shared local, since the drop
  // target (folder rows) lives in the extracted module now.
  const { applyContactsFilter, setContactDragFingerprint, setGroupDragId } = initSidebarFoldersUI({ doc, el, t });

  const setGroupStatus = (text) => {
    const status = el("group-status");
    if (status) status.textContent = text;
  };

  // Section G1 (specs/reviews/spirit-evaluation-triage.md): third module
  // extracted out of this closure -- see groupsUI.js. startTaggedGroupInvite/
  // openGroupConversation/withBusyButton are all `function` declarations
  // (hoisted) defined later in this file -- safe to reference here since
  // this call just registers listeners, none of which fire before the rest
  // of initApp() has finished running.
  const { renderGroupsCard } = initGroupsUI({
    doc,
    el,
    t,
    state,
    withBusyButton,
    setGroupStatus,
    buildInviteLinkText,
    startTaggedGroupInvite,
    openGroupConversation
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
   * the "proofFailureThreshold" setting's consecutive failures do (docs/identity-verification.md).
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
    hasIdentity: () => !!state.senderKey,
    restrictedRoutes: ADVANCED_ROUTES,
    // Section GE2 (specs/ui/granular-feature-flags.md): the master
    // password unlock is checked first (short-circuits -- locked means
    // EVERY advanced route is restricted regardless of per-feature
    // flags); isFeatureEnabled(route) then layers the per-route toggle on
    // top once unlocked. isFeatureEnabled("server") is hard-coded true in
    // advancedMode.js, so "server" can never be restricted by its own
    // flag (self-lockout guard -- it's where the toggle panel itself lives).
    isRestricted: (route) => !isAdvancedModeUnlocked() || !isFeatureEnabled(route),
    restrictedRedirectRoute: "conversation",
    onRestricted: (route) => {
      showAdvancedModeNotice();
      // User request (2026-08-08): don't just tell the user the section
      // is locked -- open the password entry right here, and remember
      // which route to send them to once they actually unlock it
      // (onVisibilityChange above, wired to initAdvancedModeUI).
      //
      // Exec review finding 2 (specs/reviews/restricted-route-unlock-modal-iter1.md):
      // ONLY when the MASTER lock is the reason -- a route restricted
      // purely by its own per-feature flag (GE2/GE3) while already
      // unlocked must keep the old notice-only behavior. The password
      // modal can never fix a disabled feature flag (the password is
      // already known-correct), and opening it there looped forever:
      // unlock "succeeds" -> re-navigate to the still-flag-disabled route
      // -> restricted again -> modal re-opens.
      if (!isAdvancedModeUnlocked()) {
        pendingRestrictedRoute = route;
        advancedModeUIHandle?.openUnlockModal();
      }
    }
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
  // Section RF21 (specs/ui/design-edit-mode.md, Stage 2): declared here (a
  // `let`, reassigned once the floating-video block below has run) so
  // setConversationChromeVisible can call it regardless of definition
  // order -- same pattern as resetFloatingVideoRect (Section RF20). The
  // floating-video block runs AFTER this function's own initial call
  // further down, so that first call uses this no-op; the block re-invokes
  // it once more after setup finishes, correcting the initial state.
  let applyVideoDockMode = () => {};
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
    applyVideoDockMode();
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
  // Section RF20 (specs/ui/design-edit-mode.md, Stage 2): exposes a reset
  // hook outside the block below, so the "Скинути позицію" button (wired
  // further down, once el("btn-reset-floating-video") is guaranteed to
  // exist) can trigger it. Declared here as a `let` and reassigned inside
  // the block below once the real panel/rect-computation closures exist --
  // this default only runs if el("floating-video") itself is missing (not
  // reachable via index.html today, but kept as a safe fallback).
  let resetFloatingVideoRect = () => {
    try {
      localStorage.removeItem(FLOATING_VIDEO_STORAGE_KEY);
    } catch {
      // Best-effort, same reasoning as saveFloatingVideoRect.
    }
  };
  {
    const panel = el("floating-video");
    const handle = el("floating-video-handle");
    if (panel) {
      const win = doc.defaultView;
      const saved = loadFloatingVideoRect();
      const defaultWidth = getSetting("floatingVideoDefaultWidth");
      const defaultHeight = getSetting("floatingVideoDefaultHeight");
      // Bug report: dragging the handle above the viewport top (or far past
      // any other edge) left it stuck there -- a fixed-position element at
      // top < 0 renders above the visible page entirely, so the handle
      // itself became unreachable to drag it back. Clamps left/top so at
      // least HANDLE_MARGIN px of the panel (including its own drag handle,
      // which is its top strip) always stays on-screen and grabbable,
      // regardless of viewport size or how the panel got positioned.
      const HANDLE_MARGIN = 32;
      const clampRect = (rect) => {
        const maxLeft = Math.max(0, win.innerWidth - HANDLE_MARGIN);
        const maxTop = Math.max(0, win.innerHeight - HANDLE_MARGIN);
        return {
          ...rect,
          left: Math.min(Math.max(rect.left, 0), maxLeft),
          top: Math.min(Math.max(rect.top, 0), maxTop)
        };
      };
      const computeDefaultRect = () =>
        clampRect({
          left: Math.max(16, win.innerWidth - defaultWidth - 16),
          top: Math.max(16, win.innerHeight - defaultHeight - 16),
          width: defaultWidth,
          height: defaultHeight
        });
      const applyRect = (rect) => {
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.width = `${rect.width}px`;
        panel.style.height = `${rect.height}px`;
      };
      applyRect(clampRect(saved || computeDefaultRect()));

      resetFloatingVideoRect = () => {
        try {
          localStorage.removeItem(FLOATING_VIDEO_STORAGE_KEY);
        } catch {
          // Best-effort, same reasoning as saveFloatingVideoRect.
        }
        // Exec review finding 1 (specs/reviews/design-edit-mode-RF20-iter1.md):
        // the reset button lives on the "server" screen (index.html), and
        // the panel is only ever un-hidden on the "conversation" route
        // (setConversationChromeVisible) -- so `panel.hidden` is ALWAYS
        // true at the moment this can be clicked in real usage. Gating the
        // re-apply on `!panel.hidden` made the reset silently do nothing
        // visible until the NEXT page reload (loadFloatingVideoRect() is
        // only ever called once, at initApp() time -- nothing re-reads
        // storage on a later route change). Applying unconditionally means
        // the panel's inline styles are already correct by the time it's
        // later revealed, with no reload needed.
        applyRect(computeDefaultRect());
      };

      const persistCurrentRect = () => {
        // Section RF21: while docked, the panel's box can change size
        // purely from normal page reflow (e.g. a window resize) with no
        // user drag/resize intent at all -- writing THAT to
        // spirit.floatingVideoRect would corrupt the float-mode position
        // with meaningless docked-layout numbers. `isDocked` (declared
        // below, in this same enclosing block) is only ever READ here
        // once this function is actually CALLED (from endDrag/the
        // ResizeObserver, both wired further down) -- by then it's always
        // initialized, ordinary closure lookup, not a hoisting concern.
        if (isDocked) return;
        saveFloatingVideoRect({
          left: parseFloat(panel.style.left) || panel.offsetLeft,
          top: parseFloat(panel.style.top) || panel.offsetTop,
          width: panel.offsetWidth,
          height: panel.offsetHeight
        });
      };

      // Section RF21 (specs/ui/design-edit-mode.md, Stage 2): "docked"
      // means the panel is actually reparented into the conversation
      // card's content flow, not just a CSS position change -- #floating-video
      // is NOT a descendant of the card in the real DOM (client/index.html
      // mounts it right before </body>). Captured once, before any
      // reparenting: `dockTarget`/`dockAnchor` describe WHERE to insert it
      // when docked (in front of #video-status, wherever that element's
      // parent turns out to be -- production wraps it in .card-wide,
      // tests may not, this works either way since it's not hardcoded to
      // a specific class); `floatOriginalParent`/`floatOriginalNextSibling`
      // describe where to put it BACK.
      const dockAnchor = el("video-status");
      const dockTarget = dockAnchor?.parentElement;
      const floatOriginalParent = panel.parentNode;
      const floatOriginalNextSibling = panel.nextSibling;
      let isDocked = false;
      // Exec review finding 1 (specs/reviews/design-edit-mode-RF21-iter1.md):
      // applyRect() (above) always sets inline left/top/width/height on the
      // panel -- an inline style always wins over the docked CSS rule's
      // width:100%/aspect-ratio, so the docked box silently kept whatever
      // pixel size the float mode last had instead of the intended
      // responsive box. Captured/cleared on dock, restored byte-for-byte
      // on undock (not recomputed -- the user's exact float position/size
      // must survive a dock/undock round-trip unchanged).
      let savedInlineRect = null;
      applyVideoDockMode = () => {
        // Docking only makes sense while the panel is part of the visible
        // layout (an active call on the conversation route) -- reparenting
        // it while hidden would be invisible anyway, and the NEXT time
        // setConversationChromeVisible(true) runs (entering the route),
        // this function runs again and docks it correctly then.
        const wantDocked = getDesignSetting("videoMode") === "docked" && !panel.hidden;
        if (wantDocked === isDocked) return; // no-op: avoids needless DOM churn (losing focus/restarting <video> playback) on every unrelated call.
        isDocked = wantDocked;
        if (wantDocked && dockTarget && dockAnchor) {
          savedInlineRect = { left: panel.style.left, top: panel.style.top, width: panel.style.width, height: panel.style.height };
          panel.style.removeProperty("left");
          panel.style.removeProperty("top");
          panel.style.removeProperty("width");
          panel.style.removeProperty("height");
          dockTarget.insertBefore(panel, dockAnchor);
        } else {
          floatOriginalParent.insertBefore(panel, floatOriginalNextSibling);
          if (savedInlineRect) {
            panel.style.left = savedInlineRect.left;
            panel.style.top = savedInlineRect.top;
            panel.style.width = savedInlineRect.width;
            panel.style.height = savedInlineRect.height;
            savedInlineRect = null;
          }
        }
      };

      if (handle) {
        let dragOffsetX = 0;
        let dragOffsetY = 0;
        let dragging = false;
        handle.addEventListener("pointerdown", (event) => {
          // Docked mode has no drag/resize affordance (CSS also hides the
          // handle and disables native `resize`) -- this guard is the
          // functional backstop: `dragging` never flips true, so the
          // pointermove/pointerup handlers below (which already guard on
          // `dragging`) naturally no-op too, with no extra guards needed there.
          if (isDocked) return;
          dragging = true;
          const panelRect = panel.getBoundingClientRect();
          dragOffsetX = event.clientX - panelRect.left;
          dragOffsetY = event.clientY - panelRect.top;
          handle.setPointerCapture?.(event.pointerId);
        });
        handle.addEventListener("pointermove", (event) => {
          if (!dragging) return;
          const maxLeft = Math.max(0, win.innerWidth - HANDLE_MARGIN);
          const maxTop = Math.max(0, win.innerHeight - HANDLE_MARGIN);
          const nextLeft = Math.min(Math.max(event.clientX - dragOffsetX, 0), maxLeft);
          const nextTop = Math.min(Math.max(event.clientY - dragOffsetY, 0), maxTop);
          panel.style.left = `${nextLeft}px`;
          panel.style.top = `${nextTop}px`;
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

      // Re-clamps on window resize too -- a panel dragged near an edge on a
      // large window would otherwise end up off-screen (handle included)
      // after the browser window itself shrinks.
      win.addEventListener("resize", () => {
        // Exec review finding 3 (specs/reviews/design-edit-mode-RF21-iter1.md):
        // while docked, panel.offsetLeft/offsetTop are in-FLOW coordinates
        // inside the conversation card -- a completely different coordinate
        // space than the fixed-position float rect. Without this guard, a
        // resize while docked overwrote the panel's inline left/top with
        // meaningless in-flow numbers, which then got PERSISTED to
        // spirit.floatingVideoRect on the next undock (persistCurrentRect's
        // own isDocked guard doesn't help here -- isDocked is already false
        // by the time undock's ResizeObserver callback fires).
        if (isDocked) return;
        const current = { left: panel.offsetLeft, top: panel.offsetTop, width: panel.offsetWidth, height: panel.offsetHeight };
        const clamped = clampRect(current);
        panel.style.left = `${clamped.left}px`;
        panel.style.top = `${clamped.top}px`;
      });
    }
  }
  el("btn-reset-floating-video")?.addEventListener("click", () => resetFloatingVideoRect());
  // Section RF21: setConversationChromeVisible's OWN initial call (near its
  // definition, above) ran before this block existed, so it only ever saw
  // applyVideoDockMode's no-op placeholder -- one corrective call here,
  // now that the real implementation is wired, catches a direct
  // #/conversation load or a returning session that starts already docked.
  applyVideoDockMode();

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
  // User request (2026-08-08): a generic "navigate to the route in this
  // link's href, then scroll a specific card into view" shortcut --
  // "Дизайн" (index.html) is the first user, reusing the "server" route
  // without duplicating a data-route (exec review finding,
  // specs/reviews/design-menu-shortcut-iter1.md: sharing data-route="server"
  // with the real "Сервер" nav item would mark BOTH aria-current="page"
  // simultaneously). Deliberately scoped OUTSIDE the settings-menu guard
  // above (exec review finding) -- the selector is document-wide by
  // design, so a future [data-scroll-target] elsewhere in the app
  // shouldn't silently lose its listener just because it happens to load
  // on a page/fixture without the settings menu.
  for (const scrollLink of doc.querySelectorAll("[data-scroll-target]")) {
    scrollLink.addEventListener("click", (event) => {
      // Same guard as router.js's own nav-item handler -- preserves
      // Ctrl/Cmd/Shift-click "open in new tab/window" for this real anchor.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const route = scrollLink.getAttribute("href")?.replace(/^#\/?/, "");
      if (route) router.navigate(route);
      el(scrollLink.dataset.scrollTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  // Section C8 (specs/reviews/spirit-evaluation-triage.md): STUN preset
  // dropdown -- #stun-url stays the single value currentRtcConfig() reads,
  // this is purely a fill-in convenience. Selecting a known preset fills
  // stun-url; selecting "custom" leaves it untouched. Typing directly into
  // stun-url flips the dropdown to whichever preset matches (or "custom"
  // if none does), so the two controls never visibly disagree.
  const STUN_PRESETS = {
    google: "stun:stun.l.google.com:19302",
    cloudflare: "stun:stun.cloudflare.com:3478",
    mozilla: "stun:stun.services.mozilla.com:3478"
  };
  el("stun-preset")?.addEventListener("change", () => {
    const preset = el("stun-preset").value;
    if (preset !== "custom" && STUN_PRESETS[preset]) {
      el("stun-url").value = STUN_PRESETS[preset];
    }
  });
  el("stun-url")?.addEventListener("input", () => {
    const stunPresetEl = el("stun-preset");
    if (!stunPresetEl) return;
    const match = Object.entries(STUN_PRESETS).find(([, url]) => url === el("stun-url").value);
    stunPresetEl.value = match ? match[0] : "custom";
  });

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
      // Section B3: saved alongside the rest of this preset for convenience
      // (same "manual apply, no auto-reconnect" philosophy as the other
      // fields) -- note this means a TURN password ends up in plaintext
      // localStorage, same trust tier as everything else this feature
      // already persists there (device-local convenience, not a vault).
      turnUrl: el("turn-url").value,
      turnUsername: el("turn-username").value,
      turnCredential: el("turn-credential").value,
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
        el("turn-url").value = node.turnUrl ?? "";
        el("turn-username").value = node.turnUsername ?? "";
        el("turn-credential").value = node.turnCredential ?? "";
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

  // Section G1 (specs/reviews/spirit-evaluation-triage.md): first module
  // extracted out of this closure -- see settingsPanelUI.js. renderSettingsRegistry/
  // renderDesignSettings are re-called from the lang-select handler above
  // (Section C6) after a locale switch, via these returned bindings.
  const { renderSettingsRegistry, renderDesignSettings, renderFooterSettings, renderFeatureFlagsSettings } = initSettingsPanelUI({
    doc,
    el,
    t,
    // Section RF21: videoMode's reparenting effect lives in the
    // floating-video closure above, not reachable from applyDesignSettings()
    // itself. Exec review finding 4 (specs/reviews/design-edit-mode-RF21-iter1.md):
    // in TODAY's layout this hook is unreachable while a call is actually
    // visible (the "server" screen these controls live on and the
    // "conversation" screen are mutually exclusive, so applyVideoDockMode()'s
    // own `!panel.hidden` check is always false at click time) -- the
    // setting genuinely takes effect on the NEXT entry to #/conversation
    // (onScreenChange's own applyVideoDockMode() call already covers that).
    // Kept anyway as forward-compatible plumbing (same shape as
    // advancedModeUI.js's onVisibilityChange) in case a future layout ever
    // lets this control reach the user while already on that route.
    onDesignSettingChange: () => applyVideoDockMode()
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

  // Section B3 (specs/reviews/spirit-evaluation-triage.md): reads the
  // current STUN/TURN/force-relay form fields into a buildRtcConfig call --
  // was previously the same 1-line expression copy-pasted at 8 separate
  // call sites (each only reading stun-url/force-turn-relay), now also
  // reading the new turn-url/turn-username/turn-credential fields.
  function currentRtcConfig() {
    return buildRtcConfig(el("stun-url").value, {
      forceTurnRelay: el("force-turn-relay").checked,
      turnUrl: el("turn-url").value,
      turnUsername: el("turn-username").value,
      turnCredential: el("turn-credential").value
    });
  }

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
    "safety-display-mode",
    "mesh-relay-offer",
    "mesh-relay-answer"
  ]);

  // Section FT2 (specs/phase4/file-transfer.md), architectural decisions:
  // raw-byte chunks (base64'd into JSON control messages, consistent with
  // the existing "everything is JSON text" control pattern), a bufferedAmount
  // backpressure threshold (avoids overflowing the WebRTC SCTP send buffer
  // on large files), and a soft UI size warning (no hard limit -- the whole
  // file is held in RAM for the duration of a transfer, by deliberate
  // zero-database design) -- all three now user-tunable (Section RF13 Stage
  // 2, client/js/settingsRegistry.js: fileChunkSize,
  // bufferedAmountHighThresholdBytes, fileSizeWarningBytes), defaults
  // unchanged from the original hardcoded 16KB/1MB/100MB.
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
    const bufferedAmountHighThreshold = getSetting("bufferedAmountHighThresholdBytes");
    channel.bufferedAmountLowThreshold = bufferedAmountHighThreshold;
    for (let index = transfer.sentCount; index < transfer.totalChunks; index++) {
      // The transfer can vanish mid-flight (peer session reset) -- stop
      // rather than keep pushing chunks nobody will ever assemble.
      if (!state.outgoingFileTransfers[fileId] || state.channel !== channel) return;
      if (channel.bufferedAmount > bufferedAmountHighThreshold) {
        await waitForBufferedAmountLow(channel);
      }
      // Section D0: read this ONE chunk directly off disk via the File
      // object rather than indexing into a whole-file array held in
      // memory since selection time.
      const chunkBytes = await readFileChunk(transfer.file, index, transfer.chunkSize);
      const data = chunkToBase64(chunkBytes);
      channel.send(await encryptMessage(state.sessionKey, JSON.stringify({ type: "file-chunk", fileId, index, data })));
      transfer.sentCount = index + 1;
      renderFileTransferStatus(
        fileId,
        t("fileTransfer.progressSending", { name: transfer.name, sent: transfer.sentCount, total: transfer.totalChunks })
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
      // Section B5 (specs/reviews/spirit-evaluation-triage.md): when the
      // user dialed a SPECIFIC known contact, whoever answers must actually
      // BE that contact -- previously the expected fingerprint was read
      // from the DOM at dial time, used only for push targeting, and then
      // discarded; whatever fingerprint the announce carried was accepted
      // unconditionally and just relabeled "новий контакт" if it differed.
      // A generic "Ініціювати чат"/quick-chat session has no expected
      // fingerprint (null) and is unaffected -- anyone who answers there is
      // legitimately a first meeting.
      const expected = getActivePeer()?.expectedFingerprint;
      if (expected && expected !== verified.fingerprint) {
        setStatus(t("status.peerIdentityMismatch"));
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
      renderSafetyHint({ blink: isFirstMeeting });
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
          const group = await ensureLocalGroupRecord(joinedGroupId);
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

    if (control.type === "mesh-relay-offer" || control.type === "mesh-relay-answer") {
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

  // Section GC4: per-entry identity announcer for background mesh-relay
  // connections -- same shape as makeIdentityAnnouncer, but reads/writes
  // the GIVEN entry directly instead of the active-connection proxy
  // fields, and skips the device-list/proof-set/push-subscription
  // piggyback (deliberate scope cut, documented in the spec -- a mesh-relay
  // connection only needs identity verified to become a usable group-mesh
  // edge).
  function makeEntryIdentityAnnouncer(entry) {
    let announced = false;
    return async () => {
      if (announced || !entry.channel || !entry.sessionKey || !entry.sessionEcdhWires) return;
      announced = true;
      try {
        const announce = await createIdentityAnnounce(
          state.identityKeyPair.privateKey,
          state.identityKeyPair.publicKey,
          entry.sessionEcdhWires.localEcdhWire,
          entry.sessionEcdhWires.peerEcdhWire,
          state.nickname ?? ""
        );
        entry.channel.send(await encryptMessage(entry.sessionKey, JSON.stringify(announce)));
      } catch {
        // Background handshake -- nothing upstream can surface a failure to.
      }
    };
  }

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

  function wireChannelCallbacks(disarmIceTimeout, { onDecryptedMessage = handleChatMessage, afterChannelOpen } = {}) {
    // Section GC0 exec-review iter2 finding: snapshot which connection this
    // set of callbacks belongs to at wiring time. onChannelOpen can fire
    // asynchronously (ICE/DTLS completion) after logout has already torn
    // down the session -- without this guard, state.channel = channel would
    // resurrect a phantom state.peers entry the same way the ratchet
    // writeback could (see serializedChainStep above).
    const ownerConnectionIdAtWireTime = state.activeConnectionId;

    // Shared teardown for both a clean DataChannel close and a
    // connectionState reaching disconnected/failed/closed (Section B4) --
    // same stale-write guard as onChannelOpen above, so a callback that
    // fires after this session was already superseded/logged out of
    // doesn't resurrect or clobber a different, later connection.
    function handleConnectionTornDown(statusKey) {
      if (ownerConnectionIdAtWireTime !== null && state.activeConnectionId !== ownerConnectionIdAtWireTime) return;
      setStatus(t(statusKey));
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
    }

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
        handleConnectionTornDown("status.closed");
      },
      // Section B4 (specs/reviews/spirit-evaluation-triage.md): the client
      // previously had ZERO listeners for connectionState/iceConnectionState
      // anywhere -- a peer that vanished without a clean DataChannel close
      // (network drop, tab closed, NAT rebind) left the UI showing
      // "peer verified" and an enabled Send button indefinitely, per the
      // evaluation's own live three-minute observation. connectionState
      // reaching any of these three values means the connection is gone
      // regardless of whether the channel itself ever fires onclose.
      onConnectionStateChange: (connectionState) => {
        if (connectionState === "disconnected" || connectionState === "failed" || connectionState === "closed") {
          handleConnectionTornDown("status.peerConnectionLost");
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
  if (doc.defaultView.__spiritProofRecheckInterval) {
    doc.defaultView.clearInterval(doc.defaultView.__spiritProofRecheckInterval);
  }
  doc.defaultView.__spiritProofRecheckInterval = doc.defaultView.setInterval(() => {
    checkContactProofs().catch(() => {});
  }, getSetting("proofRecheckIntervalMs"));

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

  // Section C1 (specs/reviews/spirit-evaluation-triage.md): the Google GSI
  // script used to load unconditionally on every page visit, regardless of
  // whether the user ever touches Google verification -- a third-party
  // request Google sees on every single load. Lazily injected here, on the
  // FIRST click of "Підтвердити через Google" only, and cached (module-scope
  // promise, not per-call) so a second click doesn't inject a second
  // <script> tag or re-fetch.
  let googleGsiLoadPromise = null;
  function ensureGoogleGsiLoaded() {
    if (doc.defaultView.google?.accounts?.id) return Promise.resolve();
    if (googleGsiLoadPromise) return googleGsiLoadPromise;
    googleGsiLoadPromise = new Promise((resolve, reject) => {
      const script = doc.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        googleGsiLoadPromise = null; // allow retry on the next click
        reject(new Error("Failed to load the Google Sign-In script"));
      };
      doc.head.appendChild(script);
    });
    return googleGsiLoadPromise;
  }

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
      await ensureGoogleGsiLoaded();
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
    // User follow-up (2026-07-31): this is the exact synchronous moment
    // real conversation content becomes visible (router.navigate below) --
    // hiding the auto-start suppression/loading here, rather than only in
    // the F4/H5 IIFEs' own `finally` blocks (which run after whatever
    // ELSE those async functions still do post-navigate, e.g. local media
    // preview setup), closes a second, smaller blank gap the user could
    // still catch between "conversation is technically visible" and "the
    // loading overlay is actually gone". A no-op for the manual "Ініціювати
    // чат" call site, which never suppressed anything in the first place.
    revealAppChrome();
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
    if (oneToOneLog) {
      oneToOneLog.hidden = false;
      // Section C2 (specs/reviews/spirit-evaluation-triage.md): this fires
      // on every genuinely NEW 1:1 session start (initiator or joiner), never
      // on a mid-session reconnect of the SAME connection (that reopens the
      // channel directly, without going through here) -- so clearing here
      // can't lose an in-progress conversation, only stale text left behind
      // by whichever session was open before this one. A KNOWN contact's
      // prior history is re-populated afterward, once identity-announce
      // verifies them, by the existing history-replay code below.
      oneToOneLog.innerHTML = "";
    }
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
  async function initiateChatSession({ pushToContact = null, expectedFingerprint = null } = {}) {
    const serverUrl = el("server-url").value;
    const rtcConfig = currentRtcConfig();
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

    // Section A3 (specs/reviews/spirit-evaluation-triage.md): without this,
    // starting a second session while the first is still active reused the
    // SAME state.peers entry (ensureActivePeer's proxy-write semantics) --
    // only peerFingerprint/sessionEcdhWires got cleared below, so
    // state.channel/state.sessionKey still resolved to the PREVIOUS peer
    // until the new handshake completed. A message typed in that window
    // encrypted under the old sessionKey and sent down the old channel --
    // to the previous conversation partner, while the UI already showed the
    // new one. Deleting the old entry outright (mirrors startTaggedGroupInvite's
    // GC2 pattern of never reusing an entry for a genuinely new session)
    // means the proxy fields below lazily create a truly fresh entry.
    resetActiveConnection();
    state.peerFingerprint = null;
    hideSafetyNumberHint();
    state.sessionEcdhWires = null;
    // Section B5 (specs/reviews/spirit-evaluation-triage.md): when the user
    // clicked a SPECIFIC known contact's "message" button (as opposed to a
    // generic "Ініціювати чат"/quick-chat with no particular target),
    // record who they actually meant to dial -- checked against whoever's
    // identity-announce actually arrives, below.
    ensureActivePeer().expectedFingerprint = expectedFingerprint;
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

    const rtcConfig = currentRtcConfig();
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
    // Section A3: same fix as initiateChatSession above -- never reuse a
    // still-active previous connection's entry for a new session.
    resetActiveConnection();
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
      rtcConfig: currentRtcConfig(),
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

  // Section G1 (specs/reviews/spirit-evaluation-triage.md): fourth module
  // extracted out of this closure -- see deviceLinkingUI.js. `state` is
  // passed by reference (not destructured), since this module both reads
  // AND writes state.identityKeyPair/state.senderKey.
  initDeviceLinkingUI({
    doc,
    el,
    t,
    state,
    withBusyButton,
    currentRtcConfig,
    randomSenderKey,
    startInitiatorSession,
    startJoinerSession,
    setDynamicText,
    resetOwnProofsState,
    renderGuestQuickActions,
    renderNotificationsCard,
    renderRecoveryCard,
    router
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

  // Section G1 (specs/reviews/spirit-evaluation-triage.md): fifth and last
  // module extracted out of this closure -- see fileTransferUI.js.
  // renderFileTransferStatus/sendFileChunks stay in app.js (shared with
  // handleChatMessage's receiving-side branches).
  initFileTransferUI({ doc, el, t, state, renderFileTransferStatus });
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

        // Section A3: defensive consistency with initiateChatSession/btn-join
        // -- unreachable in practice here (guarded above by `if
        // (state.senderKey) return`, so no prior connection can exist yet
        // on this fresh zero-click load), but keeps this call site from
        // silently diverging if that guard ever changes.
        resetActiveConnection();
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
        rtcConfig: currentRtcConfig(),
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
        revealAppChrome();
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
        revealAppChrome();
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
