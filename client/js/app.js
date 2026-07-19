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
import { saveTrustedShare, listTrustedShares, getTrustedShare } from "./trustedShares.js";
import { recoverFromShares } from "./socialRecovery.js";
import { acceptNewerProofSet, addProofToSet, revokeProofFromSet } from "./proofSet.js";
import { createProofBlock, parseProofBlock, verifyProofBlock } from "./proofs.js";
import { fetchProofPageText } from "./fetchProof.js";
import { generateAnonymousNickname } from "./anonymousNickname.js";

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

const ROUTES = ["account", "profile", "server", "room", "conversation", "contacts", "history"];
const GATED_ROUTES = ["profile", "conversation", "contacts", "history"];

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
    pc: null,
    channel: null,
    sessionKey: null,
    // Set by the session helpers just before the session key is derived;
    // needed to bind/verify identity announces to THIS session's ECDH keys.
    sessionEcdhWires: null,
    // Ratchet chains (Section P2b) -- only chat text uses these; every other
    // message type (announces, calls, device-linking) stays on sessionKey.
    sendChainKey: null,
    receiveChainKey: null,
    // Fingerprint of the peer's VERIFIED identity (null until a valid
    // announce arrives; incoming chat text is refused while null).
    peerFingerprint: null,
    // The verified peer identity key -- device-list announces are checked
    // against it (Section 13).
    peerIdentityPublicKey: null,
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
    // Whether THIS session's own invite (room-id/invite-token) is still
    // this user's to share -- true for the initiator (btn-initiate/
    // btn-quick-chat), false for the joiner, who never owns the invite.
    isInviteOwner: false,
    // Own display name (Section 16), loaded from profile.js's unencrypted
    // nickname record on create/unlock; null in ephemeral quick-chat mode.
    nickname: null
  };

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

  // Once identity is established, an invite-link visitor should land where
  // they can immediately join (room), not the usual profile-admin screen.
  const postIdentityRoute = () => (cameFromInviteLink ? "room" : "profile");

  const setInviteStatus = (text) => {
    el("invite-status").textContent = text;
  };

  function copyInviteLink() {
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
    textEl.textContent = encodeShareAsText(share);
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
    const textExportParts = [];
    for (let i = 0; i < selected.length; i++) {
      const contactFingerprint = selected[i];
      const share = shares[i];
      textExportParts.push(`${formatSpiritId(contactFingerprint)}: ${encodeShareAsText(share)}`);
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
      exportEl.textContent = textExportParts.join("\n");
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
    for (const contact of contacts) {
      const row = doc.createElement("div");
      row.className = "list-row";
      row.dataset.contactFingerprint = contact.fingerprint;
      row.textContent = formatSpiritId(contact.fingerprint);
      // Фаза 4 (docs/roadmap.md, TOFU-прогалина зафіксована 2026-07-18):
      // identity-announce вже автентифікує ECDH-сесію (Секція 12), але сам
      // identity-ключ при ПЕРШІЙ зустрічі приймається без позаканального
      // доказу (TOFU). Наявні proof-механізми (2c/2d) досі опційні й
      // непомітні -- контакт без жодного proof тепер явно позначається
      // "не підтверджено" в списку, а не мовчки виглядає так само, як
      // контакт із перевіреним proof.
      if (!contact.proofSet?.proofs?.length) {
        const unverifiedBadge = doc.createElement("span");
        unverifiedBadge.className = "unverified-badge";
        unverifiedBadge.textContent = ` ${t("contacts.unverified")}`;
        row.appendChild(unverifiedBadge);
      }
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
        row.appendChild(badge);
      }
      const messageButton = doc.createElement("button");
      messageButton.type = "button";
      messageButton.dataset.i18n = "contacts.message";
      messageButton.textContent = t("contacts.message");
      row.appendChild(messageButton);
      list.appendChild(row);
    }
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
    if (route === "contacts") await renderContactsScreen();
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

  // Section H2 (specs/ui/chat-first-redesign.md): the old always-visible top
  // nav collapsed into a "⚙️ Налаштування" dropdown, in the same spirit as
  // Telegram's settings menu -- opens on toggle click, closes on selecting an
  // item, closes on an outside click, toggles closed on a second press of
  // the button itself.
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
    state.channel = null;
    state.pc = null;
    state.sessionKey = null;
    state.localStream = null;
    state.peerFingerprint = null;
    hideSafetyNumberHint();
    state.peerIdentityPublicKey = null;
    state.sessionEcdhWires = null;
    // exec review finding: without these, a fresh post-logout session could
    // inherit stale flags from the ended one -- e.g. acquireLocalStream()'s
    // one-time addLocalMediaTracks guard staying "already added" and silently
    // skipping media on the NEW peer connection.
    state.isInviteOwner = false;
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
    if (route === "profile") renderOwnProofsList();
    if (route === "conversation") renderEphemeralBanner();
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
    "webrtc-call-answer"
  ]);

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
      const hintEl = el("safety-number-hint");
      if (hintEl) {
        if (isFirstMeeting) {
          setDynamicText(hintEl, t("safety.hint", { fp: formatSpiritId(verified.fingerprint) }));
          hintEl.hidden = false;
        } else {
          hintEl.hidden = true;
        }
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
      },
      onChannelClose: () => {
        setStatus(t("status.closed"));
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
    const step = state[lockField].then(async () => {
      const { messageKey, nextChainKeyBytes } = await ratchetStep(state[chainField]);
      state[chainField] = nextChainKeyBytes;
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
          const rootKey = await deriveRootKey(ecdhKeyPair.privateKey, peerEcdhPubkey);
          ({ sendChainKey: state.sendChainKey, receiveChainKey: state.receiveChainKey } =
            await deriveInitialChainKeys(rootKey, ecdhPubkey, peerEcdhPubkeyWire));
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
          const rootKey = await deriveRootKey(ecdhKeyPair.privateKey, peerEcdhPubkey);
          ({ sendChainKey: state.sendChainKey, receiveChainKey: state.receiveChainKey } =
            await deriveInitialChainKeys(rootKey, ecdhPubkey, peerEcdhPubkeyWire));
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

  async function sendChatMessage() {
    if (!state.channel || !state.sessionKey) {
      setStatus(t("status.noActiveConnection"));
      return;
    }
    const text = el("message-input").value;
    const messageKey = await nextSendMessageKey();
    const payload = RATCHET_WIRE_PREFIX + (await encryptMessage(messageKey, text));
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
  }

  el("btn-send").addEventListener("click", sendChatMessage);
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
}
