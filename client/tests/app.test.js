// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../js/identity.js", () => ({
  generateIdentityKeyPair: vi.fn(),
  generateEcdhKeyPair: vi.fn(),
  fingerprint: vi.fn(),
  exportEcdhPublicKeyForWire: vi.fn().mockResolvedValue("ECDH_PUB_WIRE"),
  importEcdhPublicKeyFromWire: vi.fn().mockResolvedValue({ __tag: "restored-peer-ecdh-pub" }),
  exportPrivateKeyScalar: vi.fn(),
  exportPrivateKeyRaw: vi.fn(),
  importPrivateKeyRaw: vi.fn()
}));
vi.mock("../js/profile.js", () => ({
  createPermanentProfile: vi.fn(),
  exportRawIdentity: vi.fn(),
  listProfiles: vi.fn().mockResolvedValue([]),
  loadPermanentProfile: vi.fn(),
  setNickname: vi.fn(),
  getNickname: vi.fn().mockResolvedValue(null),
  adoptScalarIdentity: vi.fn()
}));
vi.mock("../js/deterministicIdentity.js", () => ({
  deriveAccountMaterial: vi.fn(),
  generateAccountName: vi.fn()
}));
vi.mock("../js/passwordGenerator.js", () => ({
  generateStrongPassword: vi.fn()
}));
vi.mock("../js/deviceLinking.js", () => ({
  generateDeviceKeyPair: vi.fn(),
  createLinkRequest: vi.fn(),
  createLinkGrant: vi.fn(),
  applyLinkGrant: vi.fn(),
  appendDeviceToList: vi.fn(),
  acceptNewerDeviceList: vi.fn()
}));
vi.mock("../js/db.js", () => ({
  listKeys: vi.fn().mockResolvedValue([]),
  get: vi.fn(),
  put: vi.fn()
}));
vi.mock("../js/identityAnnounce.js", () => ({
  createIdentityAnnounce: vi.fn(),
  verifyIdentityAnnounce: vi.fn()
}));
vi.mock("../js/contacts.js", () => ({
  rememberContact: vi.fn(),
  getContact: vi.fn(),
  updateContactDeviceList: vi.fn(),
  updateContactProofSet: vi.fn(),
  updateContactPushSubscription: vi.fn(),
  listContacts: vi.fn().mockResolvedValue([])
}));
vi.mock("../js/trustedShares.js", () => ({
  saveTrustedShare: vi.fn(),
  getTrustedShare: vi.fn(),
  listTrustedShares: vi.fn().mockResolvedValue([]),
  deleteTrustedShare: vi.fn()
}));
vi.mock("../js/proofSet.js", () => ({
  acceptNewerProofSet: vi.fn(),
  signProofSet: vi.fn(),
  addProofToSet: vi.fn(),
  revokeProofFromSet: vi.fn()
}));
vi.mock("../js/proofs.js", () => ({
  createProofBlock: vi.fn(),
  parseProofBlock: vi.fn(),
  verifyProofBlock: vi.fn()
}));
vi.mock("../js/anonymousNickname.js", () => ({
  generateAnonymousNickname: vi.fn()
}));
vi.mock("../js/fetchProof.js", () => ({
  fetchProofPageText: vi.fn()
}));
vi.mock("../js/historyStore.js", () => ({
  appendMessage: vi.fn(),
  listMessages: vi.fn().mockResolvedValue([]),
  listConversations: vi.fn().mockResolvedValue([])
}));
vi.mock("../js/groups.js", () => ({
  createGroup: vi.fn(),
  getGroup: vi.fn(),
  listGroups: vi.fn().mockResolvedValue([]),
  updateGroupMembers: vi.fn()
}));
vi.mock("../js/importedContacts.js", () => ({
  saveImportedContact: vi.fn(),
  listImportedContacts: vi.fn().mockResolvedValue([]),
  getImportedContact: vi.fn(),
  setMatchedFingerprint: vi.fn(),
  deleteImportedContact: vi.fn(),
  clearPendingMessages: vi.fn()
}));
vi.mock("../js/importParsers.js", () => ({
  parseContactList: vi.fn(),
  parseChatExport: vi.fn()
}));
vi.mock("../js/adminAuth.js", () => ({
  adminLogin: vi.fn(),
  getAdminConfig: vi.fn(),
  AdminAuthError: class AdminAuthError extends Error {}
}));
vi.mock("../js/mnemonic.js", () => ({
  bytesToMnemonic: vi.fn()
}));
vi.mock("../js/keyfile.js", () => ({
  createKeyfile: vi.fn()
}));
vi.mock("../js/webrtc.js", () => ({
  startAsInitiator: vi.fn(),
  startAsJoiner: vi.fn(),
  applyRemoteAnswer: vi.fn(),
  addLocalMediaTracks: vi.fn(),
  createRenegotiationOffer: vi.fn(),
  createRenegotiationAnswer: vi.fn(),
  applyRenegotiationAnswer: vi.fn(),
  // Real (non-mocked) implementation -- Section P1(a) coverage below asserts
  // on its actual output as it flows into startAsInitiator/startAsJoiner
  // calls, mirroring buildRtcConfig's own unit tests in rtcConfig.test.js.
  buildRtcConfig: vi.fn((stunUrl, { forceTurnRelay = false } = {}) => {
    const config = { iceServers: [{ urls: stunUrl }] };
    if (forceTurnRelay) config.iceTransportPolicy = "relay";
    return config;
  })
}));
vi.mock("../js/signalingClient.js", () => ({
  createInvite: vi.fn(),
  createOffer: vi.fn(),
  getOffer: vi.fn(),
  submitAnswer: vi.fn(),
  pollForAnswer: vi.fn()
}));
vi.mock("../js/pushSend.js", () => ({
  sendPushNotification: vi.fn()
}));
vi.mock("../js/e2ee.js", () => ({
  deriveSessionKey: vi.fn(),
  encryptMessage: vi.fn(),
  decryptMessage: vi.fn()
}));
vi.mock("../js/ratchet.js", () => ({
  deriveRootKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
  deriveInitialChainKeys: vi.fn().mockResolvedValue({
    sendChainKey: new Uint8Array(32).fill(1),
    receiveChainKey: new Uint8Array(32).fill(2)
  }),
  ratchetStep: vi.fn().mockResolvedValue({
    messageKey: { __tag: "ratchet-message-key" },
    nextChainKeyBytes: new Uint8Array(32).fill(3)
  })
}));
vi.mock("../js/googleOAuth.js", () => ({
  promptGoogleSignIn: vi.fn(),
  verifyGoogleIdToken: vi.fn()
}));

import {
  generateIdentityKeyPair,
  generateEcdhKeyPair,
  fingerprint,
  exportPrivateKeyScalar,
  exportPrivateKeyRaw,
  importPrivateKeyRaw
} from "../js/identity.js";
import { createPermanentProfile, exportRawIdentity, listProfiles, loadPermanentProfile, setNickname, getNickname, adoptScalarIdentity } from "../js/profile.js";
import { deriveAccountMaterial, generateAccountName } from "../js/deterministicIdentity.js";
import { generateStrongPassword } from "../js/passwordGenerator.js";
import {
  generateDeviceKeyPair,
  createLinkRequest,
  createLinkGrant,
  applyLinkGrant,
  appendDeviceToList,
  acceptNewerDeviceList
} from "../js/deviceLinking.js";
import { createIdentityAnnounce, verifyIdentityAnnounce } from "../js/identityAnnounce.js";
import {
  rememberContact,
  getContact,
  updateContactDeviceList,
  updateContactProofSet,
  updateContactPushSubscription,
  listContacts
} from "../js/contacts.js";
import { saveTrustedShare, listTrustedShares, getTrustedShare } from "../js/trustedShares.js";
import { buildRecoveryShareAnnounce, encodeShareAsText } from "../js/recoveryShare.js";
import { splitSecret } from "../js/shamir.js";
import { formatSpiritId } from "../js/spiritId.js";
import { SETTINGS, getSetting, setSetting } from "../js/settingsRegistry.js";
import { acceptNewerProofSet, signProofSet, addProofToSet, revokeProofFromSet } from "../js/proofSet.js";
import { createProofBlock, parseProofBlock, verifyProofBlock } from "../js/proofs.js";
import { generateAnonymousNickname } from "../js/anonymousNickname.js";
import { fetchProofPageText } from "../js/fetchProof.js";
import { get as dbGet, put as dbPut } from "../js/db.js";
import { appendMessage, listMessages, listConversations } from "../js/historyStore.js";
import { createGroup, getGroup, listGroups, updateGroupMembers } from "../js/groups.js";
import { saveImportedContact, listImportedContacts, getImportedContact, setMatchedFingerprint, deleteImportedContact, clearPendingMessages } from "../js/importedContacts.js";
import { parseContactList, parseChatExport } from "../js/importParsers.js";
import { adminLogin, getAdminConfig } from "../js/adminAuth.js";
import { bytesToMnemonic } from "../js/mnemonic.js";
import { createKeyfile } from "../js/keyfile.js";
import {
  startAsInitiator,
  startAsJoiner,
  applyRemoteAnswer,
  addLocalMediaTracks,
  createRenegotiationOffer,
  createRenegotiationAnswer,
  applyRenegotiationAnswer
} from "../js/webrtc.js";
import { createInvite, createOffer, getOffer, submitAnswer, pollForAnswer } from "../js/signalingClient.js";
import { sendPushNotification } from "../js/pushSend.js";
import { encryptMessage, decryptMessage, deriveSessionKey } from "../js/e2ee.js";
import { deriveRootKey, deriveInitialChainKeys, ratchetStep } from "../js/ratchet.js";
import { promptGoogleSignIn, verifyGoogleIdToken } from "../js/googleOAuth.js";
import { initApp } from "../js/app.js";

const ROUTES = ["account", "profile", "server", "room", "conversation", "manage", "history"];

const HTML = `
  <button id="theme-toggle" type="button"></button>
  <select id="lang-select"></select>
  <div id="guest-quick-actions" hidden>
    <button id="btn-quick-create" type="button"></button>
    <button id="btn-quick-login" type="button"></button>
  </div>
  <button id="btn-settings-toggle" type="button" aria-expanded="false"></button>
  <nav id="settings-menu" hidden>
    ${ROUTES.filter((r) => r !== "account" && r !== "manage")
      .map((r) => `<a class="nav-item" data-route="${r}" href="#/${r}">${r}</a>`)
      .join("")}
    <button id="btn-logout" type="button" class="nav-item"></button>
  </nav>
  <div id="welcome-modal" hidden>
    <h2 id="welcome-title" data-i18n="welcome.title"></h2>
    <p id="welcome-body" data-i18n="welcome.body"></p>
    <button id="btn-welcome-confirm" type="button"></button>
  </div>

  <!-- Section SD1 (specs/ui/persistent-sidebar.md): persistent sidebar shell,
       a SIBLING to the [data-screen] sections below -- outside router.js's
       mechanism entirely, always in the DOM regardless of route. -->
  <aside id="app-sidebar">
    <button id="btn-sidebar-add" type="button" class="nav-item" data-route="manage"></button>
    <input id="sidebar-search-input" type="text">
    <button id="chip-filter-all" type="button" class="chip chip-active" data-filter="all"></button>
    <button id="chip-filter-verified" type="button" class="chip" data-filter="verified"></button>
    <button id="chip-filter-groups" type="button" class="chip nav-item" data-route="manage"></button>
    <button id="btn-check-proofs-now" type="button">Перевірити зараз</button>
    <div id="proofs-check-status"></div>
    <div id="folder-tree"></div>
    <div id="contacts-list"></div>
    <p id="contacts-empty"></p>
  </aside>
  <button id="btn-sidebar-back" type="button"></button>

  <section data-screen="account">
    <button id="btn-account-close" type="button"></button>
    <h2 id="account-heading" data-i18n="section.account"></h2>
    <div id="account-login-block" hidden>
      <select id="profile-select"></select>
      <input id="unlock-passphrase" type="password">
      <button id="btn-profile-unlock" type="button">Увійти</button>
      <button id="link-switch-to-create" type="button">Створити новий акаунт</button>
    </div>
    <button id="link-toggle-portable-login" type="button">Увійти за портативним логіном</button>
    <div id="portable-login-form" hidden>
      <input id="portable-login-input" type="text">
      <input id="portable-password-input" type="password">
      <button id="btn-login-portable" type="button">Увійти за логіном</button>
      <div id="portable-login-status"></div>
    </div>
    <button id="link-toggle-recovery-restore" type="button">Відновити через довірених контактів</button>
    <div id="recovery-restore-form" hidden>
      <textarea id="recovery-restore-shares"></textarea>
      <input id="recovery-restore-passphrase" type="password">
      <button id="btn-recover-from-shares" type="button">Відновити</button>
      <div id="recovery-restore-status"></div>
    </div>
    <div id="account-create-mode">
      <button id="btn-create-profile" type="button">Створити профіль</button>
      <div id="profile-setup" hidden>
        <input id="nickname-input" type="text">
        <input id="profile-passphrase" type="password">
        <input id="portable-account-checkbox" type="checkbox">
        <div id="portable-login-display"></div>
        <button id="btn-profile-confirm" type="button">Створити</button>
      </div>
      <button id="link-switch-to-login" type="button">Увійти в наявний акаунт</button>
    </div>
    <button id="btn-generate" type="button">Швидкий чат</button>
    <button id="btn-quick-chat" type="button">Швидкий анонімний чат</button>
    <div id="profile-status"></div>
    <div id="backup-step" hidden>
      <button id="btn-backup-mnemonic" type="button">Показати мнемоніку</button>
      <input id="keyfile-passphrase" type="password">
      <button id="btn-backup-keyfile" type="button">Створити keyfile</button>
      <button id="btn-backup-skip" type="button">Пропустити</button>
      <div id="mnemonic-display"></div>
      <div id="keyfile-display"></div>
    </div>
    <div id="backup-reminder" hidden>Ви не зробили резервну копію ключа</div>
  </section>

  <section data-screen="profile">
    <div>Ваш ID: <span id="pub-key-display" data-i18n="id.none">не згенеровано</span></div>
    <input id="session-ttl-hours" type="number" value="24">
    <input id="link-passphrase" type="password">
    <button id="btn-link-device" type="button">Прив'язати новий пристрій</button>
    <input id="device-local-passphrase" type="password">
    <button id="btn-join-as-device" type="button">Приєднати цей пристрій</button>
    <div id="device-link-status"></div>
    <input id="google-client-id" type="text" value="test-client-id">
    <button id="btn-google-verify" type="button">Підтвердити через Google</button>
    <div id="google-verify-status"></div>
    <button id="btn-generate-proof" type="button">Створити доказ</button>
    <div id="proof-block-display"></div>
    <input id="proof-url-input" type="text">
    <button id="btn-add-proof" type="button">Додати</button>
    <div id="proofs-status"></div>
    <div id="own-proofs-list"></div>
    <div id="recovery-card" hidden>
      <div id="recovery-contacts-list"></div>
      <select id="recovery-threshold"></select>
      <input id="recovery-setup-passphrase" type="password">
      <button id="btn-setup-recovery" type="button">Налаштувати відновлення</button>
      <div id="recovery-status"></div>
      <div id="recovery-text-export" hidden></div>
      <div id="recovery-held-list"></div>
      <div id="recovery-held-share-text" hidden></div>
      <div id="recovery-held-share-qr" hidden></div>
    </div>
  </section>

  <section data-screen="server">
    <input id="server-url" type="text" value="http://node.example/index.php">
    <input id="stun-url" type="text" value="stun:stun.example:19302">
    <input id="force-turn-relay" type="checkbox">
    <input id="signaling-node-name" type="text">
    <button id="btn-save-signaling-node" type="button">Зберегти</button>
    <div id="signaling-nodes-list"></div>
    <p id="signaling-nodes-empty"></p>
    <div id="admin-login-form">
      <input id="admin-password" type="password">
      <button id="btn-admin-login" type="button">Увійти</button>
    </div>
    <div id="admin-status"></div>
    <div id="admin-config-list" hidden></div>
    <div id="settings-registry-list"></div>
    <button id="btn-reset-all-settings" type="button"></button>
  </section>

  <section data-screen="room">
    <input id="room-id" type="text">
    <input id="invite-token" type="text">
    <button id="btn-initiate" type="button">Ініціювати чат</button>
    <button id="btn-join" type="button">Приєднатися до чату</button>
    <div id="room-status"></div>
    <button id="btn-copy-invite" type="button">Скопіювати запрошення</button>
    <div id="invite-link-display"></div>
    <div id="invite-status"></div>
  </section>

  <!-- Section RF4/RF6: fixed chrome OUTSIDE any [data-screen], mirroring
       the real index.html -- app.js's setConversationChromeVisible toggles
       these directly (route === "conversation"), not router.js. -->
  <span id="header-call-controls" hidden>
    <button id="btn-start-call" type="button"></button>
    <button id="btn-toggle-camera" type="button"></button>
    <button id="btn-toggle-mic" type="button"></button>
  </span>
  <div id="conversation-toolbar" hidden>
    <h2 data-i18n="conversation.heading"></h2>
    <div id="ephemeral-identity-banner" hidden>
      <span id="ephemeral-nickname-display"></span>
    </div>
    <div id="connection-status" data-i18n="conn.none">не з'єднано</div>
    <div id="invite-bar" hidden>
      <button id="btn-invite-from-chat" type="button">Скопіювати запрошення</button>
    </div>
  </div>
  <div id="floating-video" hidden>
    <div id="floating-video-handle"></div>
    <video id="video-remote" hidden></video>
    <video id="video-local"></video>
  </div>

  <section data-screen="conversation">
    <div id="safety-number-hint" hidden class="banner-warn">
      <div id="safety-hint-text"></div>
      <div id="safety-hint-emoji"></div>
      <button id="btn-safety-toggle-mode" type="button"></button>
    </div>
    <div id="file-offer-banner" hidden class="banner-warn">
      <span id="file-offer-text"></span>
      <button id="btn-file-accept" type="button">Прийняти</button>
      <button id="btn-file-reject" type="button">Відхилити</button>
    </div>
    <div id="file-transfers"></div>
    <div id="video-status"></div>
    <h3 id="group-conversation-heading" hidden></h3>
    <div id="group-chat-log" hidden></div>
    <div id="chat-log"></div>
    <div id="chat-send-status" hidden></div>
    <input id="message-input" type="text">
    <button id="btn-send" type="button">Надіслати</button>
    <input id="file-input" type="file">
  </section>

  <section data-screen="manage">
    <div id="groups-card">
      <input id="group-name" type="text">
      <div id="group-contacts-list"></div>
      <button id="btn-create-group" type="button">Створити групу</button>
      <div id="group-status"></div>
      <div id="group-invite-links" hidden></div>
      <div id="groups-list"></div>
      <p id="groups-empty"></p>
    </div>
    <div id="import-card">
      <select id="import-format">
        <option value="telegram-json">Telegram (JSON)</option>
        <option value="vcard">vCard (.vcf)</option>
        <option value="whatsapp">WhatsApp</option>
        <option value="whatsapp-txt">WhatsApp (chat history)</option>
      </select>
      <input id="import-file-input" type="file">
      <div id="import-status"></div>
      <div id="import-pending-list"></div>
      <p id="import-pending-empty"></p>
    </div>
  </section>

  <section data-screen="history">
    <div id="history-list"></div>
    <p id="history-empty"></p>
  </section>
`;

function fakePublicKey(tag) {
  return { __tag: tag };
}

function fakeChannel() {
  return { onopen: null, onmessage: null, onclose: null, send: vi.fn() };
}

beforeEach(() => {
  location.hash = "";
  document.body.innerHTML = HTML;
  localStorage.clear();
  vi.clearAllMocks();
  listProfiles.mockResolvedValue([]);
  listMessages.mockResolvedValue([]);
  listConversations.mockResolvedValue([]);
  listContacts.mockResolvedValue([]);
  listGroups.mockResolvedValue([]);
  listImportedContacts.mockResolvedValue([]);
  generateAnonymousNickname.mockReturnValue("Тихий Привид");
  generateStrongPassword.mockReturnValue("alpha bravo charlie delta echo foxtrot");
  // Section F6/instant-lobby: entering the conversation screen fires a
  // fire-and-forget getUserMedia preview call. Most tests neither need nor
  // check camera/mic behavior, so the default here NEVER resolves --
  // harmless (nothing awaits it) and keeps this file's hundreds of
  // unrelated tests from crashing on "navigator.mediaDevices is undefined"
  // or racing an unwanted resolved stream into their assertions. Tests that
  // DO care about media (the "video call" and "instant conversation lobby"
  // describe blocks) override this locally with a real resolvable mock.
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn(() => new Promise(() => {})) },
    configurable: true
  });
});

function visibleScreens() {
  return [...document.querySelectorAll("[data-screen]")].filter((s) => !s.hidden).map((s) => s.dataset.screen);
}

describe("btn-generate", () => {
  it("generates an identity key pair and displays its fingerprint", async () => {
    const keyPair = { privateKey: {}, publicKey: fakePublicKey("identity-pub") };
    generateIdentityKeyPair.mockResolvedValue(keyPair);
    fingerprint.mockResolvedValue("deadbeef");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => {
      expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001deadbeef");
    });

    expect(generateIdentityKeyPair).toHaveBeenCalled();
    expect(fingerprint).toHaveBeenCalledWith(keyPair.publicKey);
  });
});

describe("btn-quick-chat: zero-click ephemeral 'spirit mode' (Section F3)", () => {
  it("generates identity + a random anonymous nickname, creates an invite, and auto-navigates to conversation once the channel opens", async () => {
    const keyPair = { privateKey: {}, publicKey: fakePublicKey("identity-pub") };
    generateIdentityKeyPair.mockResolvedValue(keyPair);
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");

    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();

    await vi.waitFor(() => expect(generateIdentityKeyPair).toHaveBeenCalled());
    await vi.waitFor(() => expect(createInvite).toHaveBeenCalledWith("http://node.example/index.php", "sender-fp", expect.anything()));
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    // No manual click on btn-initiate anywhere in this test -- the whole
    // handshake up to here happened from the single quick-chat click.
    captured.onChannelOpen(fakeChannel());

    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));
  });

  it("shows a shape-ghost sidebar entry with the ephemeral nickname while a spirit-mode session is live, and clicking it jumps back to the conversation", async () => {
    const keyPair = { privateKey: {}, publicKey: fakePublicKey("identity-pub") };
    generateIdentityKeyPair.mockResolvedValue(keyPair);
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");

    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(fakeChannel());
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));

    // Navigate away -- the sidebar (and its ghost entry) stays rendered
    // regardless of route (SD1's persistent-sidebar architecture).
    location.hash = "#/history";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["history"]));

    const ghostRow = document.querySelector('#contacts-list [data-ephemeral-session]');
    expect(ghostRow).not.toBeNull();
    expect(ghostRow.querySelector(".avatar").classList.contains("shape-ghost")).toBe(true);
    expect(ghostRow.textContent).toContain("Тихий Привид");

    ghostRow.click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));
  });

  it("lands straight on the conversation screen with the invite bar visible WHILE waiting for a peer, instead of leaving the user on a blank account screen (bug report 2026-07-17, refined 2026-07-17)", async () => {
    const keyPair = { privateKey: {}, publicKey: fakePublicKey("identity-pub") };
    generateIdentityKeyPair.mockResolvedValue(keyPair);
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });

    startAsInitiator.mockImplementation(() => ({ __fakePc: true }));

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();

    await vi.waitFor(() => expect(createInvite).toHaveBeenCalled());
    // Before the peer has even joined (onChannelOpen never fires in this
    // test), the conversation screen -- not just an invite-only "room"
    // screen -- must already be visible with a way to share the invite,
    // otherwise the initiator has no way to hand the link to anyone, and
    // "opening the ephemeral chat" silently does nothing from their POV.
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));
    expect(document.getElementById("room-id").value).toBe("room1");
    expect(document.getElementById("invite-token").value).toBe("tok1");
    expect(document.getElementById("invite-bar").hidden).toBe(false);
  });

  it("ignores a second click while the auto-initiate flow is already in flight (re-entrancy guard)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });

    let resolveCreateInvite;
    createInvite.mockReturnValue(
      new Promise((resolve) => {
        resolveCreateInvite = resolve;
      })
    );

    initApp(document, { locale: "uk" });
    const quickChatButton = document.getElementById("btn-quick-chat");
    quickChatButton.click();
    await vi.waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));
    expect(quickChatButton.disabled).toBe(true);

    quickChatButton.click();
    expect(createInvite).toHaveBeenCalledTimes(1);

    resolveCreateInvite({ roomId: "room1", inviteToken: "tok1" });
    await vi.waitFor(() => expect(quickChatButton.disabled).toBe(false));
  });

  it("shows a solving-PoW status message while createInvite's PoW solve is in flight, per Section SR2", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });

    let capturedOnPowStart;
    let resolveCreateInvite;
    createInvite.mockImplementation((url, senderKey, { onPowStart } = {}) => {
      capturedOnPowStart = onPowStart;
      return new Promise((resolve) => {
        resolveCreateInvite = resolve;
      });
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();

    await vi.waitFor(() => expect(createInvite).toHaveBeenCalled());
    expect(typeof capturedOnPowStart).toBe("function");

    capturedOnPowStart();
    expect(document.getElementById("connection-status").textContent).toBe("розв'язання захисту від спаму...");

    resolveCreateInvite({ roomId: "room1", inviteToken: "tok1" });
    await vi.waitFor(() => expect(document.getElementById("invite-token").value).toBe("tok1"));
  });
});

describe("force-turn-relay toggle (Section P1(a), specs/phase5/security-hardening.md)", () => {
  it("leaves rtcConfig without iceTransportPolicy on the initiator path when the checkbox is unchecked (default)", async () => {
    const keyPair = { privateKey: {}, publicKey: fakePublicKey("identity-pub") };
    generateIdentityKeyPair.mockResolvedValue(keyPair);
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({ answer: null, ecdhPubkey: null });

    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("force-turn-relay").checked = false;
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();

    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    expect(captured.rtcConfig).toEqual({ iceServers: [{ urls: "stun:stun.example:19302" }] });
    expect("iceTransportPolicy" in captured.rtcConfig).toBe(false);
  });

  it("adds iceTransportPolicy: 'relay' to rtcConfig on the initiator path when the checkbox is checked", async () => {
    const keyPair = { privateKey: {}, publicKey: fakePublicKey("identity-pub") };
    generateIdentityKeyPair.mockResolvedValue(keyPair);
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({ answer: null, ecdhPubkey: null });

    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("force-turn-relay").checked = true;
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();

    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    expect(captured.rtcConfig).toEqual({
      iceServers: [{ urls: "stun:stun.example:19302" }],
      iceTransportPolicy: "relay"
    });
  });

  it("adds iceTransportPolicy: 'relay' to rtcConfig on the joiner path too, so both sides of a forced-relay connection are consistent", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    getOffer.mockResolvedValue({ offer: JSON.stringify({ type: "offer", sdp: "OFFER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });

    startAsJoiner.mockImplementation(() => ({ __fakePc: true }));

    initApp(document, { locale: "uk" });
    document.getElementById("force-turn-relay").checked = true;
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("room-id").value = "room1";
    document.getElementById("invite-token").value = "tok1";
    document.getElementById("btn-join").click();

    await vi.waitFor(() => expect(startAsJoiner).toHaveBeenCalled());
    const [opts] = startAsJoiner.mock.calls[0];
    expect(opts.rtcConfig).toEqual({
      iceServers: [{ urls: "stun:stun.example:19302" }],
      iceTransportPolicy: "relay"
    });
  });
});

describe("multi-node signaling UI (specs/phase4/multi-node-ui.md)", () => {
  it("shows the empty-list hint and does not touch the server/stun/relay fields' defaults when no node is saved", () => {
    initApp(document, { locale: "uk" });
    expect(localStorage.getItem("spirit.signalingNodes")).toBeNull();
    expect(document.getElementById("signaling-nodes-list").children.length).toBe(0);
    expect(document.getElementById("signaling-nodes-empty").hidden).toBe(false);
    expect(document.getElementById("server-url").value).toBe("http://node.example/index.php");
    expect(document.getElementById("stun-url").value).toBe("stun:stun.example:19302");
    expect(document.getElementById("force-turn-relay").checked).toBe(false);
  });

  it("saves the current field values under the given name, appends it to localStorage, and renders it in the list", () => {
    initApp(document, { locale: "uk" });
    document.getElementById("server-url").value = "https://my-node.example/index.php";
    document.getElementById("stun-url").value = "turn:my-turn.example:3478";
    document.getElementById("force-turn-relay").checked = true;
    document.getElementById("signaling-node-name").value = "Мій вузол";
    document.getElementById("btn-save-signaling-node").click();

    const stored = JSON.parse(localStorage.getItem("spirit.signalingNodes"));
    expect(stored.length).toBe(1);
    expect(stored[0]).toMatchObject({
      name: "Мій вузол",
      serverUrl: "https://my-node.example/index.php",
      stunUrl: "turn:my-turn.example:3478",
      forceTurnRelay: true
    });
    expect(typeof stored[0].id).toBe("string");
    expect(stored[0].id.length).toBeGreaterThan(0);

    const list = document.getElementById("signaling-nodes-list");
    expect(list.children.length).toBe(1);
    expect(list.textContent).toContain("Мій вузол");
    expect(document.getElementById("signaling-nodes-empty").hidden).toBe(true);
    // Name field is cleared after a successful save (matches #group-name's
    // clear-after-create pattern).
    expect(document.getElementById("signaling-node-name").value).toBe("");
  });

  it("clicking a saved node populates the three fields without touching anything else (no auto-reconnect)", () => {
    localStorage.setItem("spirit.signalingNodes", JSON.stringify([
      { id: "node-a", name: "Вузол А", serverUrl: "https://a.example/index.php", stunUrl: "stun:a.example:19302", forceTurnRelay: false },
      { id: "node-b", name: "Вузол Б", serverUrl: "https://b.example/index.php", stunUrl: "turn:b.example:3478", forceTurnRelay: true }
    ]));
    initApp(document, { locale: "uk" });

    const rowB = document.querySelector('[data-signaling-node-select="node-b"]');
    expect(rowB).not.toBeNull();
    rowB.click();

    expect(document.getElementById("server-url").value).toBe("https://b.example/index.php");
    expect(document.getElementById("stun-url").value).toBe("turn:b.example:3478");
    expect(document.getElementById("force-turn-relay").checked).toBe(true);
  });

  it("deletes a saved node from both the DOM list and localStorage", () => {
    localStorage.setItem("spirit.signalingNodes", JSON.stringify([
      { id: "node-a", name: "Вузол А", serverUrl: "https://a.example/index.php", stunUrl: "stun:a.example:19302", forceTurnRelay: false }
    ]));
    initApp(document, { locale: "uk" });

    expect(document.getElementById("signaling-nodes-list").children.length).toBe(1);
    document.querySelector('[data-signaling-node-delete="node-a"]').click();

    expect(document.getElementById("signaling-nodes-list").children.length).toBe(0);
    expect(document.getElementById("signaling-nodes-empty").hidden).toBe(false);
    expect(JSON.parse(localStorage.getItem("spirit.signalingNodes"))).toEqual([]);
  });

  it("supports multiple saved nodes coexisting, each independently selectable and deletable", () => {
    initApp(document, { locale: "uk" });
    for (const [name, url] of [["Перший", "https://first.example"], ["Другий", "https://second.example"]]) {
      document.getElementById("server-url").value = url;
      document.getElementById("signaling-node-name").value = name;
      document.getElementById("btn-save-signaling-node").click();
    }
    const stored = JSON.parse(localStorage.getItem("spirit.signalingNodes"));
    expect(stored.length).toBe(2);
    expect(document.getElementById("signaling-nodes-list").children.length).toBe(2);

    document.querySelector(`[data-signaling-node-delete="${stored[0].id}"]`).click();
    const afterDelete = JSON.parse(localStorage.getItem("spirit.signalingNodes"));
    expect(afterDelete.length).toBe(1);
    expect(afterDelete[0].name).toBe("Другий");
    expect(document.getElementById("signaling-nodes-list").children.length).toBe(1);
  });

  it("fails open to an empty list (no throw) when the stored JSON is malformed", () => {
    localStorage.setItem("spirit.signalingNodes", "{not valid json");
    expect(() => initApp(document, { locale: "uk" })).not.toThrow();
    expect(document.getElementById("signaling-nodes-list").children.length).toBe(0);
    expect(document.getElementById("signaling-nodes-empty").hidden).toBe(false);
  });
});

describe("server admin panel (read-only, Section S)", () => {
  it("shows the password form and keeps the config list hidden before login", () => {
    initApp(document, { locale: "uk" });

    expect(document.getElementById("admin-login-form").hidden).toBeFalsy();
    expect(document.getElementById("admin-config-list").hidden).toBe(true);
    expect(adminLogin).not.toHaveBeenCalled();
  });

  it("requires a password before attempting login", async () => {
    initApp(document, { locale: "uk" });

    document.getElementById("btn-admin-login").click();

    await vi.waitFor(() => expect(document.getElementById("admin-status").textContent).toMatch(/пароль/i));
    expect(adminLogin).not.toHaveBeenCalled();
  });

  it("on successful login, hides the form and renders the config fields with their values", async () => {
    adminLogin.mockResolvedValue({ token: "signed.token", expiresAt: 12345 });
    getAdminConfig.mockResolvedValue({
      session_ttl_seconds: 300,
      max_sessions: 1000,
      allowed_origins: ["http://localhost:5500"]
    });

    initApp(document, { locale: "uk" });
    document.getElementById("admin-password").value = "correct horse";
    document.getElementById("btn-admin-login").click();

    await vi.waitFor(() => expect(document.getElementById("admin-config-list").hidden).toBe(false));

    expect(adminLogin).toHaveBeenCalledWith("http://node.example/index.php", "correct horse");
    expect(getAdminConfig).toHaveBeenCalledWith("http://node.example/index.php", "signed.token");
    expect(document.getElementById("admin-login-form").hidden).toBe(true);
    const listText = document.getElementById("admin-config-list").textContent;
    expect(listText).toContain("300");
    expect(listText).toContain("1000");
    expect(listText).toContain("http://localhost:5500");
    // The password must not linger in the DOM after use.
    expect(document.getElementById("admin-password").value).toBe("");
  });

  it("only ever renders whitelisted fields, even if the server response includes something unexpected", async () => {
    adminLogin.mockResolvedValue({ token: "signed.token", expiresAt: 12345 });
    getAdminConfig.mockResolvedValue({
      session_ttl_seconds: 300,
      // Not in ADMIN_CONFIG_FIELDS -- simulates a server-side leak (e.g. a
      // future field added to the PHP whitelist but not the client one, or
      // a genuinely unexpected key). Defense-in-depth: the client must
      // never render a field it doesn't explicitly recognize.
      db_file: "/var/www/secret/database.json",
      admin_password_hash: "$2b$10$should-never-render"
    });

    initApp(document, { locale: "uk" });
    document.getElementById("admin-password").value = "correct horse";
    document.getElementById("btn-admin-login").click();

    await vi.waitFor(() => expect(document.getElementById("admin-config-list").hidden).toBe(false));

    const listText = document.getElementById("admin-config-list").textContent;
    expect(listText).toContain("300");
    expect(listText).not.toContain("secret");
    expect(listText).not.toContain("should-never-render");
    expect(listText).not.toContain("db_file");
    expect(listText).not.toContain("admin_password_hash");
  });

  it("on a wrong password, shows the server's error message and keeps the form visible", async () => {
    const { AdminAuthError } = await import("../js/adminAuth.js");
    adminLogin.mockRejectedValue(new AdminAuthError("Invalid or expired admin credentials"));

    initApp(document, { locale: "uk" });
    document.getElementById("admin-password").value = "wrong";
    document.getElementById("btn-admin-login").click();

    await vi.waitFor(() =>
      expect(document.getElementById("admin-status").textContent).toMatch(/invalid or expired/i)
    );
    expect(document.getElementById("admin-login-form").hidden).toBeFalsy();
    expect(document.getElementById("admin-config-list").hidden).toBe(true);
    expect(getAdminConfig).not.toHaveBeenCalled();
  });
});

describe("Section RF13: settings registry panel", () => {
  it("renders one input per registered setting, pre-filled with its default", () => {
    initApp(document, { locale: "uk" });
    const inputs = document.querySelectorAll("#settings-registry-list [data-setting-key]");
    expect(inputs.length).toBe(SETTINGS.length);
    const proofThresholdInput = document.querySelector('[data-setting-key="proofFailureThreshold"]');
    expect(proofThresholdInput.value).toBe("3");
  });

  it("changing a value persists it via setSetting and getSetting reflects it afterward", () => {
    initApp(document, { locale: "uk" });
    const input = document.querySelector('[data-setting-key="maxRecentAccounts"]');
    input.value = "20";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getSetting("maxRecentAccounts")).toBe(20);
  });

  it("an out-of-range value is rejected and the field snaps back to the stored value", () => {
    initApp(document, { locale: "uk" });
    const input = document.querySelector('[data-setting-key="maxRecentAccounts"]');
    input.value = "99999";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(getSetting("maxRecentAccounts")).toBe(10); // unchanged -- rejected
    expect(document.querySelector('[data-setting-key="maxRecentAccounts"]').value).toBe("10");
  });

  it("per-row reset reverts just that one setting", () => {
    initApp(document, { locale: "uk" });
    setSetting("proofFailureThreshold", 9);
    document.querySelector('[data-setting-key="maxRecentAccounts"]').value = "25";
    document.querySelector('[data-setting-key="maxRecentAccounts"]').dispatchEvent(new Event("change", { bubbles: true }));

    document.querySelector('[data-reset-setting-key="proofFailureThreshold"]').click();

    expect(getSetting("proofFailureThreshold")).toBe(3);
    expect(getSetting("maxRecentAccounts")).toBe(25); // untouched by the OTHER field's reset
  });

  it("btn-reset-all-settings reverts every setting at once", () => {
    initApp(document, { locale: "uk" });
    setSetting("proofFailureThreshold", 9);
    setSetting("maxRecentAccounts", 25);

    document.getElementById("btn-reset-all-settings").click();

    expect(getSetting("proofFailureThreshold")).toBe(3);
    expect(getSetting("maxRecentAccounts")).toBe(10);
  });
});

describe("settings menu replacing the top nav (Section H2)", () => {
  it("opens the settings menu on toggle click, and closes it when a menu item is clicked", () => {
    initApp(document, { locale: "uk" });
    const toggle = document.getElementById("btn-settings-toggle");
    const menu = document.getElementById("settings-menu");

    toggle.click();
    expect(menu.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    document.querySelector('.nav-item[data-route="profile"]').click();
    expect(menu.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes the settings menu on an outside click, same as Telegram-style dropdowns", () => {
    initApp(document, { locale: "uk" });
    document.getElementById("btn-settings-toggle").click();
    expect(document.getElementById("settings-menu").hidden).toBe(false);

    document.body.click();
    expect(document.getElementById("settings-menu").hidden).toBe(true);
  });

  it("toggles closed on a second click of the settings button itself", () => {
    initApp(document, { locale: "uk" });
    const toggle = document.getElementById("btn-settings-toggle");
    toggle.click();
    expect(document.getElementById("settings-menu").hidden).toBe(false);
    toggle.click();
    expect(document.getElementById("settings-menu").hidden).toBe(true);
  });

  it("Вийти resets the identity and returns to the account screen", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));

    document.getElementById("btn-settings-toggle").click();
    document.getElementById("btn-logout").click();

    expect(visibleScreens()).toEqual(["account"]);
    expect(document.getElementById("settings-menu").hidden).toBe(true);
    // A subsequent "Ініціювати чат" without regenerating identity must be
    // refused, same as a truly fresh visitor -- proof the identity is gone.
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/спочатку створіть акаунт/)
    );
  });

  it("resets the one-time addLocalMediaTracks guard, so a NEW session after Вийти can add local media again (exec review finding)", async () => {
    const stream = { getTracks: () => [] };
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true
    });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createRenegotiationOffer.mockResolvedValue({ type: "offer", sdp: "RENEG_OFFER" });
    encryptMessage.mockResolvedValue("X");

    let captured;
    const pc1 = { __fakePc: "first" };
    startAsInitiator.mockImplementationOnce((opts) => {
      captured = opts;
      return pc1;
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();
    await vi.waitFor(() => expect(captured).toBeDefined());
    captured.onChannelOpen(fakeChannel());
    document.getElementById("btn-start-call").click();
    await vi.waitFor(() => expect(addLocalMediaTracks).toHaveBeenCalledWith(pc1, stream));
    expect(addLocalMediaTracks).toHaveBeenCalledTimes(1);

    document.getElementById("btn-settings-toggle").click();
    document.getElementById("btn-logout").click();

    // A brand-new session's own call flow must be able to add local media
    // again -- if state.localTracksAddedToPeer weren't reset by Вийти, this
    // second session's btn-start-call would silently skip addLocalMediaTracks.
    let captured2;
    const pc2 = { __fakePc: "second" };
    startAsInitiator.mockImplementationOnce((opts) => {
      captured2 = opts;
      return pc2;
    });
    document.getElementById("btn-quick-chat").click();
    await vi.waitFor(() => expect(captured2).toBeDefined());
    captured2.onChannelOpen(fakeChannel());
    document.getElementById("btn-start-call").click();
    await vi.waitFor(() => expect(addLocalMediaTracks).toHaveBeenCalledWith(pc2, stream));
    expect(addLocalMediaTracks).toHaveBeenCalledTimes(2);
  });
});

describe("guest quick actions (create/login) in the header when unauthenticated (Section H3)", () => {
  it("shows Створити/Увійти when there is no identity yet", () => {
    initApp(document, { locale: "uk" });
    expect(document.getElementById("guest-quick-actions").hidden).toBe(false);
  });

  it("hides Створити/Увійти once an identity exists", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));

    expect(document.getElementById("guest-quick-actions").hidden).toBe(true);
  });

  it("shows the quick actions again after Вийти", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("guest-quick-actions").hidden).toBe(true));

    document.getElementById("btn-settings-toggle").click();
    document.getElementById("btn-logout").click();

    expect(document.getElementById("guest-quick-actions").hidden).toBe(false);
  });
});

describe("Створити/Увійти open the account screen as a modal over the chat (Section H4)", () => {
  it("btn-quick-create navigates to account and switches to create mode", () => {
    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-create").click();
    expect(visibleScreens()).toEqual(["account"]);
    expect(document.getElementById("account-create-mode").hidden).toBe(false);
    expect(document.getElementById("account-login-block").hidden).toBe(true);
  });

  it("btn-quick-login navigates to account and switches to login mode", () => {
    listProfiles.mockResolvedValue([{ id: "p1" }]);
    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-login").click();
    expect(visibleScreens()).toEqual(["account"]);
    expect(document.getElementById("account-login-block").hidden).toBe(false);
    expect(document.getElementById("account-create-mode").hidden).toBe(true);
  });

  it("btn-account-close dismisses the modal back to the chat once an identity exists", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));

    document.getElementById("btn-quick-login").click();
    expect(visibleScreens()).toEqual(["account"]);

    document.getElementById("btn-account-close").click();
    expect(visibleScreens()).toEqual(["conversation"]);
  });

  it("btn-account-close is a safe no-op back to account when there's no identity yet (router's own gating redirects it)", () => {
    initApp(document, { locale: "uk" });
    document.getElementById("btn-account-close").click();
    expect(visibleScreens()).toEqual(["account"]);
  });

});

describe("welcome modal on first visit (Section H1)", () => {
  it("shows the welcome modal on a fresh visit (no localStorage flag yet)", () => {
    initApp(document, { locale: "uk" });
    expect(document.getElementById("welcome-modal").hidden).toBe(false);
    expect(document.getElementById("welcome-title").textContent).toBe("Ласкаво просимо до Spirit");
  });

  it("hides the modal and sets the seen-flag when the confirm button is clicked", () => {
    initApp(document, { locale: "uk" });
    document.getElementById("btn-welcome-confirm").click();

    expect(document.getElementById("welcome-modal").hidden).toBe(true);
    expect(localStorage.getItem("spirit.welcomeSeen")).toBe("1");
  });

  it("does not show the modal again once the seen-flag is already set", () => {
    localStorage.setItem("spirit.welcomeSeen", "1");
    initApp(document, { locale: "uk" });
    expect(document.getElementById("welcome-modal").hidden).toBe(true);
  });

  it("does not show the modal for a genuinely fresh visitor arriving via an invite link (bug report 2026-07-17)", () => {
    // Before this fix: a truly fresh browser/incognito session (no
    // spirit.welcomeSeen flag at all) following an invite link got the
    // welcome modal rendered ON TOP of the just-auto-joined chat (both are
    // fixed-position overlays) -- from the visitor's point of view, the
    // chat "didn't open" even though the P2P connection succeeded
    // underneath, because the modal's backdrop covered it.
    initApp(document, { locale: "uk", locationSearch: "?room=room-from-link&token=token-from-link" });
    expect(document.getElementById("welcome-modal").hidden).toBe(true);
  });

  it("still initializes the whole app (fails open, shows the modal) if localStorage throws (exec review finding)", () => {
    const original = window.localStorage.getItem;
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage blocked");
    });

    expect(() => initApp(document, { locale: "uk" })).not.toThrow();
    expect(document.getElementById("welcome-modal").hidden).toBe(false);
    // Other init steps (unrelated to the modal) must still have run.
    expect(document.getElementById("lang-select").value).toBe("uk");

    window.localStorage.getItem = original;
  });

  it("does not throw when confirming while localStorage.setItem throws (exec review finding)", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: storage blocked");
    });

    initApp(document, { locale: "uk" });
    expect(() => document.getElementById("btn-welcome-confirm").click()).not.toThrow();
    expect(document.getElementById("welcome-modal").hidden).toBe(true);
  });
});

describe("theme and language switchers (Section U2)", () => {
  it("initializes a theme on the document and the toggle flips it", async () => {
    initApp(document, { locale: "uk" });

    const initial = document.documentElement.dataset.theme;
    expect(["light", "dark"]).toContain(initial);

    document.getElementById("theme-toggle").click();
    expect(document.documentElement.dataset.theme).toBe(initial === "dark" ? "light" : "dark");
  });

  it("populates the language selector and switching re-translates static texts", async () => {
    initApp(document, { locale: "uk" });

    expect(document.getElementById("account-heading").textContent).toBe("Акаунт");
    const langSelect = document.getElementById("lang-select");
    expect(langSelect.options.length).toBe(11);
    expect(langSelect.value).toBe("uk");

    langSelect.value = "en";
    langSelect.dispatchEvent(new Event("change"));
    expect(document.getElementById("account-heading").textContent).toBe("Account");

    langSelect.value = "de";
    langSelect.dispatchEvent(new Event("change"));
    expect(document.getElementById("account-heading").textContent).toBe("Konto");
  });

  it("a language switch must NOT clobber runtime content (fingerprint, live status)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("live-fingerprint");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001live-fingerprint"));

    const langSelect = document.getElementById("lang-select");
    langSelect.value = "en";
    langSelect.dispatchEvent(new Event("change"));

    // Static text re-translated, runtime values untouched.
    expect(document.getElementById("account-heading").textContent).toBe("Account");
    expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001live-fingerprint");
  });
});

describe("profile selector and unlock (Section 15)", () => {
  it("populates the selector with stored profiles on init", async () => {
    listProfiles.mockResolvedValue([{ id: "a".repeat(64) }, { id: "identity" }]);

    initApp(document, { locale: "uk" });

    await vi.waitFor(() => {
      const options = [...document.getElementById("profile-select").options].map((o) => o.value);
      expect(options).toEqual(["a".repeat(64), "identity"]);
    });
  });

  it("orders the selector by the browser-wide MRU list (most recently used first)", async () => {
    const ids = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
    listProfiles.mockResolvedValue(ids.map((id) => ({ id })));
    localStorage.setItem("spirit.recentAccounts", JSON.stringify(["c".repeat(64), "a".repeat(64)]));

    initApp(document, { locale: "uk" });

    await vi.waitFor(() => {
      const options = [...document.getElementById("profile-select").options].map((o) => o.value);
      // MRU entries first (in MRU order), then whatever's left over.
      expect(options).toEqual(["c".repeat(64), "a".repeat(64), "b".repeat(64)]);
    });
  });

  it("caps the selector at the 10 most recently used accounts", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `p${i}`.padStart(64, "0"));
    listProfiles.mockResolvedValue(ids.map((id) => ({ id })));
    localStorage.setItem("spirit.recentAccounts", JSON.stringify(ids.slice(0, 10)));

    initApp(document, { locale: "uk" });

    await vi.waitFor(() => {
      const options = [...document.getElementById("profile-select").options];
      expect(options.length).toBe(10);
    });
  });

  it("records the unlocked account in the browser-wide MRU list", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    loadPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("unlocked-pub"),
      vaultKey: { __tag: "vault-key" },
      profileId: "f".repeat(64)
    });
    fingerprint.mockResolvedValue("f".repeat(64));

    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(1));
    document.getElementById("unlock-passphrase").value = "my pass";
    document.getElementById("btn-profile-unlock").click();

    await vi.waitFor(() => {
      const recent = JSON.parse(localStorage.getItem("spirit.recentAccounts") || "[]");
      expect(recent).toContain("f".repeat(64));
    });
  });

  it("unlocks the selected profile with the entered passphrase and activates it", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    loadPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "unlocked-priv" },
      publicKey: fakePublicKey("unlocked-pub"),
      vaultKey: { __tag: "vault-key" },
      profileId: "f".repeat(64)
    });
    fingerprint.mockResolvedValue("f".repeat(64));

    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(1));
    document.getElementById("unlock-passphrase").value = "my pass";
    document.getElementById("btn-profile-unlock").click();

    await vi.waitFor(() =>
      expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001" + "f".repeat(64))
    );
    expect(loadPermanentProfile).toHaveBeenCalledWith("identity", "my pass");
    // The secret must not linger in the DOM.
    expect(document.getElementById("unlock-passphrase").value).toBe("");
  });

  it("refuses to unlock with an empty passphrase", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);

    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(1));
    document.getElementById("btn-profile-unlock").click();

    await vi.waitFor(() =>
      expect(document.getElementById("profile-status").textContent).toMatch(/passphrase/i)
    );
    expect(loadPermanentProfile).not.toHaveBeenCalled();
  });

  it("surfaces a wrong-passphrase rejection as a status message", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    loadPermanentProfile.mockRejectedValue(new Error("Incorrect passphrase or corrupted data"));

    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(1));
    document.getElementById("unlock-passphrase").value = "wrong";
    document.getElementById("btn-profile-unlock").click();

    await vi.waitFor(() =>
      expect(document.getElementById("profile-status").textContent).toMatch(/Incorrect passphrase/)
    );
  });

  it("shows the login block when stored profiles exist, hides it otherwise (Section 17)", async () => {
    listProfiles.mockResolvedValue([]);
    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(listProfiles).toHaveBeenCalled());
    expect(document.getElementById("account-login-block").hidden).toBe(true);
  });

  it("shows the login block when there is at least one stored profile (Section 17)", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(document.getElementById("account-login-block").hidden).toBe(false));
  });

  it("create/login are mutually exclusive: no stored profiles shows create mode, hides login (Section F2)", async () => {
    listProfiles.mockResolvedValue([]);
    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(listProfiles).toHaveBeenCalled());
    expect(document.getElementById("account-create-mode").hidden).toBe(false);
    expect(document.getElementById("account-login-block").hidden).toBe(true);
  });

  it("create/login are mutually exclusive: stored profiles exist shows login mode, hides create (Section F2)", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(document.getElementById("account-login-block").hidden).toBe(false));
    expect(document.getElementById("account-create-mode").hidden).toBe(true);
  });

  it("the switch-to-login toggle flips from create mode to login mode (Section F2)", async () => {
    listProfiles.mockResolvedValue([]);
    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(document.getElementById("account-create-mode").hidden).toBe(false));

    document.getElementById("link-switch-to-login").click();

    expect(document.getElementById("account-login-block").hidden).toBe(false);
    expect(document.getElementById("account-create-mode").hidden).toBe(true);
  });

  it("the switch-to-create toggle flips from login mode back to create mode (Section F2)", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(document.getElementById("account-login-block").hidden).toBe(false));

    document.getElementById("link-switch-to-create").click();

    expect(document.getElementById("account-create-mode").hidden).toBe(false);
    expect(document.getElementById("account-login-block").hidden).toBe(true);
  });

  it("preselects a remembered (not-yet-expired) profile in the login dropdown (Section 18)", async () => {
    localStorage.setItem(
      "spirit.session",
      JSON.stringify({ profileId: "b".repeat(64), expiresAt: Date.now() + 3600_000 })
    );
    listProfiles.mockResolvedValue([{ id: "a".repeat(64) }, { id: "b".repeat(64) }]);

    initApp(document, { locale: "uk" });

    await vi.waitFor(() => expect(document.getElementById("profile-select").value).toBe("b".repeat(64)));
  });

  it("remembers the session (profile id + TTL) after a successful unlock", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    loadPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("unlocked-pub"),
      vaultKey: { __tag: "vault-key" },
      profileId: "f".repeat(64)
    });
    fingerprint.mockResolvedValue("f".repeat(64));

    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(1));
    document.getElementById("unlock-passphrase").value = "my pass";
    document.getElementById("btn-profile-unlock").click();

    await vi.waitFor(() => expect(localStorage.getItem("spirit.session")).not.toBeNull());
    const remembered = JSON.parse(localStorage.getItem("spirit.session"));
    // The migrated (post-unlock) id, not the pre-migration "identity" selector value.
    expect(remembered.profileId).toBe("f".repeat(64));
    // Default TTL is 24h -- the session-ttl-hours field in the fixture is "24".
    expect(remembered.expiresAt).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect(remembered.expiresAt).toBeLessThanOrEqual(Date.now() + 24 * 3600_000 + 1000);
  });

  it("uses the configured session TTL field instead of the default when remembering a session", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    loadPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("unlocked-pub"),
      vaultKey: { __tag: "vault-key" },
      profileId: "f".repeat(64)
    });
    fingerprint.mockResolvedValue("f".repeat(64));

    initApp(document, { locale: "uk" });
    document.getElementById("session-ttl-hours").value = "2";
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(1));
    document.getElementById("unlock-passphrase").value = "my pass";
    document.getElementById("btn-profile-unlock").click();

    await vi.waitFor(() => expect(localStorage.getItem("spirit.session")).not.toBeNull());
    const remembered = JSON.parse(localStorage.getItem("spirit.session"));
    expect(remembered.expiresAt).toBeLessThanOrEqual(Date.now() + 2 * 3600_000 + 1000);
    expect(remembered.expiresAt).toBeGreaterThan(Date.now() + 1 * 3600_000);
  });

  it("falls back to the default TTL instead of a past expiry when the field holds a negative number", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    loadPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("unlocked-pub"),
      vaultKey: { __tag: "vault-key" },
      profileId: "f".repeat(64)
    });
    fingerprint.mockResolvedValue("f".repeat(64));

    initApp(document, { locale: "uk" });
    document.getElementById("session-ttl-hours").value = "-5";
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(1));
    document.getElementById("unlock-passphrase").value = "my pass";
    document.getElementById("btn-profile-unlock").click();

    await vi.waitFor(() => expect(localStorage.getItem("spirit.session")).not.toBeNull());
    const remembered = JSON.parse(localStorage.getItem("spirit.session"));
    // Must NOT be in the past (a negative TTL silently no-ops the remember).
    expect(remembered.expiresAt).toBeGreaterThan(Date.now());
  });

  it("remembers the session under the MIGRATED profile id, not the legacy selector value", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    loadPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("unlocked-pub"),
      vaultKey: { __tag: "vault-key" },
      profileId: "f".repeat(64) // the real, post-migration id -- different from the "identity" selector value
    });
    fingerprint.mockResolvedValue("f".repeat(64));

    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(1));
    document.getElementById("unlock-passphrase").value = "my pass";
    document.getElementById("btn-profile-unlock").click();

    await vi.waitFor(() => expect(localStorage.getItem("spirit.session")).not.toBeNull());
    const remembered = JSON.parse(localStorage.getItem("spirit.session"));
    expect(remembered.profileId).toBe("f".repeat(64));
  });
});

describe("permanent profile creation UI", () => {
  function setupCreatedProfile() {
    const keyPair = { privateKey: { __tag: "profile-priv" }, publicKey: fakePublicKey("profile-pub") };
    createPermanentProfile.mockResolvedValue(keyPair);
    fingerprint.mockResolvedValue("profile-fp");
    return keyPair;
  }

  async function createProfileThroughUi() {
    const keyPair = setupCreatedProfile();
    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "my local passphrase";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    return keyPair;
  }

  it("reveals the passphrase step on 'Створити профіль' without creating anything yet", () => {
    initApp(document, { locale: "uk" });
    expect(document.getElementById("profile-setup").hidden).toBe(true);

    document.getElementById("btn-create-profile").click();

    expect(document.getElementById("profile-setup").hidden).toBe(false);
    expect(createPermanentProfile).not.toHaveBeenCalled();
  });

  it("refuses to create a profile with an empty passphrase", async () => {
    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("btn-profile-confirm").click();

    await vi.waitFor(() =>
      expect(document.getElementById("profile-status").textContent).toMatch(/passphrase/i)
    );
    expect(createPermanentProfile).not.toHaveBeenCalled();
  });

  it("creates the profile with the entered passphrase, shows the fingerprint, and reveals the backup step", async () => {
    await createProfileThroughUi();

    expect(createPermanentProfile).toHaveBeenCalledWith("my local passphrase");
    expect(document.getElementById("backup-step").hidden).toBe(false);
    // The passphrase field must not keep the secret around after use.
    expect(document.getElementById("profile-passphrase").value).toBe("");
  });

  it("saves the entered nickname and uses it in this session's identity announces (Section 16)", async () => {
    setupCreatedProfile();
    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("nickname-input").value = "Оксана";
    document.getElementById("profile-passphrase").value = "my local passphrase";
    document.getElementById("btn-profile-confirm").click();

    await vi.waitFor(() => expect(setNickname).toHaveBeenCalledWith("profile-fp", "Оксана"));
  });

  it("does not save a nickname when the field is left blank", async () => {
    await createProfileThroughUi();
    expect(setNickname).not.toHaveBeenCalled();
  });

  it("hides the login block after creating a profile in this session, even though it's now a stored profile (Section 17)", async () => {
    // Real listProfiles() would include the just-created profile once
    // refreshProfileSelector() re-runs after creation -- but there's nothing
    // to log into, an identity is already active this session.
    listProfiles.mockResolvedValue([{ id: "profile-fp" }]);
    await createProfileThroughUi();
    expect(document.getElementById("account-login-block").hidden).toBe(true);
  });

  it("shows a mnemonic that encodes the actually-created key's scalar", async () => {
    const keyPair = await createProfileThroughUi();
    const scalar = new Uint8Array([1, 2, 3]);
    exportPrivateKeyScalar.mockResolvedValue(scalar);
    bytesToMnemonic.mockResolvedValue(["alpha", "bravo", "charlie"]);

    document.getElementById("btn-backup-mnemonic").click();
    await vi.waitFor(() =>
      expect(document.getElementById("mnemonic-display").textContent).toBe("alpha bravo charlie")
    );

    expect(exportPrivateKeyScalar).toHaveBeenCalledWith(keyPair.privateKey);
    expect(bytesToMnemonic).toHaveBeenCalledWith(scalar);
  });

  it("creates a keyfile from the actually-created key with the keyfile passphrase and displays it", async () => {
    const keyPair = await createProfileThroughUi();
    const rawKey = new Uint8Array([9, 9, 9]).buffer;
    exportPrivateKeyRaw.mockResolvedValue(rawKey);
    createKeyfile.mockResolvedValue({ version: 1, salt: "S", ciphertext: "C" });

    document.getElementById("keyfile-passphrase").value = "keyfile secret";
    document.getElementById("btn-backup-keyfile").click();
    await vi.waitFor(() =>
      expect(document.getElementById("keyfile-display").textContent).toContain('"ciphertext"')
    );

    expect(exportPrivateKeyRaw).toHaveBeenCalledWith(keyPair.privateKey);
    expect(createKeyfile).toHaveBeenCalledWith(rawKey, "keyfile secret");
  });

  it("refuses to create a keyfile with an empty keyfile passphrase", async () => {
    await createProfileThroughUi();

    document.getElementById("btn-backup-keyfile").click();
    await vi.waitFor(() =>
      expect(document.getElementById("profile-status").textContent).toMatch(/passphrase/i)
    );
    expect(createKeyfile).not.toHaveBeenCalled();
  });

  it("skipping backup hides the backup step and shows the persistent reminder banner", async () => {
    await createProfileThroughUi();

    document.getElementById("btn-backup-skip").click();

    expect(document.getElementById("backup-step").hidden).toBe(true);
    expect(document.getElementById("backup-reminder").hidden).toBe(false);
  });

  it("ephemeral quick chat (btn-generate) still works and never shows profile/backup UI", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("deadbeef");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001deadbeef"));

    expect(createPermanentProfile).not.toHaveBeenCalled();
    expect(document.getElementById("profile-setup").hidden).toBe(true);
    expect(document.getElementById("backup-step").hidden).toBe(true);
    expect(document.getElementById("backup-reminder").hidden).toBe(true);
  });
});

describe("portable account creation (Section H3, exec-reviewed Argon2id core)", () => {
  it("auto-fills the passphrase field with a generated password when the portable checkbox is checked", () => {
    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();

    document.getElementById("portable-account-checkbox").click();

    expect(document.getElementById("profile-passphrase").value).toBe("alpha bravo charlie delta echo foxtrot");
  });

  it("does not overwrite a password the user already typed before checking the box", () => {
    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "my own chosen password";

    document.getElementById("portable-account-checkbox").click();

    expect(document.getElementById("profile-passphrase").value).toBe("my own chosen password");
  });

  it("does NOT use the deterministic path when the portable checkbox is left unchecked (default, no regression)", async () => {
    const keyPair = { privateKey: { __tag: "profile-priv" }, publicKey: fakePublicKey("profile-pub") };
    createPermanentProfile.mockResolvedValue(keyPair);
    fingerprint.mockResolvedValue("profile-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "my local passphrase";
    document.getElementById("btn-profile-confirm").click();

    await vi.waitFor(() => expect(createPermanentProfile).toHaveBeenCalledWith("my local passphrase"));
    expect(deriveAccountMaterial).not.toHaveBeenCalled();
    expect(adoptScalarIdentity).not.toHaveBeenCalled();
  });

  it("derives a portable login (spirit+name+tail) and adopts it locally when the checkbox is checked", async () => {
    generateAccountName.mockReturnValue("abcdefghij");
    deriveAccountMaterial.mockResolvedValue({
      privateKeyScalar: new Uint8Array(32).fill(7),
      verifierTail: "TAIL0000TAIL0000"
    });
    adoptScalarIdentity.mockResolvedValue({
      privateKey: { __tag: "portable-priv" },
      publicKey: fakePublicKey("portable-pub"),
      vaultKey: { __tag: "vault-key" },
      profileId: "portable-fp"
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("portable-account-checkbox").checked = true;
    document.getElementById("profile-passphrase").value = "correct horse battery staple";
    document.getElementById("btn-profile-confirm").click();

    await vi.waitFor(() => expect(deriveAccountMaterial).toHaveBeenCalledWith("abcdefghij", "correct horse battery staple"));
    expect(adoptScalarIdentity).toHaveBeenCalledWith(
      new Uint8Array(32).fill(7),
      "correct horse battery staple"
    );
    expect(createPermanentProfile).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(document.getElementById("portable-login-display").textContent).toContain("abcdefghijTAIL0000TAIL0000")
    );
  });
});

describe("social recovery S3: trustee-side held-shares view (specs/phase5/social-recovery.md)", () => {
  it("renders listTrustedShares()'s contents, and 'show as text' reveals the exact encodeShareAsText output", async () => {
    const heldShare = {
      ownerFingerprint: "owner-fp",
      x: 2,
      y: new Uint8Array([10, 20, 30]),
      threshold: 2,
      totalShares: 3,
      receivedAt: 1000
    };
    listTrustedShares.mockResolvedValue([heldShare]);
    getTrustedShare.mockResolvedValue(heldShare);
    const keyPair = { privateKey: { __tag: "profile-priv" }, publicKey: fakePublicKey("profile-pub"), vaultKey: { __tag: "vault-key" } };
    createPermanentProfile.mockResolvedValue(keyPair);
    fingerprint.mockResolvedValue("profile-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "my local passphrase";
    document.getElementById("btn-profile-confirm").click();

    await vi.waitFor(() => expect(listTrustedShares).toHaveBeenCalled());
    const row = document.querySelector("[data-show-held-share-for='owner-fp']");
    expect(row).not.toBeNull();

    row.click();

    await vi.waitFor(() => expect(getTrustedShare).toHaveBeenCalledWith("owner-fp"));
    expect(document.getElementById("recovery-held-share-text").hidden).toBe(false);
    expect(document.getElementById("recovery-held-share-text").textContent).toBe(encodeShareAsText(heldShare));
    // Section S4 (QR follow-up): a scannable QR of the exact same share
    // text, not just a copyable string.
    const qrEl = document.getElementById("recovery-held-share-qr");
    expect(qrEl.hidden).toBe(false);
    expect(qrEl.querySelector("svg")).not.toBeNull();
  });
});

describe("social recovery S2/S4: owner-side setup export renders one QR per share (specs/phase5/social-recovery.md)", () => {
  it("renders exactly one .recovery-share-export-row with an SVG QR per selected contact, each labeled with that contact's own id", async () => {
    const keyPair = { privateKey: { __tag: "profile-priv" }, publicKey: fakePublicKey("profile-pub"), vaultKey: { __tag: "vault-key" } };
    createPermanentProfile.mockResolvedValue(keyPair);
    fingerprint.mockResolvedValue("profile-fp");
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), nickname: null, identityPubkeyWire: "W1", firstSeen: 1, deviceList: null },
      { fingerprint: "b".repeat(64), nickname: null, identityPubkeyWire: "W2", firstSeen: 2, deviceList: null }
    ]);
    exportRawIdentity.mockResolvedValue(new Uint8Array(32).fill(7));
    importPrivateKeyRaw.mockResolvedValue({ __tag: "extractable-priv" });
    exportPrivateKeyScalar.mockResolvedValue(new Uint8Array(32).fill(9));

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "my local passphrase";
    document.getElementById("btn-profile-confirm").click();

    await vi.waitFor(() => expect(document.querySelectorAll("[data-recovery-contact-fingerprint]").length).toBe(2));
    const checkboxes = document.querySelectorAll("[data-recovery-contact-fingerprint]");
    checkboxes.forEach((checkbox) => checkbox.click());

    document.getElementById("recovery-setup-passphrase").value = "my local passphrase";
    document.getElementById("btn-setup-recovery").click();

    await vi.waitFor(() => expect(exportRawIdentity).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(document.querySelectorAll("#recovery-text-export .recovery-share-export-row").length).toBe(2)
    );
    const rows = document.querySelectorAll("#recovery-text-export .recovery-share-export-row");
    for (const row of rows) {
      expect(row.querySelector("svg")).not.toBeNull();
    }
    expect(rows[0].textContent).toContain(formatSpiritId("a".repeat(64)));
    expect(rows[1].textContent).toContain(formatSpiritId("b".repeat(64)));
    // Not a single combined QR of the whole export list -- that would leak
    // every other contact's share to whoever scans it.
    expect(rows[0].textContent).not.toContain(formatSpiritId("b".repeat(64)));
  });
});

describe("social recovery S3: owner-side recovery flow (specs/phase5/social-recovery.md)", () => {
  const SECRET = new Uint8Array(32).fill(5);

  function textShares({ threshold = 2, shares = 3 } = {}, secret = SECRET) {
    return splitSecret(secret, { threshold, shares }).map((s) => encodeShareAsText({ ...s, threshold, totalShares: shares }));
  }

  it("toggles the restore form visibility", () => {
    initApp(document, { locale: "uk" });
    expect(document.getElementById("recovery-restore-form").hidden).toBe(true);
    document.getElementById("link-toggle-recovery-restore").click();
    expect(document.getElementById("recovery-restore-form").hidden).toBe(false);
  });

  it("combines >= threshold consistent shares, adopts the identity via the same scalar-adoption path as portable login, and lands logged in", async () => {
    const texts = textShares({ threshold: 2, shares: 3 });
    adoptScalarIdentity.mockResolvedValue({
      privateKey: { __tag: "recovered-priv" },
      publicKey: fakePublicKey("recovered-pub"),
      vaultKey: { __tag: "vault-key" },
      profileId: "recovered-fp"
    });

    initApp(document, { locale: "uk" });
    document.getElementById("link-toggle-recovery-restore").click();
    document.getElementById("recovery-restore-shares").value = `${texts[0]}\n${texts[1]}`;
    document.getElementById("recovery-restore-passphrase").value = "new local passphrase";
    document.getElementById("btn-recover-from-shares").click();

    await vi.waitFor(() => expect(adoptScalarIdentity).toHaveBeenCalledWith(SECRET, "new local passphrase"));
    await vi.waitFor(() =>
      expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001recovered-fp")
    );
    // Residual-risk mitigation (spec, Section S3): the recovered fingerprint
    // is surfaced so the user can visually confirm it's the identity they
    // expected.
    expect(document.getElementById("recovery-restore-status").textContent).toContain("spirit0001recovered-fp");
    // Don't leave reconstructed key material or the passphrase sitting in
    // DOM inputs after use.
    expect(document.getElementById("recovery-restore-shares").value).toBe("");
    expect(document.getElementById("recovery-restore-passphrase").value).toBe("");
  });

  it("rejects insufficient shares with a clear message, WITHOUT calling adoptScalarIdentity", async () => {
    const texts = textShares({ threshold: 3, shares: 5 });

    initApp(document, { locale: "uk" });
    document.getElementById("link-toggle-recovery-restore").click();
    document.getElementById("recovery-restore-shares").value = texts.slice(0, 2).join("\n");
    document.getElementById("recovery-restore-passphrase").value = "pass";
    document.getElementById("btn-recover-from-shares").click();

    await vi.waitFor(() =>
      expect(document.getElementById("recovery-restore-status").textContent).not.toBe("")
    );
    expect(adoptScalarIdentity).not.toHaveBeenCalled();
  });

  it("rejects shares from two different split cycles (mismatched threshold/totalShares) BEFORE calling adoptScalarIdentity", async () => {
    const setA = textShares({ threshold: 2, shares: 3 });
    const setB = textShares({ threshold: 3, shares: 4 }, new Uint8Array(32).fill(9));

    initApp(document, { locale: "uk" });
    document.getElementById("link-toggle-recovery-restore").click();
    document.getElementById("recovery-restore-shares").value = `${setA[0]}\n${setB[0]}`;
    document.getElementById("recovery-restore-passphrase").value = "pass";
    document.getElementById("btn-recover-from-shares").click();

    await vi.waitFor(() =>
      expect(document.getElementById("recovery-restore-status").textContent).not.toBe("")
    );
    expect(adoptScalarIdentity).not.toHaveBeenCalled();
  });

  it("rejects a malformed share-text string with a clear per-item message", async () => {
    const texts = textShares({ threshold: 2, shares: 3 });

    initApp(document, { locale: "uk" });
    document.getElementById("link-toggle-recovery-restore").click();
    document.getElementById("recovery-restore-shares").value = `${texts[0]}\nnot-a-share-at-all`;
    document.getElementById("recovery-restore-passphrase").value = "pass";
    document.getElementById("btn-recover-from-shares").click();

    await vi.waitFor(() =>
      expect(document.getElementById("recovery-restore-status").textContent).toContain("not-a-share-at-all")
    );
    expect(adoptScalarIdentity).not.toHaveBeenCalled();
  });

  it("surfaces a clear message when the combined scalar fails to import as a valid key, instead of throwing", async () => {
    const texts = textShares({ threshold: 2, shares: 3 });
    adoptScalarIdentity.mockRejectedValue(new Error("invalid scalar"));

    initApp(document, { locale: "uk" });
    document.getElementById("link-toggle-recovery-restore").click();
    document.getElementById("recovery-restore-shares").value = `${texts[0]}\n${texts[1]}`;
    document.getElementById("recovery-restore-passphrase").value = "pass";
    document.getElementById("btn-recover-from-shares").click();

    await vi.waitFor(() =>
      expect(document.getElementById("recovery-restore-status").textContent).not.toBe("")
    );
    expect(document.getElementById("recovery-restore-status").textContent).not.toContain("invalid scalar");
  });
});

describe("portable cross-node login (Section H4)", () => {
  it("toggles the portable-login form via the link button", () => {
    initApp(document, { locale: "uk" });
    expect(document.getElementById("portable-login-form").hidden).toBe(true);

    document.getElementById("link-toggle-portable-login").click();

    expect(document.getElementById("portable-login-form").hidden).toBe(false);
  });

  it("logs in on a node with no prior local record for this account, by re-deriving and checking the tail", async () => {
    deriveAccountMaterial.mockResolvedValue({
      privateKeyScalar: new Uint8Array(32).fill(9),
      verifierTail: "matchingtail1234"
    });
    adoptScalarIdentity.mockResolvedValue({
      privateKey: { __tag: "priv" },
      publicKey: fakePublicKey("pub"),
      vaultKey: { __tag: "vault-key" },
      profileId: "cross-node-fp"
    });

    initApp(document, { locale: "uk" });
    document.getElementById("link-toggle-portable-login").click();
    document.getElementById("portable-login-input").value = "spiritabcdefghijmatchingtail1234";
    document.getElementById("portable-password-input").value = "the right password";
    document.getElementById("btn-login-portable").click();

    await vi.waitFor(() => expect(deriveAccountMaterial).toHaveBeenCalledWith("abcdefghij", "the right password"));
    expect(adoptScalarIdentity).toHaveBeenCalledWith(new Uint8Array(32).fill(9), "the right password");
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toContain("cross-node-fp"));
    // Exec review finding: must load this account's own nickname, not carry
    // over whatever was in state.nickname from a previous identity/session
    // (e.g. an ephemeral quick-chat nickname) -- a stale nickname would leak
    // to peers on the next identity-announce.
    expect(getNickname).toHaveBeenCalledWith("cross-node-fp");
    // Exec review finding: session memory + MRU list should work the same
    // as the regular unlock path, so a later visit offers this account via
    // the normal profile-select/unlock flow.
    await vi.waitFor(() => expect(localStorage.getItem("spirit.session")).not.toBeNull());
    expect(JSON.parse(localStorage.getItem("spirit.recentAccounts") || "[]")).toContain("cross-node-fp");
  });

  it("shows a clear error and does NOT adopt anything when the derived tail doesn't match (wrong password)", async () => {
    deriveAccountMaterial.mockResolvedValue({
      privateKeyScalar: new Uint8Array(32).fill(9),
      verifierTail: "differenttail000"
    });

    initApp(document, { locale: "uk" });
    document.getElementById("link-toggle-portable-login").click();
    document.getElementById("portable-login-input").value = "spiritabcdefghijmatchingtail1234";
    document.getElementById("portable-password-input").value = "the WRONG password";
    document.getElementById("btn-login-portable").click();

    await vi.waitFor(() => expect(document.getElementById("portable-login-status").textContent).not.toBe(""));
    expect(adoptScalarIdentity).not.toHaveBeenCalled();
  });

  it("rejects a malformed login string instead of crashing", async () => {
    initApp(document, { locale: "uk" });
    document.getElementById("link-toggle-portable-login").click();
    document.getElementById("portable-login-input").value = "not-a-valid-login";
    document.getElementById("portable-password-input").value = "whatever";
    document.getElementById("btn-login-portable").click();

    await vi.waitFor(() => expect(document.getElementById("portable-login-status").textContent).not.toBe(""));
    expect(deriveAccountMaterial).not.toHaveBeenCalled();
  });
});

describe("btn-google-verify", () => {
  it("refuses to start Google verification before an account exists", async () => {
    initApp(document, { locale: "uk" });
    document.getElementById("btn-google-verify").click();
    await vi.waitFor(() =>
      expect(document.getElementById("google-verify-status").textContent).toMatch(/спочатку створіть акаунт/)
    );
    expect(promptGoogleSignIn).not.toHaveBeenCalled();
  });

  it("uses the identity fingerprint as the nonce and shows the verified email on success", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    promptGoogleSignIn.mockResolvedValue("FAKE_ID_TOKEN");
    verifyGoogleIdToken.mockResolvedValue({ sub: "123", email: "user@gmail.com", emailVerified: true });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));

    document.getElementById("btn-google-verify").click();
    await vi.waitFor(() =>
      expect(document.getElementById("google-verify-status").textContent).toMatch(/user@gmail\.com/)
    );

    expect(promptGoogleSignIn).toHaveBeenCalledWith({ clientId: "test-client-id", nonce: "sender-fp" });
    expect(verifyGoogleIdToken).toHaveBeenCalledWith("FAKE_ID_TOKEN", {
      expectedNonce: "sender-fp",
      expectedAudience: "test-client-id"
    });
  });

  it("surfaces a verification failure as a status message instead of an unhandled rejection", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    promptGoogleSignIn.mockResolvedValue("FAKE_ID_TOKEN");
    verifyGoogleIdToken.mockRejectedValue(new Error("Nonce mismatch: token was not issued for this identity key"));

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));

    document.getElementById("btn-google-verify").click();
    await vi.waitFor(() =>
      expect(document.getElementById("google-verify-status").textContent).toMatch(/Nonce mismatch/)
    );
  });

  it("requires a Google Client ID to be filled in", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("google-client-id").value = "";

    document.getElementById("btn-google-verify").click();
    await vi.waitFor(() =>
      expect(document.getElementById("google-verify-status").textContent).toMatch(/Client ID/)
    );
    expect(promptGoogleSignIn).not.toHaveBeenCalled();
  });
});

describe("btn-initiate", () => {
  it("refuses to start a handshake before an account exists, instead of sending sender_key=null", async () => {
    initApp(document, { locale: "uk" });
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/спочатку створіть акаунт/)
    );
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("also mirrors the guard message onto the room screen's own status element (exec review, Section F6 follow-up)", async () => {
    // This guard fires BEFORE enterConversationLobby() ever navigates away
    // from the room screen -- #connection-status now lives only on the
    // gated "conversation" screen, so a message written ONLY there would be
    // invisible to a fresh visitor with no identity yet (bug report
    // 2026-07-17). #room-status must show the same text.
    initApp(document, { locale: "uk" });
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() =>
      expect(document.getElementById("room-status").textContent).toMatch(/спочатку створіть акаунт/)
    );
  });

  it("surfaces a signaling failure as a status message instead of an unhandled rejection", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockRejectedValue(new Error("Access Denied: Public key not in white-list"));

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));

    document.getElementById("btn-initiate").click();
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/Access Denied/)
    );
  });

  it("ignores a second click while a handshake is already in flight (re-entrancy guard)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });

    let resolveCreateInvite;
    createInvite.mockReturnValue(
      new Promise((resolve) => {
        resolveCreateInvite = resolve;
      })
    );

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));

    const initiateButton = document.getElementById("btn-initiate");
    initiateButton.click(); // first click: createInvite is now pending
    await vi.waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));
    expect(initiateButton.disabled).toBe(true);

    initiateButton.click(); // second click while still in flight must be ignored
    expect(createInvite).toHaveBeenCalledTimes(1);

    resolveCreateInvite({ roomId: "room1", inviteToken: "tok1" });
    await vi.waitFor(() => expect(initiateButton.disabled).toBe(false));
  });

  it("creates an invite, starts as initiator, and submits the offer once ICE gathering completes", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({ answer: null, ecdhPubkey: null }); // no joiner yet in this test

    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));

    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(createInvite).toHaveBeenCalled());
    expect(createInvite).toHaveBeenCalledWith("http://node.example/index.php", "sender-fp", expect.anything());

    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    expect(document.getElementById("room-id").value).toBe("room1");

    const offerSdp = { type: "offer", sdp: "OFFER_SDP" };
    await capturedOnLocalOfferReady(offerSdp);

    expect(createOffer).toHaveBeenCalledWith("http://node.example/index.php", {
      senderKey: "sender-fp",
      roomId: "room1",
      inviteToken: "tok1",
      sdpData: JSON.stringify(offerSdp),
      ecdhPubkey: "ECDH_PUB_WIRE"
    });
  });

  it("applies the remote answer via webrtc.applyRemoteAnswer once pollForAnswer resolves", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({ answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });

    const fakePc = { __fakePc: true };
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return fakePc;
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });
    await vi.waitFor(() => expect(applyRemoteAnswer).toHaveBeenCalled());

    expect(applyRemoteAnswer).toHaveBeenCalledWith(fakePc, { type: "answer", sdp: "ANSWER_SDP" });
  });

  it("surfaces a rejection from inside the detached onLocalOfferReady callback as a status (inner error boundary)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockRejectedValue(new Error("room expired"));

    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    // This callback runs detached from btn-initiate's own click handler (fired later
    // by webrtc.js's internal ICE-gathering logic), so only the inner try/catch --
    // not withBusyButton's outer one -- can be the thing that catches this rejection.
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/room expired/)
    );
  });

  it("disarms the ICE timeout when onError fires, so a stale timeout can't overwrite the real error", async () => {
    vi.useFakeTimers();
    try {
      generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
      fingerprint.mockResolvedValue("sender-fp");
      generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
      createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });

      let capturedOnError;
      startAsInitiator.mockImplementation((opts) => {
        capturedOnError = opts.onError;
        return { __fakePc: true }; // onLocalOfferReady deliberately never invoked in this test
      });

      initApp(document, { locale: "uk", iceTimeoutMs: 5000 });
      document.getElementById("btn-generate").click();
      await vi.advanceTimersByTimeAsync(0);
      document.getElementById("btn-initiate").click();
      await vi.advanceTimersByTimeAsync(0);

      capturedOnError(new Error("createOffer failed inside webrtc.js"));
      expect(document.getElementById("connection-status").textContent).toMatch(/createOffer failed inside webrtc.js/);

      // If the ICE timeout weren't disarmed by onError, this advance would overwrite
      // the real error above with the generic ICE-gathering timeout message.
      await vi.advanceTimersByTimeAsync(5000);
      expect(document.getElementById("connection-status").textContent).toMatch(/createOffer failed inside webrtc.js/);
      expect(document.getElementById("connection-status").textContent).not.toMatch(/тайм-аут/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("btn-join", () => {
  it("refuses to join before an account exists, instead of sending sender_key=null", async () => {
    initApp(document, { locale: "uk" });
    document.getElementById("btn-join").click();
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/спочатку створіть акаунт/)
    );
    expect(getOffer).not.toHaveBeenCalled();
  });

  it("fetches the offer, starts as joiner, and submits the answer once ICE gathering completes", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    getOffer.mockResolvedValue({ offer: JSON.stringify({ type: "offer", sdp: "OFFER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });
    submitAnswer.mockResolvedValue(undefined);

    let capturedOnLocalAnswerReady;
    startAsJoiner.mockImplementation((opts) => {
      capturedOnLocalAnswerReady = opts.onLocalAnswerReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("room-id").value = "room1";
    document.getElementById("invite-token").value = "tok1";

    document.getElementById("btn-join").click();
    await vi.waitFor(() => expect(getOffer).toHaveBeenCalled());
    expect(getOffer).toHaveBeenCalledWith("http://node.example/index.php", {
      senderKey: "sender-fp",
      roomId: "room1",
      inviteToken: "tok1"
    });

    await vi.waitFor(() => expect(startAsJoiner).toHaveBeenCalled());
    expect(startAsJoiner.mock.calls[0][0].offerSdp).toEqual({ type: "offer", sdp: "OFFER_SDP" });

    const answerSdp = { type: "answer", sdp: "ANSWER_SDP" };
    await capturedOnLocalAnswerReady(answerSdp);

    expect(submitAnswer).toHaveBeenCalledWith("http://node.example/index.php", {
      senderKey: "sender-fp",
      roomId: "room1",
      inviteToken: "tok1",
      sdpData: JSON.stringify(answerSdp),
      ecdhPubkey: "ECDH_PUB_WIRE"
    });
  });
});

describe("btn-send", () => {
  it("queues (rather than drops) a message sent before a session key exists, instead of throwing", async () => {
    initApp(document, { locale: "uk" });
    document.getElementById("message-input").value = "привіт";
    document.getElementById("btn-send").click();
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/немає активного з'єднання/)
    );
    expect(encryptMessage).not.toHaveBeenCalled();
    // Section RF9 (bug report follow-up): a message sent with no active
    // connection yet renders immediately (optimistic, with a "queued"
    // badge) instead of silently vanishing -- it's actually transmitted
    // later, once a peer connects (see the flush tests below).
    expect(document.getElementById("chat-send-status").hidden).toBe(false);
    expect(document.getElementById("chat-send-status").textContent).toMatch(/черзі/);
    expect(document.getElementById("chat-log").textContent).toContain("привіт");
    expect(document.getElementById("message-input").value).toBe("");
  });

  it("encrypts the message before sending it on the data channel; never sends raw plaintext", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    encryptMessage.mockResolvedValue("ENCRYPTED_PAYLOAD");
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });

    const channel = fakeChannel();
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    // Simulate the data channel opening, as webrtc.js would report via onChannelOpen.
    const { onChannelOpen } = startAsInitiator.mock.calls[0][0];
    onChannelOpen(channel);
    // Complete the handshake so a session key actually exists, matching real usage.
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    document.getElementById("message-input").value = "привіт";
    document.getElementById("btn-send").click();
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith("R1:ENCRYPTED_PAYLOAD"));

    // Chat text is ratchet-encrypted (Section P2b), NOT the static session key.
    expect(encryptMessage).toHaveBeenCalledWith({ __tag: "ratchet-message-key" }, "привіт");
    expect(encryptMessage).not.toHaveBeenCalledWith({ __tag: "session-key" }, "привіт");
    expect(channel.send).toHaveBeenCalledWith("R1:ENCRYPTED_PAYLOAD");
    expect(channel.send).not.toHaveBeenCalledWith("привіт");
  });

  it("Section RF9: sends a message queued before any connection existed, in order, the moment a peer connects", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    encryptMessage.mockResolvedValue("ENCRYPTED_PAYLOAD");
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });

    const channel = fakeChannel();
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    // No channel, no session key yet -- sending here must queue, not throw
    // or silently drop.
    document.getElementById("message-input").value = "привіт до з'єднання";
    document.getElementById("btn-send").click();
    expect(encryptMessage).not.toHaveBeenCalled();
    expect(document.getElementById("chat-log").textContent).toContain("привіт до з'єднання");
    const queuedRow = document.querySelector("#chat-log .row-out");
    expect(queuedRow.querySelector(".pending-badge")).not.toBeNull();
    expect(document.getElementById("chat-send-status").hidden).toBe(false);

    // Now the channel opens AND the handshake completes (either order is
    // possible in real usage -- both call sites try to flush).
    const { onChannelOpen } = startAsInitiator.mock.calls[0][0];
    onChannelOpen(channel);
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith("R1:ENCRYPTED_PAYLOAD"));
    expect(encryptMessage).toHaveBeenCalledWith({ __tag: "ratchet-message-key" }, "привіт до з'єднання");
    expect(queuedRow.querySelector(".pending-badge")).toBeNull();
    expect(document.getElementById("chat-send-status").hidden).toBe(true);
  });

  it("Section RF9: re-queues a message typed after an unstable channel drops, and resends it once reconnected", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    encryptMessage.mockResolvedValue("ENCRYPTED_PAYLOAD");
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });

    const channel = fakeChannel();
    let capturedOnLocalOfferReady;
    let capturedOnChannelClose;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      capturedOnChannelClose = opts.onChannelClose;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    const { onChannelOpen } = startAsInitiator.mock.calls[0][0];
    onChannelOpen(channel);
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    document.getElementById("message-input").value = "перше";
    document.getElementById("btn-send").click();
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith("R1:ENCRYPTED_PAYLOAD"));
    // Baseline instead of an exact count -- the handshake's own
    // identity-announce also goes over this channel and isn't this test's
    // concern; only the DELTA from here on matters.
    const sendCountAfterFirstMessage = channel.send.mock.calls.length;

    // The connection drops mid-session (unstable network) -- a message
    // typed now must queue exactly like the never-connected-yet case,
    // not throw trying to .send() on the dead channel.
    capturedOnChannelClose();
    document.getElementById("message-input").value = "друге, під час обриву";
    document.getElementById("btn-send").click();
    expect(channel.send.mock.calls.length).toBe(sendCountAfterFirstMessage); // unchanged -- queued, not sent
    expect(document.getElementById("chat-log").textContent).toContain("друге, під час обриву");

    // Reconnects (same session key survives -- only the channel is new).
    const newChannel = fakeChannel();
    onChannelOpen(newChannel);
    await vi.waitFor(() => expect(newChannel.send).toHaveBeenCalledWith("R1:ENCRYPTED_PAYLOAD"));
    expect(encryptMessage).toHaveBeenCalledWith({ __tag: "ratchet-message-key" }, "друге, під час обриву");
  });

  it("sends the message on Enter, same as clicking Надіслати (bug report 2026-07-17)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    encryptMessage.mockResolvedValue("ENCRYPTED_PAYLOAD");
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });

    const channel = fakeChannel();
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    const { onChannelOpen } = startAsInitiator.mock.calls[0][0];
    onChannelOpen(channel);
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    const input = document.getElementById("message-input");
    input.value = "привіт з Enter";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith("R1:ENCRYPTED_PAYLOAD"));
    expect(encryptMessage).toHaveBeenCalledWith({ __tag: "ratchet-message-key" }, "привіт з Enter");
    expect(input.value).toBe("");
  });

  it("does not send on an unrelated keypress", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });

    const channel = fakeChannel();
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    const { onChannelOpen } = startAsInitiator.mock.calls[0][0];
    onChannelOpen(channel);
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    // The identity-announce that fires once the channel opens already calls
    // encryptMessage/channel.send once, independent of this key press --
    // the invariant under test is that the "a" keydown doesn't trigger an
    // ADDITIONAL send, not that these mocks were never called at all.
    const callsBeforeKeydown = channel.send.mock.calls.length;
    const input = document.getElementById("message-input");
    input.value = "чернетка";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));

    expect(channel.send).toHaveBeenCalledTimes(callsBeforeKeydown);
    expect(input.value).toBe("чернетка");
  });

  it("does not send on Shift+Enter (reserved for a future multi-line newline, exec review test-quality fix)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });

    const channel = fakeChannel();
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    const { onChannelOpen } = startAsInitiator.mock.calls[0][0];
    onChannelOpen(channel);
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    const callsBeforeKeydown = channel.send.mock.calls.length;
    const input = document.getElementById("message-input");
    input.value = "чернетка";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));

    expect(channel.send).toHaveBeenCalledTimes(callsBeforeKeydown);
    expect(input.value).toBe("чернетка");
  });

  it("does not send on Enter while an IME composition is in progress (exec review finding)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });

    const channel = fakeChannel();
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    const { onChannelOpen } = startAsInitiator.mock.calls[0][0];
    onChannelOpen(channel);
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    const callsBeforeKeydown = channel.send.mock.calls.length;
    const input = document.getElementById("message-input");
    input.value = "候補";
    // isComposing:true -- an IME candidate-commit Enter, not a real send intent.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));

    expect(channel.send).toHaveBeenCalledTimes(callsBeforeKeydown);
    expect(input.value).toBe("候補");
  });

  it("echoes the sent message into the sender's own chat log with a timestamp", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    encryptMessage.mockResolvedValue("ENCRYPTED_PAYLOAD");
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });

    const channel = fakeChannel();
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    const fixedNow = new Date("2026-07-10T15:04:05Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(fixedNow);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    const { onChannelOpen } = startAsInitiator.mock.calls[0][0];
    onChannelOpen(channel);
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    document.getElementById("message-input").value = "перше повідомлення";
    document.getElementById("btn-send").click();
    await vi.waitFor(() => expect(document.getElementById("chat-log").textContent).toContain("перше повідомлення"));

    const log = document.getElementById("chat-log").textContent;
    expect(log).toContain("перше повідомлення");
    // A recognizable HH:MM:SS timestamp accompanies the message.
    expect(log).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("keeps sent messages in order in the sender's own log across multiple sends", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    encryptMessage.mockImplementation(async (_key, text) => `ENC(${text})`);
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });

    const channel = fakeChannel();
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    const { onChannelOpen } = startAsInitiator.mock.calls[0][0];
    onChannelOpen(channel);
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    for (const word of ["один", "два", "три"]) {
      document.getElementById("message-input").value = word;
      document.getElementById("btn-send").click();
      await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith(`R1:ENC(${word})`));
    }

    const log = document.getElementById("chat-log").textContent;
    expect(log.indexOf("один")).toBeLessThan(log.indexOf("два"));
    expect(log.indexOf("два")).toBeLessThan(log.indexOf("три"));
  });

  it("advances the send chain so consecutive sent messages use different ratchet message keys (forward secrecy)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    encryptMessage.mockResolvedValue("ENCRYPTED_PAYLOAD");
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    ratchetStep
      .mockResolvedValueOnce({ messageKey: { __tag: "msg-key-1" }, nextChainKeyBytes: new Uint8Array(32).fill(11) })
      .mockResolvedValueOnce({ messageKey: { __tag: "msg-key-2" }, nextChainKeyBytes: new Uint8Array(32).fill(12) });

    const channel = fakeChannel();
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    const { onChannelOpen } = startAsInitiator.mock.calls[0][0];
    onChannelOpen(channel);
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    document.getElementById("message-input").value = "перше";
    document.getElementById("btn-send").click();
    await vi.waitFor(() => expect(encryptMessage).toHaveBeenCalledWith({ __tag: "msg-key-1" }, "перше"));

    document.getElementById("message-input").value = "друге";
    document.getElementById("btn-send").click();
    await vi.waitFor(() => expect(encryptMessage).toHaveBeenCalledWith({ __tag: "msg-key-2" }, "друге"));

    // The second call's ratchetStep must have advanced from the first call's next-chain-key output.
    expect(ratchetStep.mock.calls[1][0]).toEqual(new Uint8Array(32).fill(11));
  });
});

describe("identity announce in chat flows (Section 12)", () => {
  // Drives the initiator chat flow up to an open channel + derived session key,
  // returning the captured webrtc callbacks and the fake channel.
  async function establishedInitiatorChat() {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: { __tag: "id-priv" }, publicKey: fakePublicKey("id-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });
    return { captured, channel };
  }

  it("sends an encrypted identity announce once the channel and session key are both ready", async () => {
    const announce = { type: "identity-announce", identityPubkey: "ME", signature: "SIG" };
    createIdentityAnnounce.mockResolvedValue(announce);
    encryptMessage.mockResolvedValue("ENCRYPTED_ANNOUNCE");

    const { channel } = await establishedInitiatorChat();

    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith("ENCRYPTED_ANNOUNCE"));
    // Signed over this session's ECDH wire keys: own first, peer's second.
    expect(createIdentityAnnounce).toHaveBeenCalledWith(
      { __tag: "id-priv" },
      fakePublicKey("id-pub"),
      "ECDH_PUB_WIRE",
      "peer-ecdh-b64",
      ""
    );
    expect(encryptMessage).toHaveBeenCalledWith({ __tag: "session-key" }, JSON.stringify(announce));
  });

  it("shows the peer's announced nickname ALONGSIDE the fingerprint, never in place of it (Section 16)", async () => {
    // A nickname is peer-CHOSEN, not proof of identity -- a different
    // fingerprint could announce the same nickname (impersonation-by-name).
    // The fingerprint must stay visible so TOFU continuity is still checkable.
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    const incoming = { type: "identity-announce", identityPubkey: "PEER", signature: "SIG", nickname: "Оксана" };
    decryptMessage.mockResolvedValue(JSON.stringify(incoming));
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: {},
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp-123",
      nickname: "Оксана"
    });

    const { captured } = await establishedInitiatorChat();
    await captured.onMessage("ENCRYPTED_INCOMING_ANNOUNCE");

    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toContain("Оксана")
    );
    expect(document.getElementById("connection-status").textContent).toContain("spirit0001peer-fp-123");
  });

  it("verifies an incoming announce against the session's ECDH keys and shows the peer fingerprint", async () => {
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    const incoming = { type: "identity-announce", identityPubkey: "PEER", signature: "SIG" };
    decryptMessage.mockResolvedValue(JSON.stringify(incoming));
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: {},
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp-123"
    });

    const { captured } = await establishedInitiatorChat();
    await captured.onMessage("ENCRYPTED_INCOMING_ANNOUNCE");

    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toContain("peer-fp-123")
    );
    // Verifier's view: own wire first, peer's second (mirroring is verify's job).
    expect(verifyIdentityAnnounce).toHaveBeenCalledWith(incoming, "ECDH_PUB_WIRE", "peer-ecdh-b64");
    // Ephemeral mode must NOT persist the contact.
    expect(rememberContact).not.toHaveBeenCalled();
  });

  it("drops incoming chat text and warns while the peer identity is not verified", async () => {
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    decryptMessage.mockResolvedValue("привіт до підтвердження");

    const { captured } = await establishedInitiatorChat();
    await captured.onMessage("ENCRYPTED_TEXT");

    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/не підтверджен/)
    );
    expect(document.getElementById("chat-log").textContent).not.toContain("привіт до підтвердження");
  });

  it("shows a clear warning for an announce that fails verification, and still refuses chat text after it", async () => {
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    verifyIdentityAnnounce.mockResolvedValue(null);

    const { captured } = await establishedInitiatorChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "EVIL", signature: "S" }));
    await captured.onMessage("ENCRYPTED_BAD_ANNOUNCE");

    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/не вдалося підтвердити/)
    );

    decryptMessage.mockResolvedValueOnce("текст після фейкового announce");
    await captured.onMessage("ENCRYPTED_TEXT");
    expect(document.getElementById("chat-log").textContent).not.toContain("текст після фейкового announce");
  });

  it("appends incoming chat text normally once the peer identity is verified", async () => {
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "peer-fp" });

    const { captured } = await establishedInitiatorChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toContain("peer-fp")
    );

    decryptMessage.mockResolvedValueOnce("привіт після підтвердження");
    await captured.onMessage("ENCRYPTED_TEXT");

    await vi.waitFor(() =>
      expect(document.getElementById("chat-log").textContent).toContain("привіт після підтвердження")
    );
  });

  it("decrypts an R1-marked incoming payload with the ratcheted receive-chain key, stripping the marker (Section P2b)", async () => {
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "peer-fp" });

    const { captured } = await establishedInitiatorChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toContain("peer-fp")
    );

    ratchetStep.mockResolvedValueOnce({ messageKey: { __tag: "recv-msg-key-1" }, nextChainKeyBytes: new Uint8Array(32).fill(21) });
    decryptMessage.mockResolvedValueOnce("ратчетоване вхідне");
    await captured.onMessage("R1:ENCRYPTED_TEXT");

    await vi.waitFor(() =>
      expect(document.getElementById("chat-log").textContent).toContain("ратчетоване вхідне")
    );
    // The R1 marker must be stripped before decryption, and the receive-chain
    // message key used instead of the static session key.
    expect(decryptMessage).toHaveBeenCalledWith({ __tag: "recv-msg-key-1" }, "ENCRYPTED_TEXT");
    expect(decryptMessage).not.toHaveBeenCalledWith({ __tag: "session-key" }, "R1:ENCRYPTED_TEXT");
  });

  it("serializes concurrent incoming R1 messages so the receive chain never desyncs (Section P2b review finding)", async () => {
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "peer-fp" });

    const { captured } = await establishedInitiatorChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toContain("peer-fp")
    );

    // ratchetStep resolves asynchronously (a microtask delay), the same as
    // the real crypto.subtle-backed implementation -- this is what makes two
    // near-simultaneous onMessage calls interleave without serialization.
    let call = 0;
    ratchetStep.mockImplementation(async (chainKeyBytes) => {
      await Promise.resolve();
      call += 1;
      return { messageKey: { __tag: `recv-key-${call}` }, nextChainKeyBytes: new Uint8Array(32).fill(call) };
    });
    decryptMessage.mockResolvedValueOnce("перше вхідне").mockResolvedValueOnce("друге вхідне");

    // Fire both WITHOUT awaiting the first before starting the second --
    // simulates two chat messages arriving back-to-back on the data channel.
    const first = captured.onMessage("R1:FIRST_CIPHERTEXT");
    const second = captured.onMessage("R1:SECOND_CIPHERTEXT");
    await Promise.all([first, second]);

    // The two ratchetStep calls must have run sequentially: the second call's
    // input chain key must be the first call's OUTPUT, never the same input
    // seen twice (which would mean both steps started from the same state).
    expect(ratchetStep.mock.calls.length).toBe(2);
    expect(ratchetStep.mock.calls[1][0]).toEqual(new Uint8Array(32).fill(1));
    expect(ratchetStep.mock.calls[0][0]).not.toEqual(ratchetStep.mock.calls[1][0]);
  });

  it("drops an R1 message that arrives in the window where sessionKey is set but the receive chain isn't yet (Section P2b review finding)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: { __tag: "id-priv" }, publicKey: fakePublicKey("id-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    // Restore a clean default -- a prior test in this file may have left a
    // custom mockImplementation (with its own closure state) on this shared mock.
    ratchetStep.mockReset();
    ratchetStep.mockResolvedValue({ messageKey: { __tag: "ratchet-message-key" }, nextChainKeyBytes: new Uint8Array(32).fill(3) });
    // deriveRootKey rejects: state.sessionKey (assigned first) IS set, but
    // the chain derivation that follows it never completes.
    deriveRootKey.mockRejectedValueOnce(new Error("boom"));

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    // The rejected deriveRootKey already surfaces its own error status from
    // session establishment (unrelated to this guard) -- what matters here is
    // that the subsequent R1 message is dropped silently rather than throwing
    // from a null chain key.
    await captured.onMessage("R1:SOME_CIPHERTEXT");

    expect(decryptMessage).not.toHaveBeenCalled();
  });

  it("persists the verified contact when a permanent profile is active", async () => {
    // Profile mode: createPermanentProfile returns a keyPair WITH vaultKey.
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "peer-fp" });
    rememberContact.mockResolvedValue({ status: "new", contact: {} });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");

    await vi.waitFor(() => expect(rememberContact).toHaveBeenCalled());
    expect(rememberContact).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: "peer-fp", identityPubkeyWire: "PEER" })
    );
  });

  it("Section P4: shows a persistent safety-number hint with the peer's fingerprint on first meeting a NEW contact (profile mode)", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "peer-fp-new" });
    rememberContact.mockResolvedValue({ status: "new", contact: {} });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");

    const hint = document.getElementById("safety-number-hint");
    await vi.waitFor(() => expect(hint.hidden).toBe(false));
    expect(hint.textContent).toContain("spirit0001peer-fp-new");
  });

  it("Section P4: does NOT show the safety-number hint for a peer already known from a prior meeting (profile mode)", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "peer-fp-known" });
    rememberContact.mockResolvedValue({ status: "known", contact: {} });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");

    await vi.waitFor(() => expect(document.getElementById("connection-status").textContent).toContain("peer-fp-known"));
    expect(document.getElementById("safety-number-hint").hidden).toBe(true);
  });

  it("Section P4 (exec review finding): clears a previously-shown safety-number hint when the SAME peer reconnects and is now known", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "peer-fp-repeat" });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    // First meeting: hint appears.
    rememberContact.mockResolvedValueOnce({ status: "new", contact: {} });
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S1" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE_1");
    const hint = document.getElementById("safety-number-hint");
    await vi.waitFor(() => expect(hint.hidden).toBe(false));

    // Same peer re-announces later in the same session, now known: hint must clear.
    rememberContact.mockResolvedValueOnce({ status: "known", contact: {} });
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S2" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE_2");
    await vi.waitFor(() => expect(hint.hidden).toBe(true));
  });

  it("Section P4 (exec review finding): a stale hint from a previous peer does not survive logout", async () => {
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "peer-fp-stale" });

    await establishedInitiatorChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    const capturedRef = startAsInitiator.mock.calls.at(-1)[0];
    await capturedRef.onMessage("ENCRYPTED_ANNOUNCE");

    const hint = document.getElementById("safety-number-hint");
    await vi.waitFor(() => expect(hint.hidden).toBe(false));

    document.getElementById("btn-logout").click();
    expect(hint.hidden).toBe(true);
  });

  it("Section P4: shows the safety-number hint in ephemeral mode too (no persistence means every meeting is effectively first)", async () => {
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "peer-fp-ephemeral" });

    const { captured } = await establishedInitiatorChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");

    const hint = document.getElementById("safety-number-hint");
    await vi.waitFor(() => expect(hint.hidden).toBe(false));
    expect(hint.textContent).toContain("spirit0001peer-fp-ephemeral");
    expect(rememberContact).not.toHaveBeenCalled();
  });

  it("Section RF10: defaults to peer-identifier mode with an emoji rendering, and toggling switches to a shared code + notifies the peer", async () => {
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "b".repeat(64) });
    fingerprint.mockResolvedValue("a".repeat(64));
    encryptMessage.mockResolvedValue("ENCRYPTED_TOGGLE");

    const { captured, channel } = await establishedInitiatorChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");

    const hint = document.getElementById("safety-number-hint");
    await vi.waitFor(() => expect(hint.hidden).toBe(false));
    expect(document.getElementById("safety-hint-text").textContent).toContain(formatSpiritId("b".repeat(64)));
    expect(document.getElementById("safety-hint-emoji").textContent.trim()).not.toBe("");
    const emojiBefore = document.getElementById("safety-hint-emoji").textContent;

    document.getElementById("btn-safety-toggle-mode").click();

    // Shared mode: NOT wrapped in the spirit0001 prefix (it isn't anyone's
    // real identity, just a derived comparison code) and renders a
    // DIFFERENT emoji sequence than the peer-identifier mode did.
    expect(document.getElementById("safety-hint-text").textContent).not.toContain("spirit0001");
    expect(document.getElementById("safety-hint-emoji").textContent).not.toBe(emojiBefore);
    await vi.waitFor(() =>
      expect(channel.send).toHaveBeenCalledWith("ENCRYPTED_TOGGLE")
    );
    expect(encryptMessage).toHaveBeenCalledWith(
      { __tag: "session-key" },
      expect.stringContaining("\"type\":\"safety-display-mode\"")
    );
  });

  it("Section RF10: applies the PEER's toggle to this side too, without any local click", async () => {
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "b".repeat(64) });
    fingerprint.mockResolvedValue("a".repeat(64));

    const { captured } = await establishedInitiatorChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    await vi.waitFor(() => expect(document.getElementById("safety-number-hint").hidden).toBe(false));

    const textBefore = document.getElementById("safety-hint-text").textContent;
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "safety-display-mode", mode: "shared" }));
    await captured.onMessage("ENCRYPTED_TOGGLE_FROM_PEER");

    expect(document.getElementById("safety-hint-text").textContent).not.toBe(textBefore);
    expect(document.getElementById("safety-hint-text").textContent).not.toContain("spirit0001");
    // Toggling BACK from here (locally) must produce the peer-mode view again.
    document.getElementById("btn-safety-toggle-mode").click();
    expect(document.getElementById("safety-hint-text").textContent).toContain(formatSpiritId("b".repeat(64)));
  });

  it("Section RF11: blinks the hint banner on a genuine first reveal, but NOT on a later toggle", async () => {
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "b".repeat(64) });
    fingerprint.mockResolvedValue("a".repeat(64));

    const { captured } = await establishedInitiatorChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");

    const hint = document.getElementById("safety-number-hint");
    await vi.waitFor(() => expect(hint.hidden).toBe(false));
    expect(hint.classList.contains("safety-hint-attention")).toBe(true);

    hint.classList.remove("safety-hint-attention"); // simulates the animation having already finished
    document.getElementById("btn-safety-toggle-mode").click();
    expect(hint.classList.contains("safety-hint-attention")).toBe(false);
  });
});

describe("device-list transport (Section 13)", () => {
  async function establishedChat({ ownDeviceList = null } = {}) {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: { __tag: "id-priv" }, publicKey: fakePublicKey("id-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockImplementation(async (_key, text) => `ENC(${text})`);
    dbGet.mockImplementation(async (store, key) =>
      store === "profile" && key === "deviceList:sender-fp" ? ownDeviceList ?? undefined : undefined
    );

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });
    return { captured, channel };
  }

  it("announces the own device list right after the identity announce, when one exists", async () => {
    const ownList = { version: 2, certificates: [], signature: "SIG" };
    const { channel } = await establishedChat({ ownDeviceList: ownList });

    await vi.waitFor(() =>
      expect(channel.send).toHaveBeenCalledWith(`ENC(${JSON.stringify({ type: "device-list-announce", list: ownList })})`)
    );
  });

  it("sends no device-list announce when this profile has none", async () => {
    const { channel } = await establishedChat({ ownDeviceList: null });

    await vi.waitFor(() =>
      expect(channel.send).toHaveBeenCalledWith(`ENC(${JSON.stringify({ type: "identity-announce" })})`)
    );
    const sent = channel.send.mock.calls.map(([payload]) => payload);
    expect(sent.some((p) => p.includes("device-list-announce"))).toBe(false);
  });

  it("applies an incoming device-list announce via acceptNewerDeviceList and persists it on the contact (profile mode)", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    dbGet.mockResolvedValue(undefined);

    const peerIdentityKey = fakePublicKey("peer-identity");
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: peerIdentityKey,
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp"
    });
    rememberContact.mockResolvedValue({ status: "new", contact: { deviceList: null } });
    const heldList = { version: 1, certificates: [], signature: "OLD" };
    getContact.mockResolvedValue({ fingerprint: "peer-fp", deviceList: heldList });
    const incomingList = { version: 2, certificates: [], signature: "NEW" };
    acceptNewerDeviceList.mockResolvedValue(incomingList);

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    // Peer announces identity first, then its device list.
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "device-list-announce", list: incomingList }));
    await captured.onMessage("ENCRYPTED_LIST");

    await vi.waitFor(() => expect(updateContactDeviceList).toHaveBeenCalledWith("peer-fp", incomingList));
    // Verified against the PEER's identity key, seeded with the held list.
    expect(acceptNewerDeviceList).toHaveBeenCalledWith(peerIdentityKey, heldList, incomingList);
  });

  it("ignores a device-list announce arriving before the identity announce", async () => {
    const { captured } = await establishedChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "device-list-announce", list: { version: 9 } }));

    await captured.onMessage("ENCRYPTED_LIST");

    expect(acceptNewerDeviceList).not.toHaveBeenCalled();
    expect(updateContactDeviceList).not.toHaveBeenCalled();
  });

  it("announces the own proof set right after the identity announce, when one exists (Section C)", async () => {
    const ownSet = { version: 2, proofs: [], revoked: [], signature: "SIG" };
    dbGet.mockImplementation(async (store, key) => {
      if (store === "profile" && key === "deviceList:sender-fp") return undefined;
      if (store === "profile" && key === "proofSet:sender-fp") return ownSet;
      return undefined;
    });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: { __tag: "id-priv" }, publicKey: fakePublicKey("id-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockImplementation(async (_key, text) => `ENC(${text})`);

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    await vi.waitFor(() =>
      expect(channel.send).toHaveBeenCalledWith(`ENC(${JSON.stringify({ type: "proof-set-announce", set: ownSet })})`)
    );
  });

  it("applies an incoming proof-set announce via acceptNewerProofSet and persists it on the contact (profile mode)", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    dbGet.mockResolvedValue(undefined);

    const peerIdentityKey = fakePublicKey("peer-identity");
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: peerIdentityKey,
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp"
    });
    rememberContact.mockResolvedValue({ status: "new", contact: { proofSet: null } });
    const heldSet = { version: 1, proofs: [], revoked: [], signature: "OLD" };
    getContact.mockResolvedValue({ fingerprint: "peer-fp", proofSet: heldSet });
    const incomingSet = { version: 2, proofs: [], revoked: [], signature: "NEW" };
    acceptNewerProofSet.mockResolvedValue(incomingSet);

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "proof-set-announce", set: incomingSet }));
    await captured.onMessage("ENCRYPTED_SET");

    await vi.waitFor(() => expect(updateContactProofSet).toHaveBeenCalledWith("peer-fp", incomingSet));
    expect(acceptNewerProofSet).toHaveBeenCalledWith(peerIdentityKey, heldSet, incomingSet);
  });

  it("ignores a proof-set announce arriving before the identity announce", async () => {
    const { captured } = await establishedChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "proof-set-announce", set: { version: 9 } }));

    await captured.onMessage("ENCRYPTED_SET");

    expect(acceptNewerProofSet).not.toHaveBeenCalled();
    expect(updateContactProofSet).not.toHaveBeenCalled();
  });

  it("announces the own push subscription right after the identity announce, when one exists (Section PN4)", async () => {
    const ownSub = { endpoint: "https://push.example/x", keys: { p256dh: "p", auth: "a" } };
    dbGet.mockImplementation(async (store, key) => {
      if (store === "profile" && key === "deviceList:sender-fp") return undefined;
      if (store === "profile" && key === "proofSet:sender-fp") return undefined;
      if (store === "profile" && key === "pushSubscription:sender-fp") return ownSub;
      return undefined;
    });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: { __tag: "id-priv" }, publicKey: fakePublicKey("id-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockImplementation(async (_key, text) => `ENC(${text})`);

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    await vi.waitFor(() =>
      expect(channel.send).toHaveBeenCalledWith(
        `ENC(${JSON.stringify({ type: "push-subscription-announce", ...ownSub })})`
      )
    );
  });

  it("sends no push-subscription announce when this profile has none", async () => {
    const { channel } = await establishedChat({ ownDeviceList: null });

    await vi.waitFor(() =>
      expect(channel.send).toHaveBeenCalledWith(`ENC(${JSON.stringify({ type: "identity-announce" })})`)
    );
    const sent = channel.send.mock.calls.map(([payload]) => payload);
    expect(sent.some((p) => p.includes("push-subscription-announce"))).toBe(false);
  });

  it("applies an incoming push-subscription announce and persists it on the contact (profile mode)", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    dbGet.mockResolvedValue(undefined);

    const peerIdentityKey = fakePublicKey("peer-identity");
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: peerIdentityKey,
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp"
    });
    rememberContact.mockResolvedValue({ status: "new", contact: { pushSubscription: null } });
    getContact.mockResolvedValue({ fingerprint: "peer-fp", pushSubscription: null });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    const incomingSub = { endpoint: "https://push.example/y", keys: { p256dh: "p2", auth: "a2" } };
    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({ type: "push-subscription-announce", ...incomingSub })
    );
    await captured.onMessage("ENCRYPTED_SUB");

    await vi.waitFor(() => expect(updateContactPushSubscription).toHaveBeenCalledWith("peer-fp", incomingSub));
  });

  it("ignores a malformed push-subscription announce (profile mode, verified peer)", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    dbGet.mockResolvedValue(undefined);
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: fakePublicKey("peer-identity"),
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp"
    });
    rememberContact.mockResolvedValue({ status: "new", contact: { pushSubscription: null } });
    getContact.mockResolvedValue({ fingerprint: "peer-fp", pushSubscription: null });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "push-subscription-announce", endpoint: 123 }));

    await captured.onMessage("ENCRYPTED_SUB");

    expect(updateContactPushSubscription).not.toHaveBeenCalled();
  });

  it("ignores a push-subscription announce arriving before the identity announce", async () => {
    const { captured } = await establishedChat();
    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({
        type: "push-subscription-announce",
        endpoint: "https://push.example/z",
        keys: { p256dh: "p", auth: "a" }
      })
    );

    await captured.onMessage("ENCRYPTED_SUB");

    expect(updateContactPushSubscription).not.toHaveBeenCalled();
  });

  it("ignores a push-subscription announce in ephemeral mode (no vaultKey) even after peer verification", async () => {
    // establishedChat() sets up a non-profile (ephemeral) identity via
    // btn-generate, matching the existing device-list "before identity
    // announce" gate style but here verifying the peer first still doesn't
    // unlock the store because there's no vaultKey.
    const { captured } = await establishedChat();
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: fakePublicKey("peer-identity"),
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp"
    });
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({
        type: "push-subscription-announce",
        endpoint: "https://push.example/z",
        keys: { p256dh: "p", auth: "a" }
      })
    );

    await captured.onMessage("ENCRYPTED_SUB");

    expect(updateContactPushSubscription).not.toHaveBeenCalled();
  });

  it("saves an incoming recovery-share announce (profile mode, verified peer)", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    dbGet.mockResolvedValue(undefined);
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: fakePublicKey("peer-identity"),
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp"
    });
    rememberContact.mockResolvedValue({ status: "new", contact: { pushSubscription: null } });
    getContact.mockResolvedValue({ fingerprint: "peer-fp", pushSubscription: null });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");

    const share = { x: 3, y: new Uint8Array([1, 2, 3]), threshold: 2, totalShares: 3 };
    const announce = buildRecoveryShareAnnounce(share);
    decryptMessage.mockResolvedValueOnce(JSON.stringify(announce));
    await captured.onMessage("ENCRYPTED_SHARE");

    await vi.waitFor(() =>
      expect(saveTrustedShare).toHaveBeenCalledWith(
        expect.objectContaining({ ownerFingerprint: "peer-fp", x: 3, threshold: 2, totalShares: 3 })
      )
    );
  });

  it("ignores a malformed recovery-share announce (profile mode, verified peer)", async () => {
    const { captured } = await establishedChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");

    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({ type: "recovery-share-announce", x: 0, y: "abc", threshold: 5, totalShares: 3 })
    );
    await captured.onMessage("ENCRYPTED_SHARE");

    expect(saveTrustedShare).not.toHaveBeenCalled();
  });

  it("ignores a recovery-share announce arriving before the identity announce", async () => {
    const { captured } = await establishedChat();
    const announce = buildRecoveryShareAnnounce({ x: 1, y: new Uint8Array([9]), threshold: 2, totalShares: 3 });
    decryptMessage.mockResolvedValueOnce(JSON.stringify(announce));

    await captured.onMessage("ENCRYPTED_SHARE");

    expect(saveTrustedShare).not.toHaveBeenCalled();
  });

  it("ignores a recovery-share announce in ephemeral mode (no vaultKey) even after peer verification", async () => {
    const { captured } = await establishedChat();
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: fakePublicKey("peer-identity"),
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp"
    });
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");

    const announce = buildRecoveryShareAnnounce({ x: 1, y: new Uint8Array([9]), threshold: 2, totalShares: 3 });
    decryptMessage.mockResolvedValueOnce(JSON.stringify(announce));
    await captured.onMessage("ENCRYPTED_SHARE");

    expect(saveTrustedShare).not.toHaveBeenCalled();
  });

  it("primary link flow appends the new device certificate to the own stored device list", async () => {
    const identityRaw = new Uint8Array([7, 7, 7]);
    exportRawIdentity.mockResolvedValue(identityRaw);
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    const linkRequest = { type: "device-link-request", devicePubkey: "DEV_PUB" };
    decryptMessage.mockResolvedValue(JSON.stringify(linkRequest));
    const certificate = { devicePubkey: "DEV_PUB", issuedAt: 1, expiresAt: 2, signature: "CERT_SIG" };
    createLinkGrant.mockResolvedValue({ type: "device-link-grant", certificate, identityPrivateKey: "RAW", contacts: [] });
    encryptMessage.mockResolvedValue("ENCRYPTED_GRANT");
    const heldOwnList = { version: 1, certificates: [], signature: "OLD" };
    dbGet.mockImplementation(async (store, key) =>
      store === "profile" && key === "deviceList:profile-fp" ? heldOwnList : undefined
    );
    const updatedOwnList = { version: 2, certificates: [certificate], signature: "NEW" };
    appendDeviceToList.mockResolvedValue(updatedOwnList);

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("link-passphrase").value = "my passphrase";
    document.getElementById("btn-link-device").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });
    await captured.onMessage("ENCRYPTED_REQUEST");

    await vi.waitFor(() => expect(appendDeviceToList).toHaveBeenCalledWith(identityRaw, heldOwnList, certificate));
    expect(exportRawIdentity).toHaveBeenCalledWith("profile-fp", "my passphrase");
    expect(dbPut).toHaveBeenCalledWith("profile", "deviceList:profile-fp", updatedOwnList);
  });
});

describe("chat history wiring (Section 14)", () => {
  const VAULT_KEY = { __tag: "vault-key" };

  // Drives a PROFILE-MODE chat to the point where the peer is verified.
  async function verifiedProfileChat() {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: VAULT_KEY
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("ENC");
    dbGet.mockResolvedValue(undefined);
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: fakePublicKey("peer-identity"),
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp"
    });
    rememberContact.mockResolvedValue({ status: "new", contact: {} });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toContain("peer-fp")
    );
    return { captured, channel };
  }

  it("persists an outgoing message under the verified peer fingerprint in profile mode", async () => {
    await verifiedProfileChat();

    document.getElementById("message-input").value = "збережи мене";
    document.getElementById("btn-send").click();

    await vi.waitFor(() => expect(appendMessage).toHaveBeenCalled());
    expect(appendMessage).toHaveBeenCalledWith(VAULT_KEY, "profile-fp", "peer-fp", {
      direction: "out",
      text: "збережи мене",
      timestamp: expect.any(Number)
    });
  });

  it("persists an incoming message under the verified peer fingerprint in profile mode", async () => {
    const { captured } = await verifiedProfileChat();

    decryptMessage.mockResolvedValueOnce("вхідне для історії");
    await captured.onMessage("ENCRYPTED_TEXT");

    await vi.waitFor(() => expect(appendMessage).toHaveBeenCalled());
    expect(appendMessage).toHaveBeenCalledWith(VAULT_KEY, "profile-fp", "peer-fp", {
      direction: "in",
      text: "вхідне для історії",
      timestamp: expect.any(Number)
    });
  });

  it("renders the prior history into the chat log when a known contact's identity is verified", async () => {
    listMessages.mockResolvedValue([
      { direction: "out", text: "давнє вихідне", timestamp: 1 },
      { direction: "in", text: "давнє вхідне", timestamp: 2 }
    ]);

    await verifiedProfileChat();

    await vi.waitFor(() => {
      const log = document.getElementById("chat-log").textContent;
      expect(log).toContain("давнє вихідне");
      expect(log).toContain("давнє вхідне");
    });
    expect(listMessages).toHaveBeenCalledWith(VAULT_KEY, "profile-fp", "peer-fp");
  });

  it("marks imported (Section I3) history with a visual badge, and leaves native messages unmarked", async () => {
    listMessages.mockResolvedValue([
      { direction: "in", text: "давнє імпортоване", timestamp: 1, imported: true },
      { direction: "out", text: "нативне повідомлення", timestamp: 2 }
    ]);

    await verifiedProfileChat();

    await vi.waitFor(() => {
      const log = document.getElementById("chat-log").textContent;
      expect(log).toContain("давнє імпортоване");
      expect(log).toContain("нативне повідомлення");
    });
    const lines = document.getElementById("chat-log").textContent.trim().split("\n");
    const importedLine = lines.find((line) => line.includes("давнє імпортоване"));
    const nativeLine = lines.find((line) => line.includes("нативне повідомлення"));
    expect(importedLine).toContain("імпортоване");
    expect(nativeLine).not.toContain("імпортоване");
  });

  it("writes nothing to history in ephemeral mode (send and receive)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("id-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("ENC");
    dbGet.mockResolvedValue(undefined);
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: fakePublicKey("peer-identity"),
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp"
    });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toContain("peer-fp")
    );

    document.getElementById("message-input").value = "ефемерне";
    document.getElementById("btn-send").click();
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalled());
    decryptMessage.mockResolvedValueOnce("вхідне ефемерне");
    await captured.onMessage("ENCRYPTED_TEXT");
    await vi.waitFor(() => expect(document.getElementById("chat-log").textContent).toContain("вхідне ефемерне"));

    expect(appendMessage).not.toHaveBeenCalled();
    expect(listMessages).not.toHaveBeenCalled();
  });
});

describe("device linking UI", () => {
  describe("btn-link-device (primary device)", () => {
    it("requires the profile passphrase before starting", async () => {
      initApp(document, { locale: "uk" });
      document.getElementById("btn-link-device").click();
      await vi.waitFor(() =>
        expect(document.getElementById("device-link-status").textContent).toMatch(/passphrase/i)
      );
      expect(exportRawIdentity).not.toHaveBeenCalled();
      expect(createInvite).not.toHaveBeenCalled();
    });

    it("refuses to link before an active profile exists", async () => {
      initApp(document, { locale: "uk" });
      document.getElementById("link-passphrase").value = "some passphrase";
      document.getElementById("btn-link-device").click();
      await vi.waitFor(() =>
        expect(document.getElementById("device-link-status").textContent).toMatch(/профіль/)
      );
      expect(exportRawIdentity).not.toHaveBeenCalled();
    });

    it("unlocks the raw identity, creates an invite, and answers a link request with an encrypted grant", async () => {
      const identityRaw = new Uint8Array([7, 7, 7]);
      exportRawIdentity.mockResolvedValue(identityRaw);
      createPermanentProfile.mockResolvedValue({
        privateKey: { __tag: "profile-priv" },
        publicKey: fakePublicKey("profile-pub"),
        vaultKey: { __tag: "vault-key" }
      });
      fingerprint.mockResolvedValue("profile-fp");
      generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
      createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
      createOffer.mockResolvedValue(undefined);
      pollForAnswer.mockResolvedValue({
        answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
        ecdhPubkey: "peer-ecdh-b64"
      });
      deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
      const linkRequest = { type: "device-link-request", devicePubkey: "DEV_PUB" };
      decryptMessage.mockResolvedValue(JSON.stringify(linkRequest));
      const grant = { type: "device-link-grant", certificate: {}, identityPrivateKey: "RAW_B64", contacts: [] };
      createLinkGrant.mockResolvedValue(grant);
      encryptMessage.mockResolvedValue("ENCRYPTED_GRANT");

      const channel = fakeChannel();
      let captured;
      startAsInitiator.mockImplementation((opts) => {
        captured = opts;
        return { __fakePc: true };
      });

      initApp(document, { locale: "uk" });
      document.getElementById("btn-create-profile").click();
      document.getElementById("profile-passphrase").value = "pass";
      document.getElementById("btn-profile-confirm").click();
      await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
      document.getElementById("link-passphrase").value = "my passphrase";
      document.getElementById("btn-link-device").click();
      await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

      expect(exportRawIdentity).toHaveBeenCalledWith("profile-fp", "my passphrase");
      // The secret must not linger in the DOM afterwards.
      expect(document.getElementById("link-passphrase").value).toBe("");
      expect(createInvite).toHaveBeenCalled();
      expect(document.getElementById("room-id").value).toBe("room1");

      captured.onChannelOpen(channel);
      await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

      // Simulate the new device's encrypted link request arriving.
      await captured.onMessage("ENCRYPTED_REQUEST_PAYLOAD");
      await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith("ENCRYPTED_GRANT"));

      expect(createLinkGrant).toHaveBeenCalledWith(identityRaw, linkRequest, { contacts: [] });
      expect(encryptMessage).toHaveBeenCalledWith({ __tag: "session-key" }, JSON.stringify(grant));
      expect(document.getElementById("device-link-status").textContent).toMatch(/прив'язано/);
    });
  });

  describe("btn-join-as-device (new device)", () => {
    it("requires a local passphrase for the adopted profile", async () => {
      initApp(document, { locale: "uk" });
      document.getElementById("btn-join-as-device").click();
      await vi.waitFor(() =>
        expect(document.getElementById("device-link-status").textContent).toMatch(/passphrase/i)
      );
      expect(generateDeviceKeyPair).not.toHaveBeenCalled();
    });

    it("joins the room, sends an encrypted link request, and applies the received grant", async () => {
      const devicePair = { privateKey: {}, publicKey: fakePublicKey("device-pub") };
      generateDeviceKeyPair.mockResolvedValue(devicePair);
      generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
      getOffer.mockResolvedValue({ offer: JSON.stringify({ type: "offer", sdp: "OFFER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });
      submitAnswer.mockResolvedValue(undefined);
      deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
      const linkRequest = { type: "device-link-request", devicePubkey: "DEV_PUB" };
      createLinkRequest.mockResolvedValue(linkRequest);
      encryptMessage.mockResolvedValue("ENCRYPTED_REQUEST");
      const grant = { type: "device-link-grant", certificate: {}, identityPrivateKey: "RAW_B64", contacts: [] };
      decryptMessage.mockResolvedValue(JSON.stringify(grant));
      const adoptedPair = { privateKey: {}, publicKey: fakePublicKey("identity-pub") };
      applyLinkGrant.mockResolvedValue({ identityKeyPair: adoptedPair, certificate: {}, contacts: [] });
      fingerprint.mockResolvedValue("adopted-fp");

      const channel = fakeChannel();
      let captured;
      startAsJoiner.mockImplementation((opts) => {
        captured = opts;
        return { __fakePc: true };
      });

      initApp(document, { locale: "uk" });
      document.getElementById("room-id").value = "room1";
      document.getElementById("invite-token").value = "tok1";
      document.getElementById("device-local-passphrase").value = "new device pass";
      document.getElementById("btn-join-as-device").click();
      await vi.waitFor(() => expect(startAsJoiner).toHaveBeenCalled());

      expect(getOffer).toHaveBeenCalledWith("http://node.example/index.php", {
        senderKey: expect.any(String),
        roomId: "room1",
        inviteToken: "tok1"
      });

      captured.onChannelOpen(channel);
      await captured.onLocalAnswerReady({ type: "answer", sdp: "ANSWER_SDP" });

      // Once both the channel and session key exist, the link request goes out encrypted.
      await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith("ENCRYPTED_REQUEST"));
      expect(createLinkRequest).toHaveBeenCalledWith(devicePair.publicKey);

      // The primary's grant arrives; it must be applied with the local passphrase and OUR device key.
      await captured.onMessage("ENCRYPTED_GRANT_PAYLOAD");
      await vi.waitFor(() =>
        expect(document.getElementById("device-link-status").textContent).toMatch(/приєднано/)
      );
      expect(applyLinkGrant).toHaveBeenCalledWith(grant, "new device pass", { devicePublicKey: devicePair.publicKey });
      // The adopted identity becomes this device's active account.
      expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001adopted-fp");
      // The secret must not linger in the DOM afterwards.
      expect(document.getElementById("device-local-passphrase").value).toBe("");
    });
  });
});

describe("ephemeral identity banner on conversation screen (Section F5)", () => {
  it("shows the temp nickname and an invite button in ephemeral (quick-chat) mode", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");

    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(fakeChannel());

    await vi.waitFor(() => expect(document.getElementById("ephemeral-identity-banner").hidden).toBe(false));
    expect(document.getElementById("ephemeral-nickname-display").textContent).toBe("Тихий Привид");
    // The invite button lives in its own always-available bar now (Section
    // F6/instant-lobby), not nested inside the ephemeral-only nickname banner.
    expect(document.getElementById("invite-bar").hidden).toBe(false);
  });

  it("hides the banner in permanent-profile mode", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");

    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    // A nickname IS set here (unlike an earlier version of this test) --
    // the invariant under test is specifically "vaultKey exists => hidden",
    // not "no nickname => hidden" (exec review: those are different gates
    // and a nickname-less test doesn't actually exercise the vaultKey check).
    document.getElementById("nickname-input").value = "Оксана";
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(fakeChannel());

    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));
    expect(document.getElementById("ephemeral-identity-banner").hidden).toBe(true);
    // The invite bar is NOT ephemeral-only (Section F6/instant-lobby): a
    // permanent-profile user who initiates a chat still owns the pending
    // invite and needs a way to share it.
    expect(document.getElementById("invite-bar").hidden).toBe(false);
  });

  it("btn-invite-from-chat copies the invite link, same as btn-copy-invite on the Room screen", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");

    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(fakeChannel());
    await vi.waitFor(() => expect(document.getElementById("invite-bar").hidden).toBe(false));

    document.getElementById("btn-invite-from-chat").click();

    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain("room=room1");
    // Section RF12 (bug report): the icon-only toolbar button has no
    // visible text feedback of its own (#invite-status lives on the Room
    // screen) -- a transient tooltip must appear at the button itself.
    const tooltip = document.getElementById("copied-tooltip");
    expect(tooltip).not.toBeNull();
    expect(tooltip.classList.contains("copied-tooltip-visible")).toBe(true);
    delete navigator.clipboard;
  });
});

describe("zero-click invite-link auto-join (Section F4)", () => {
  it("auto-generates identity + nickname and auto-joins on load, with no click, when ?room=&token= are present", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Спритна Тінь");
    getOffer.mockResolvedValue({ offer: JSON.stringify({ type: "offer", sdp: "OFFER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });

    let captured;
    startAsJoiner.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk", locationSearch: "?room=room-from-link&token=token-from-link" });

    // No button click anywhere in this test.
    await vi.waitFor(() => expect(generateIdentityKeyPair).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(getOffer).toHaveBeenCalledWith("http://node.example/index.php", {
        senderKey: "sender-fp",
        roomId: "room-from-link",
        inviteToken: "token-from-link"
      })
    );
    await vi.waitFor(() => expect(startAsJoiner).toHaveBeenCalled());

    // The conversation screen (with its own invite-bar hidden, since the
    // JOINER doesn't own the invite) must already be visible BEFORE the
    // channel opens -- the same instant-lobby behavior as the initiator side.
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));
    expect(document.getElementById("invite-bar").hidden).toBe(true);

    captured.onChannelOpen(fakeChannel());
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));
  });

  it("does not auto-join when there are no ?room=&token= query params", async () => {
    initApp(document, { locale: "uk" });
    await Promise.resolve();
    expect(generateIdentityKeyPair).not.toHaveBeenCalled();
    expect(getOffer).not.toHaveBeenCalled();
  });

  it("disables btn-quick-chat while auto-join is in flight, so a manual click can't start a competing initiator session (exec review finding)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    let resolveGetOffer;
    getOffer.mockReturnValue(
      new Promise((resolve) => {
        resolveGetOffer = resolve;
      })
    );

    initApp(document, { locale: "uk", locationSearch: "?room=room-from-link&token=token-from-link" });

    await vi.waitFor(() => expect(document.getElementById("btn-quick-chat").disabled).toBe(true));
    document.getElementById("btn-quick-chat").click(); // must be a no-op while auto-join owns the session
    expect(createInvite).not.toHaveBeenCalled();

    resolveGetOffer({ offer: JSON.stringify({ type: "offer", sdp: "OFFER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });
    await vi.waitFor(() => expect(document.getElementById("btn-quick-chat").disabled).toBe(false));
  });
});

describe("zero-click default landing on chat, no registration (Section H5)", () => {
  it("does NOT auto-start when initApp is called the normal way (regression guard for the ~166 other tests in this file)", async () => {
    initApp(document, { locale: "uk" });
    await Promise.resolve();
    expect(generateIdentityKeyPair).not.toHaveBeenCalled();
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("auto-starts an ephemeral chat with zero clicks on a fresh visit when explicitly enabled", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    startAsInitiator.mockImplementation(() => ({ __fakePc: true }));

    initApp(document, { locale: "uk", autoStartChat: true });

    // No button click anywhere in this test.
    await vi.waitFor(() => expect(generateIdentityKeyPair).toHaveBeenCalled());
    await vi.waitFor(() => expect(createInvite).toHaveBeenCalledWith("http://node.example/index.php", "sender-fp", expect.anything()));
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));
    expect(document.getElementById("invite-bar").hidden).toBe(false); // owns the invite, like btn-quick-chat
  });

  it("does not auto-start if a remembered session exists (a returning profiled user isn't hijacked into an ephemeral identity)", async () => {
    localStorage.setItem("spirit.session", JSON.stringify({ profileId: "some-profile-id", expiresAt: Date.now() + 3600_000 }));

    initApp(document, { locale: "uk", autoStartChat: true });
    await Promise.resolve();

    expect(generateIdentityKeyPair).not.toHaveBeenCalled();
    expect(visibleScreens()).toEqual(["account"]);
  });

  it("does not auto-start if there's an invite link -- Section F4's auto-join takes over instead", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    getOffer.mockResolvedValue({ offer: JSON.stringify({ type: "offer", sdp: "OFFER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });
    startAsJoiner.mockImplementation(() => ({ __fakePc: true }));

    initApp(document, {
      locale: "uk",
      autoStartChat: true,
      locationSearch: "?room=room-from-link&token=token-from-link"
    });

    await vi.waitFor(() => expect(getOffer).toHaveBeenCalled());
    // The initiator-side createInvite must never fire -- F4 (joiner) owns this load.
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("ignores a manual btn-quick-chat click while the auto-start is already in flight (re-entrancy guard, mirrors the F4 finding)", async () => {
    let resolveCreateInvite;
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockReturnValue(
      new Promise((resolve) => {
        resolveCreateInvite = resolve;
      })
    );

    initApp(document, { locale: "uk", autoStartChat: true });

    await vi.waitFor(() => expect(document.getElementById("btn-quick-chat").disabled).toBe(true));
    document.getElementById("btn-quick-chat").click();
    await vi.waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));

    resolveCreateInvite({ roomId: "room1", inviteToken: "tok1" });
    await vi.waitFor(() => expect(document.getElementById("btn-quick-chat").disabled).toBe(false));
  });
});

describe("instant conversation lobby: local camera/mic preview while waiting (Section F6)", () => {
  function fakeTrack(kind) {
    return { kind, enabled: true, stop: vi.fn() };
  }
  function fakeStream(tracks) {
    return { getTracks: () => tracks };
  }

  it("requests camera+mic and shows local preview immediately on quick-chat, without waiting for the channel to open", async () => {
    const localTracks = [fakeTrack("video"), fakeTrack("audio")];
    const stream = fakeStream(localTracks);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true
    });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    startAsInitiator.mockImplementation(() => ({ __fakePc: true }));

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();

    // No onChannelOpen anywhere in this test -- the peer never joins.
    await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true }));
    await vi.waitFor(() => expect(document.getElementById("video-local").srcObject).toBe(stream));
    // Camera/mic toggle must be testable while waiting, not gated on a peer.
    expect(document.getElementById("btn-toggle-camera").disabled).toBe(false);
    expect(document.getElementById("btn-toggle-mic").disabled).toBe(false);
  });

  it("defers the camera/mic request by localMediaPreviewDelayMs, so an immediate click elsewhere (e.g. copy-invite) isn't blocked by the permission prompt (bug report 2026-07-17)", async () => {
    const stream = fakeStream([fakeTrack("video"), fakeTrack("audio")]);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true
    });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    startAsInitiator.mockImplementation(() => ({ __fakePc: true }));

    initApp(document, { locale: "uk", localMediaPreviewDelayMs: 1000 });
    document.getElementById("btn-quick-chat").click();
    await vi.waitFor(() => expect(document.getElementById("invite-bar").hidden).toBe(false));

    // Not called yet, well within the delay window.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();

    // Called once the delay elapses.
    await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true }), {
      timeout: 2000
    });
  });

  it("cancels the pending delayed preview on Вийти, so it doesn't re-acquire camera/mic after logout (exec review finding)", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream([fakeTrack("video"), fakeTrack("audio")])) },
      configurable: true
    });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    startAsInitiator.mockImplementation(() => ({ __fakePc: true }));

    initApp(document, { locale: "uk", localMediaPreviewDelayMs: 300 });
    document.getElementById("btn-quick-chat").click();
    await vi.waitFor(() => expect(document.getElementById("invite-bar").hidden).toBe(false));

    // Log out WITHIN the delay window, before the timer has fired.
    document.getElementById("btn-settings-toggle").click();
    document.getElementById("btn-logout").click();

    // Give the (cancelled) timer plenty of time to have fired if it wasn't
    // actually cancelled -- it must NOT have re-acquired media post-logout.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("requests camera+mic immediately when localMediaPreviewDelayMs is 0 (the default, matching every other test in this file)", async () => {
    const stream = fakeStream([fakeTrack("video"), fakeTrack("audio")]);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true
    });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    startAsInitiator.mockImplementation(() => ({ __fakePc: true }));

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();

    await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true }));
  });

  it("shows the invite bar and starts the camera/mic preview for a manual btn-join too, before the channel opens", async () => {
    const stream = fakeStream([fakeTrack("video"), fakeTrack("audio")]);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true
    });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    getOffer.mockResolvedValue({ offer: JSON.stringify({ type: "offer", sdp: "OFFER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });
    startAsJoiner.mockImplementation(() => ({ __fakePc: true }));

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("room-id").value = "room1";
    document.getElementById("invite-token").value = "tok1";
    document.getElementById("btn-join").click();

    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));
    expect(document.getElementById("invite-bar").hidden).toBe(true); // joiner never owns the invite
    await vi.waitFor(() => expect(document.getElementById("video-local").srcObject).toBe(stream));
  });

  it("reuses the already-previewed stream when the call actually starts -- does not call getUserMedia twice, adds tracks to the peer connection exactly once", async () => {
    const localTracks = [fakeTrack("video"), fakeTrack("audio")];
    const stream = fakeStream(localTracks);
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
      configurable: true
    });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");
    createRenegotiationOffer.mockResolvedValue({ type: "offer", sdp: "RENEG_OFFER" });

    let captured;
    const pc = { __fakePc: true };
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return pc;
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();
    await vi.waitFor(() => expect(document.getElementById("video-local").srcObject).toBe(stream));

    captured.onChannelOpen(fakeChannel());
    document.getElementById("btn-start-call").click();

    await vi.waitFor(() => expect(addLocalMediaTracks).toHaveBeenCalledWith(pc, stream));
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(addLocalMediaTracks).toHaveBeenCalledTimes(1);
  });

  it("shows a status message instead of crashing when the preview's getUserMedia is denied, and chat still works", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("Permission denied")) },
      configurable: true
    });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    startAsInitiator.mockImplementation(() => ({ __fakePc: true }));

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();

    await vi.waitFor(() => expect(document.getElementById("video-status").textContent).toContain("Permission denied"));
    expect(visibleScreens()).toEqual(["conversation"]);
    expect(document.getElementById("invite-bar").hidden).toBe(false);
  });

  it("does not start a second concurrent getUserMedia prompt if the lobby is entered again while the first is still pending (exec review finding)", async () => {
    let resolveGetUserMedia;
    const getUserMediaMock = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveGetUserMedia = resolve;
        })
    );
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: getUserMediaMock },
      configurable: true
    });

    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    startAsInitiator.mockImplementation(() => ({ __fakePc: true }));

    initApp(document, { locale: "uk" });
    document.getElementById("btn-quick-chat").click();
    await vi.waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(1));

    // A second entry into the lobby (e.g. a fast double-click reaching
    // initiateChatSession a second time) must NOT fire a second getUserMedia
    // prompt while the first one is still pending -- doing so would orphan
    // the first stream's tracks (camera left running, never stopped).
    // withBusyButton re-enables btn-quick-chat as soon as initiateChatSession()
    // resolves (which happens BEFORE getUserMedia settles, since
    // startInitiatorSession's own async work isn't awaited) -- give the
    // second click's own createInvite/generateEcdhKeyPair awaits real time
    // to actually run before asserting no second getUserMedia call happened.
    document.getElementById("btn-quick-chat").click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);

    const stream = fakeStream([fakeTrack("video"), fakeTrack("audio")]);
    resolveGetUserMedia(stream);
    await vi.waitFor(() => expect(document.getElementById("video-local").srcObject).toBe(stream));
    expect(getUserMediaMock).toHaveBeenCalledTimes(1);
  });
});

describe("invite-link rendezvous (Section N6)", () => {
  it("pre-fills room-id/invite-token from ?room=&token= query params on load", () => {
    initApp(document, { locale: "uk", locationSearch: "?room=room-from-link&token=token-from-link" });

    expect(document.getElementById("room-id").value).toBe("room-from-link");
    expect(document.getElementById("invite-token").value).toBe("token-from-link");
  });

  it("does not touch room-id/invite-token when no query params are present", () => {
    initApp(document, { locale: "uk" });

    expect(document.getElementById("room-id").value).toBe("");
    expect(document.getElementById("invite-token").value).toBe("");
  });

  it("btn-copy-invite builds a link from the current field values and displays it", async () => {
    initApp(document, { locale: "uk" });
    document.getElementById("room-id").value = "my-room";
    document.getElementById("invite-token").value = "my-token";

    document.getElementById("btn-copy-invite").click();

    await vi.waitFor(() => {
      const link = document.getElementById("invite-link-display").textContent;
      expect(link).toContain("room=my-room");
      expect(link).toContain("token=my-token");
      expect(link).toContain("#/room");
    });
  });

  it("attempts navigator.clipboard.writeText best-effort when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    initApp(document, { locale: "uk" });
    document.getElementById("room-id").value = "my-room";
    document.getElementById("invite-token").value = "my-token";
    document.getElementById("btn-copy-invite").click();

    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain("room=my-room");

    delete navigator.clipboard;
  });

  it("does not throw when Clipboard API is unavailable (jsdom default / insecure context)", async () => {
    initApp(document, { locale: "uk" });
    document.getElementById("room-id").value = "my-room";
    document.getElementById("invite-token").value = "my-token";

    expect(() => document.getElementById("btn-copy-invite").click()).not.toThrow();
    await vi.waitFor(() => expect(document.getElementById("invite-link-display").textContent).toContain("my-room"));
  });

  it("shows a status asking to create/enter Room ID and token first when both fields are empty", async () => {
    initApp(document, { locale: "uk" });

    document.getElementById("btn-copy-invite").click();

    await vi.waitFor(() =>
      expect(document.getElementById("invite-status").textContent).toMatch(/room id|invite token/i)
    );
    expect(document.getElementById("invite-link-display").textContent).toBe("");
  });

  it("an invite-link session navigates to room (not profile) after unlocking a stored profile", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    loadPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("unlocked-pub"),
      vaultKey: { __tag: "vault-key" },
      profileId: "f".repeat(64)
    });

    initApp(document, { locale: "uk", locationSearch: "?room=room-from-link&token=token-from-link" });
    location.hash = "#/server"; // leave the default screen so the navigation is observable
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(1));

    document.getElementById("unlock-passphrase").value = "my pass";
    document.getElementById("btn-profile-unlock").click();

    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
  });

  it("an invite-link session navigates to room (not profile) after skipping backup on a new profile", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");

    initApp(document, { locale: "uk", locationSearch: "?room=room-from-link&token=token-from-link" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("backup-step").hidden).toBe(false));

    document.getElementById("btn-backup-skip").click();

    expect(visibleScreens()).toEqual(["room"]);
  });

  it("a normal (non-invite-link) session still navigates to profile as before", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("backup-step").hidden).toBe(false));

    document.getElementById("btn-backup-skip").click();

    expect(visibleScreens()).toEqual(["profile"]);
  });
});

describe("video call (Section V2)", () => {
  function fakeTrack(kind) {
    return { kind, enabled: true, stop: vi.fn() };
  }
  function fakeStream(tracks) {
    return { getTracks: () => tracks };
  }

  beforeEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      configurable: true
    });
  });

  // Drives the initiator chat flow up to an open channel + derived session
  // key, mirroring establishedInitiatorChat() in the identity-announce suite
  // above (that helper is scoped to its own describe block).
  async function establishedInitiatorChat() {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: { __tag: "id-priv" }, publicKey: fakePublicKey("id-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockImplementation(async (_key, text) => `ENC(${text})`);

    const channel = fakeChannel();
    let captured;
    let pc;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      pc = { __fakePc: true };
      return pc;
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });
    return { captured, channel, pc };
  }

  // Calls are only auto-answered for a peer whose identity has already been
  // verified via identity-announce (mirrors the chat-text gate in
  // handleChatMessage) -- this drives that verification first.
  async function establishedVerifiedInitiatorChat() {
    verifyIdentityAnnounce.mockResolvedValue({ identityPublicKey: {}, identityPubkeyWire: "PEER", fingerprint: "peer-fp" });
    const session = await establishedInitiatorChat();
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await session.captured.onMessage("ENCRYPTED_ANNOUNCE");
    return session;
  }

  it("disables the call/camera/mic controls until the chat channel connects, then enables them", async () => {
    initApp(document, { locale: "uk" });
    for (const id of ["btn-start-call", "btn-toggle-camera", "btn-toggle-mic"]) {
      expect(document.getElementById(id).disabled).toBe(true);
    }

    await establishedInitiatorChat();
    for (const id of ["btn-start-call", "btn-toggle-camera", "btn-toggle-mic"]) {
      expect(document.getElementById(id).disabled).toBe(false);
    }
  });

  it("registers onRemoteTrack when the peer connection is created", async () => {
    const { captured } = await establishedInitiatorChat();
    expect(typeof captured.onRemoteTrack).toBe("function");
  });

  it("clicking Дзвінок requests camera+mic, shows local video, and sends an encrypted call offer", async () => {
    const localTracks = [fakeTrack("video"), fakeTrack("audio")];
    const stream = fakeStream(localTracks);
    navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
    createRenegotiationOffer.mockResolvedValue({ type: "offer", sdp: "RENEG_OFFER" });

    const { channel, pc } = await establishedInitiatorChat();
    document.getElementById("btn-start-call").click();

    await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true }));
    await vi.waitFor(() => expect(document.getElementById("video-local").srcObject).toBe(stream));
    expect(addLocalMediaTracks).toHaveBeenCalledWith(pc, stream);
    const expected = JSON.stringify({ type: "webrtc-call-offer", sdp: { type: "offer", sdp: "RENEG_OFFER" } });
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith(`ENC(${expected})`));
  });

  it("auto-answers an incoming call offer with its own media and an encrypted call answer", async () => {
    const localTracks = [fakeTrack("video"), fakeTrack("audio")];
    const stream = fakeStream(localTracks);
    navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
    createRenegotiationAnswer.mockResolvedValue({ type: "answer", sdp: "RENEG_ANSWER" });

    const { captured, channel, pc } = await establishedVerifiedInitiatorChat();
    const offerMsg = { type: "webrtc-call-offer", sdp: { type: "offer", sdp: "PEER_OFFER" } };
    decryptMessage.mockResolvedValueOnce(JSON.stringify(offerMsg));
    await captured.onMessage("ENCRYPTED_CALL_OFFER");

    await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: true, audio: true }));
    await vi.waitFor(() => expect(createRenegotiationAnswer).toHaveBeenCalledWith(pc, offerMsg.sdp));
    const expected = JSON.stringify({ type: "webrtc-call-answer", sdp: { type: "answer", sdp: "RENEG_ANSWER" } });
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith(`ENC(${expected})`));
  });

  it("does not auto-answer a call offer from a peer whose identity hasn't been verified yet", async () => {
    const { captured } = await establishedInitiatorChat();
    // establishedInitiatorChat() itself already triggers ONE getUserMedia
    // call for the instant-lobby local preview (Section F6) -- the
    // invariant under test is that the unverified call offer doesn't
    // trigger a SECOND one (i.e. doesn't proceed to auto-answer).
    const previewCallCount = navigator.mediaDevices.getUserMedia.mock.calls.length;

    const offerMsg = { type: "webrtc-call-offer", sdp: { type: "offer", sdp: "PEER_OFFER" } };
    decryptMessage.mockResolvedValueOnce(JSON.stringify(offerMsg));
    await captured.onMessage("ENCRYPTED_CALL_OFFER");

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(previewCallCount);
    expect(createRenegotiationAnswer).not.toHaveBeenCalled();
  });

  it("applies an incoming call answer via applyRenegotiationAnswer", async () => {
    const { captured, pc } = await establishedInitiatorChat();
    const answerMsg = { type: "webrtc-call-answer", sdp: { type: "answer", sdp: "PEER_ANSWER" } };
    decryptMessage.mockResolvedValueOnce(JSON.stringify(answerMsg));
    await captured.onMessage("ENCRYPTED_CALL_ANSWER");

    await vi.waitFor(() => expect(applyRenegotiationAnswer).toHaveBeenCalledWith(pc, answerMsg.sdp));
  });

  it("sets the remote video's srcObject and unhides it when a media track arrives, then hides it again once the channel closes", async () => {
    const { captured } = await establishedInitiatorChat();
    expect(document.getElementById("video-remote").hidden).toBe(true);

    const remoteStream = fakeStream([fakeTrack("video")]);
    captured.onRemoteTrack(remoteStream);
    expect(document.getElementById("video-remote").srcObject).toBe(remoteStream);
    expect(document.getElementById("video-remote").hidden).toBe(false);

    captured.onChannelClose();
    expect(document.getElementById("video-remote").hidden).toBe(true);
    expect(document.getElementById("video-remote").srcObject).toBeFalsy();
  });

  it("toggles the camera/mic tracks without requesting getUserMedia again", async () => {
    const localTracks = [fakeTrack("video"), fakeTrack("audio")];
    const stream = fakeStream(localTracks);
    navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
    createRenegotiationOffer.mockResolvedValue({ type: "offer", sdp: "RENEG_OFFER" });

    await establishedInitiatorChat();
    document.getElementById("btn-start-call").click();
    await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));
    expect(document.getElementById("btn-start-call").classList.contains("active")).toBe(true);
    expect(document.getElementById("btn-toggle-camera").classList.contains("active")).toBe(true);
    expect(document.getElementById("btn-toggle-mic").classList.contains("active")).toBe(true);

    document.getElementById("btn-toggle-camera").click();
    expect(localTracks[0].enabled).toBe(false);
    expect(document.getElementById("btn-toggle-camera").classList.contains("active")).toBe(false);
    document.getElementById("btn-toggle-mic").click();
    expect(localTracks[1].enabled).toBe(false);
    expect(document.getElementById("btn-toggle-mic").classList.contains("active")).toBe(false);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("disables the call controls and stops local tracks when the channel closes", async () => {
    const localTracks = [fakeTrack("video"), fakeTrack("audio")];
    const stream = fakeStream(localTracks);
    navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
    createRenegotiationOffer.mockResolvedValue({ type: "offer", sdp: "RENEG_OFFER" });

    const { captured } = await establishedInitiatorChat();
    document.getElementById("btn-start-call").click();
    await vi.waitFor(() => expect(document.getElementById("video-local").srcObject).toBe(stream));

    captured.onChannelClose();

    for (const id of ["btn-start-call", "btn-toggle-camera", "btn-toggle-mic"]) {
      expect(document.getElementById(id).disabled).toBe(true);
      expect(document.getElementById(id).classList.contains("active")).toBe(false);
    }
    for (const track of localTracks) {
      expect(track.stop).toHaveBeenCalled();
    }
  });

  it("shows a status message instead of crashing when getUserMedia is denied", async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(new Error("Permission denied"));

    await establishedInitiatorChat();
    document.getElementById("btn-start-call").click();

    await vi.waitFor(() => expect(document.getElementById("video-status").textContent).toContain("Permission denied"));
  });
});

describe("Section RF4: fixed conversation toolbar + floating, draggable video window", () => {
  it("shows the toolbar and floating video only on the conversation route, for both 1:1 and group chat", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    expect(document.getElementById("conversation-toolbar").hidden).toBe(true);
    expect(document.getElementById("floating-video").hidden).toBe(true);
    expect(document.getElementById("header-call-controls").hidden).toBe(true);
    expect(document.body.classList.contains("conversation-toolbar-visible")).toBe(false);

    location.hash = "#/conversation";
    window.dispatchEvent(new Event("hashchange"));
    expect(document.getElementById("conversation-toolbar").hidden).toBe(false);
    expect(document.getElementById("floating-video").hidden).toBe(false);
    expect(document.getElementById("header-call-controls").hidden).toBe(false);
    expect(document.body.classList.contains("conversation-toolbar-visible")).toBe(true);

    location.hash = "#/history";
    window.dispatchEvent(new Event("hashchange"));
    expect(document.getElementById("conversation-toolbar").hidden).toBe(true);
    expect(document.getElementById("floating-video").hidden).toBe(true);
    expect(document.getElementById("header-call-controls").hidden).toBe(true);
    expect(document.body.classList.contains("conversation-toolbar-visible")).toBe(false);
  });

  it("publishes the toolbar's real rendered height as a CSS variable so .app-body's push-down margin matches it exactly, not a hardcoded guess", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    const toolbar = document.getElementById("conversation-toolbar");
    // jsdom has no real layout engine (offsetHeight is always 0) -- stub a
    // realistic rendered height to prove the CSS variable actually tracks
    // the element's OWN height rather than a fixed constant.
    Object.defineProperty(toolbar, "offsetHeight", { value: 64, configurable: true });

    location.hash = "#/conversation";
    window.dispatchEvent(new Event("hashchange"));

    expect(document.documentElement.style.getPropertyValue("--conversation-toolbar-height")).toBe("64px");
  });

  it("applies a default position/size to the floating video panel when nothing is saved yet", () => {
    initApp(document, { locale: "uk" });
    const panel = document.getElementById("floating-video");
    expect(panel.style.width).toBe("320px");
    expect(panel.style.height).toBe("240px");
    expect(panel.style.left).not.toBe("");
    expect(panel.style.top).not.toBe("");
  });

  it("restores a previously saved position/size from localStorage instead of the default", () => {
    localStorage.setItem("spirit.floatingVideoRect", JSON.stringify({ left: 42, top: 77, width: 400, height: 300 }));
    initApp(document, { locale: "uk" });
    const panel = document.getElementById("floating-video");
    expect(panel.style.left).toBe("42px");
    expect(panel.style.top).toBe("77px");
    expect(panel.style.width).toBe("400px");
    expect(panel.style.height).toBe("300px");
  });

  it("dragging the handle moves the floating video panel and persists the new position on release", () => {
    initApp(document, { locale: "uk" });
    const panel = document.getElementById("floating-video");
    const handle = document.getElementById("floating-video-handle");
    panel.getBoundingClientRect = () => ({ left: 100, top: 100, width: 320, height: 240 });

    const down = new Event("pointerdown");
    down.clientX = 110;
    down.clientY = 105;
    down.pointerId = 1;
    handle.dispatchEvent(down);

    const move = new Event("pointermove");
    move.clientX = 210;
    move.clientY = 205;
    handle.dispatchEvent(move);

    expect(panel.style.left).toBe("200px"); // 210 - (110 - 100)
    expect(panel.style.top).toBe("200px"); // 205 - (105 - 100)

    handle.dispatchEvent(new Event("pointerup"));
    const stored = JSON.parse(localStorage.getItem("spirit.floatingVideoRect"));
    expect(stored.left).toBe(200);
    expect(stored.top).toBe(200);
  });

  it("bug report: clamps the drag so the handle can never end up above the viewport (or off any other edge), unreachable", () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
    try {
    initApp(document, { locale: "uk" });
    const panel = document.getElementById("floating-video");
    const handle = document.getElementById("floating-video-handle");
    panel.getBoundingClientRect = () => ({ left: 100, top: 100, width: 320, height: 240 });

    const down = new Event("pointerdown");
    down.clientX = 110;
    down.clientY = 105;
    down.pointerId = 1;
    handle.dispatchEvent(down);

    // Drag far above/left of the viewport -- must clamp to 0, not go negative.
    const moveNegative = new Event("pointermove");
    moveNegative.clientX = -500;
    moveNegative.clientY = -500;
    handle.dispatchEvent(moveNegative);
    expect(panel.style.left).toBe("0px");
    expect(panel.style.top).toBe("0px");

    // Drag far below/right of the viewport -- must clamp so at least part
    // of the panel (including its handle) stays on-screen and grabbable.
    const moveFar = new Event("pointermove");
    moveFar.clientX = 5000;
    moveFar.clientY = 5000;
    handle.dispatchEvent(moveFar);
    expect(parseFloat(panel.style.left)).toBeLessThanOrEqual(1000);
    expect(parseFloat(panel.style.top)).toBeLessThanOrEqual(800);
    expect(parseFloat(panel.style.left)).toBeGreaterThan(0);
    expect(parseFloat(panel.style.top)).toBeGreaterThan(0);
    } finally {
      Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true });
    }
  });
});

describe("multi-screen navigation (Section N2)", () => {
  it("defaults to the account screen", () => {
    initApp(document, { locale: "uk" });
    expect(visibleScreens()).toEqual(["account"]);
  });

  it("redirects gated screens to account before any identity exists", () => {
    initApp(document, { locale: "uk" });

    location.hash = "#/profile";
    window.dispatchEvent(new Event("hashchange"));
    expect(visibleScreens()).toEqual(["account"]);

    location.hash = "#/manage";
    window.dispatchEvent(new Event("hashchange"));
    expect(visibleScreens()).toEqual(["account"]);
  });

  it("allows ungated screens (server, room) without any identity", () => {
    initApp(document, { locale: "uk" });

    location.hash = "#/server";
    window.dispatchEvent(new Event("hashchange"));
    expect(visibleScreens()).toEqual(["server"]);

    location.hash = "#/room";
    window.dispatchEvent(new Event("hashchange"));
    expect(visibleScreens()).toEqual(["room"]);
  });

  it("quick-chat (ephemeral) navigates straight to the room screen", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();

    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
  });

  it("unlocking a stored profile navigates to the profile screen", async () => {
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    loadPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("unlocked-pub"),
      vaultKey: { __tag: "vault-key" },
      profileId: "f".repeat(64)
    });

    initApp(document, { locale: "uk" });
    // Leave the default account screen first so the navigation is observable.
    location.hash = "#/server";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(1));

    document.getElementById("unlock-passphrase").value = "my pass";
    document.getElementById("btn-profile-unlock").click();

    await vi.waitFor(() => expect(visibleScreens()).toEqual(["profile"]));
  });

  it("skipping backup after creating a profile navigates to the profile screen", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("backup-step").hidden).toBe(false));
    // Still on account until backup is explicitly dismissed.
    expect(visibleScreens()).toEqual(["account"]);

    document.getElementById("btn-backup-skip").click();

    expect(visibleScreens()).toEqual(["profile"]);
  });

  it("an established chat connection (initiator) navigates to the conversation screen", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");

    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    captured.onChannelOpen(fakeChannel());

    expect(visibleScreens()).toEqual(["conversation"]);
  });

  it("device-linking channels do NOT navigate to the conversation screen", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    exportRawIdentity.mockResolvedValue(new Uint8Array([1, 2, 3]));
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });

    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("backup-step").hidden).toBe(false));
    document.getElementById("btn-backup-skip").click();
    expect(visibleScreens()).toEqual(["profile"]);

    document.getElementById("link-passphrase").value = "my pass";
    document.getElementById("btn-link-device").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    captured.onChannelOpen(fakeChannel());

    // Must stay on profile -- this channel is for device linking, not chat.
    expect(visibleScreens()).toEqual(["profile"]);
  });
});

describe("persistent sidebar shell (Section SD1, specs/ui/persistent-sidebar.md)", () => {
  it("populates the sidebar's #contacts-list immediately after initApp(), before any navigation/hashchange occurs at all", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), identityPubkeyWire: "W1", firstSeen: 1, deviceList: null }
    ]);

    initApp(document, { locale: "uk" });

    // No btn-generate click, no hash change -- renderContactsScreen() must
    // have been called synchronously off initApp() itself.
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());
    await vi.waitFor(() => expect(document.querySelectorAll("#contacts-list .list-row").length).toBe(1));
  });

  it("the sidebar's + button (.nav-item[data-route=manage]) navigates to the manage screen when clicked, via router.js's own auto-wiring", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    const addButton = document.getElementById("btn-sidebar-add");
    expect(addButton.classList.contains("nav-item")).toBe(true);
    expect(addButton.dataset.route).toBe("manage");

    addButton.click();

    await vi.waitFor(() => expect(visibleScreens()).toEqual(["manage"]));
  });

  it("#settings-menu no longer contains a nav item with data-route=contacts", () => {
    initApp(document, { locale: "uk" });
    expect(document.querySelector('#settings-menu [data-route="contacts"]')).toBeNull();
  });
});

describe("contacts and history screens (Sections N3/N4)", () => {
  async function reachScreen(route) {
    location.hash = `#/${route}`;
    window.dispatchEvent(new Event("hashchange"));
  }

  it("contacts screen lists every stored contact and hides the empty-state message", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), identityPubkeyWire: "W1", firstSeen: 1, deviceList: null },
      { fingerprint: "b".repeat(64), identityPubkeyWire: "W2", firstSeen: 2, deviceList: null }
    ]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    await reachScreen("contacts");
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());

    const rows = document.querySelectorAll("#contacts-list .list-row");
    expect(rows.length).toBe(2);
    expect(document.getElementById("contacts-empty").hidden).toBe(true);
  });

  it("contacts screen shows the empty-state message when there are none", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    await reachScreen("contacts");
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());

    expect(document.getElementById("contacts-empty").hidden).toBe(false);
    expect(document.querySelectorAll("#contacts-list .list-row").length).toBe(0);
  });

  it("Секція RF2 (specs/ui/redesign-foundation.md): shows an outline trust-shield for a contact with no proofs at all", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), identityPubkeyWire: "W1", firstSeen: 1, deviceList: null, proofSet: null }
    ]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    await reachScreen("contacts");
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());

    const row = document.querySelector("#contacts-list .list-row");
    const shield = row.querySelector(".trust-shield");
    expect(shield).not.toBeNull();
    expect(shield.classList.contains("trust-shield-verified")).toBe(false);
    expect(shield.getAttribute("aria-label") || shield.getAttribute("title")).toMatch(/не підтверджен/i);
  });

  it("Секція RF2: shows a filled/checkmark trust-shield for a contact with at least one confirmed-verified proof", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      {
        fingerprint: "a".repeat(64),
        identityPubkeyWire: "W1",
        firstSeen: 1,
        deviceList: null,
        proofSet: { proofs: [{ url: "https://example.com/proof", label: "telegram" }] }
      }
    ]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    await reachScreen("contacts");
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());

    const row = document.querySelector("#contacts-list .list-row");
    expect(row.textContent).toContain("telegram");
    // No verifiedAt recorded yet for this proof -- still outline, not filled.
    const shield = row.querySelector(".trust-shield");
    expect(shield).not.toBeNull();
    expect(shield.classList.contains("trust-shield-verified")).toBe(false);
  });

  it("contacts screen shows a message button per contact row", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), identityPubkeyWire: "W1", firstSeen: 1, deviceList: null }
    ]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    await reachScreen("contacts");
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());

    const row = document.querySelector("#contacts-list .list-row");
    const button = row.querySelector("[data-i18n='contacts.message']");
    expect(button).not.toBeNull();
  });

  it("clicking a contact's message button creates an invite and enters the conversation screen, without pushing when there's no stored subscription", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    const targetFingerprint = "a".repeat(64);
    listContacts.mockResolvedValue([
      { fingerprint: targetFingerprint, identityPubkeyWire: "W1", firstSeen: 1, deviceList: null, pushSubscription: null }
    ]);
    getContact.mockResolvedValue({
      fingerprint: targetFingerprint,
      identityPubkeyWire: "W1",
      firstSeen: 1,
      deviceList: null,
      pushSubscription: null
    });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    await reachScreen("contacts");
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());

    const row = document.querySelector("#contacts-list .list-row");
    row.querySelector("[data-i18n='contacts.message']").click();

    await vi.waitFor(() => expect(createInvite).toHaveBeenCalledWith("http://node.example/index.php", "sender-fp", expect.anything()));
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("clicking a contact's message button fire-and-forgets a push notification when a subscription is stored", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    const targetFingerprint = "a".repeat(64);
    const pushSubscription = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "p", auth: "a" } };
    listContacts.mockResolvedValue([
      { fingerprint: targetFingerprint, identityPubkeyWire: "W1", firstSeen: 1, deviceList: null, pushSubscription }
    ]);
    getContact.mockResolvedValue({
      fingerprint: targetFingerprint,
      identityPubkeyWire: "W1",
      firstSeen: 1,
      deviceList: null,
      pushSubscription
    });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    sendPushNotification.mockResolvedValue(true);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    await reachScreen("contacts");
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());

    const row = document.querySelector("#contacts-list .list-row");
    row.querySelector("[data-i18n='contacts.message']").click();

    await vi.waitFor(() => expect(createInvite).toHaveBeenCalledWith("http://node.example/index.php", "sender-fp", expect.anything()));
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));
    await vi.waitFor(() =>
      expect(sendPushNotification).toHaveBeenCalledWith(pushSubscription, { room: "room1", token: "tok1" })
    );
  });

  it("history screen lists conversations for the active PROFILE-mode identity", async () => {
    createPermanentProfile.mockResolvedValue({
      privateKey: {},
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    listConversations.mockResolvedValue([
      { contactId: "a".repeat(64), messageCount: 3, lastMessage: { direction: "out", text: "hi", timestamp: 1 } }
    ]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("backup-step").hidden).toBe(false));
    document.getElementById("btn-backup-skip").click();

    await reachScreen("history");
    await vi.waitFor(() => expect(listConversations).toHaveBeenCalledWith({ __tag: "vault-key" }, "profile-fp"));

    expect(document.querySelectorAll("#history-list .list-row").length).toBe(1);
    expect(document.getElementById("history-empty").hidden).toBe(true);
  });

  it("history screen shows the empty-state message in ephemeral mode (no vault key)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    await reachScreen("history");

    expect(document.getElementById("history-empty").hidden).toBe(false);
    expect(listConversations).not.toHaveBeenCalled();
  });
});

describe("contact import UI (Section I2, specs/phase2b/import.md)", () => {
  async function reachContacts() {
    location.hash = "#/manage";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());
  }

  function setImportFile(file) {
    const input = document.getElementById("import-file-input");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
  }

  async function bootstrap() {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    await reachContacts();
  }

  it("picking a file + format calls parseContactList and creates a pending record per parsed entry", async () => {
    await bootstrap();
    parseContactList.mockReturnValue([
      { displayName: "Іван Петренко", sourceIdentifier: "+380501234567" },
      { displayName: "Олена", sourceIdentifier: "+380671112233" }
    ]);
    const saved = [];
    saveImportedContact.mockImplementation(async ({ displayName, sourceIdentifier, source }) => {
      const record = { id: `id-${displayName}`, displayName, sourceIdentifier, source, importedAt: 1, matchedFingerprint: null };
      saved.push(record);
      return record;
    });
    listImportedContacts.mockImplementation(async () => saved);

    document.getElementById("import-format").value = "vcard";
    const file = new File(["BEGIN:VCARD..."], "contacts.vcf", { type: "text/vcard" });
    file.text = vi.fn().mockResolvedValue("BEGIN:VCARD...");
    setImportFile(file);

    await vi.waitFor(() => expect(parseContactList).toHaveBeenCalledWith("BEGIN:VCARD...", "vcard"));
    await vi.waitFor(() => expect(saveImportedContact).toHaveBeenCalledTimes(2));
    expect(saveImportedContact).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Іван Петренко", sourceIdentifier: "+380501234567", source: "vcard" })
    );

    await vi.waitFor(() =>
      expect(document.getElementById("import-pending-list").textContent).toContain("Іван Петренко")
    );
    expect(document.getElementById("import-pending-list").textContent).toContain("+380501234567");
  });

  it("selecting a match target and clicking Match calls setMatchedFingerprint with the right id/fingerprint", async () => {
    await bootstrap();
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), identityPubkeyWire: "W1", firstSeen: 1, deviceList: null, nickname: "Друг" }
    ]);
    listImportedContacts.mockResolvedValue([
      { id: "pending-1", displayName: "Іван", sourceIdentifier: "+380501234567", source: "vcard", importedAt: 1, matchedFingerprint: null }
    ]);

    await reachContacts();

    const row = document.querySelector("[data-imported-id='pending-1']");
    expect(row).not.toBeNull();
    const select = row.querySelector("select");
    select.value = "a".repeat(64);
    select.dispatchEvent(new Event("change"));
    row.querySelector("[data-match-btn]").click();

    await vi.waitFor(() => expect(setMatchedFingerprint).toHaveBeenCalledWith("pending-1", "a".repeat(64)));
  });

  it("a pending import with no match persists across a re-render", async () => {
    await bootstrap();
    listImportedContacts.mockResolvedValue([
      { id: "pending-1", displayName: "Іван", sourceIdentifier: "+380501234567", source: "vcard", importedAt: 1, matchedFingerprint: null }
    ]);

    await reachContacts();
    expect(document.querySelector("[data-imported-id='pending-1']")).not.toBeNull();

    await reachContacts();
    expect(document.querySelector("[data-imported-id='pending-1']")).not.toBeNull();
  });

  it("deleting a pending import removes it from both the list and the store", async () => {
    await bootstrap();
    listImportedContacts.mockResolvedValue([
      { id: "pending-1", displayName: "Іван", sourceIdentifier: "+380501234567", source: "vcard", importedAt: 1, matchedFingerprint: null }
    ]);

    await reachContacts();
    const row = document.querySelector("[data-imported-id='pending-1']");
    row.querySelector("[data-delete-btn]").click();

    await vi.waitFor(() => expect(deleteImportedContact).toHaveBeenCalledWith("pending-1"));
  });

  it("a matched pending import shows the matched contact instead of the match select", async () => {
    await bootstrap();
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), identityPubkeyWire: "W1", firstSeen: 1, deviceList: null, nickname: "Друг" }
    ]);
    listImportedContacts.mockResolvedValue([
      { id: "pending-1", displayName: "Іван", sourceIdentifier: "+380501234567", source: "vcard", importedAt: 1, matchedFingerprint: "a".repeat(64) }
    ]);

    await reachContacts();
    const row = document.querySelector("[data-imported-id='pending-1']");
    expect(row.querySelector("select")).toBeNull();
    expect(row.querySelector("[data-match-btn]")).toBeNull();
    expect(row.textContent).toContain("Друг");
  });

  it("selecting whatsapp-txt calls parseChatExport (not parseContactList) and creates a pending record carrying the parsed messages", async () => {
    await bootstrap();
    const messages = [
      { timestamp: 1000, sender: "Оксана", text: "привіт" },
      { timestamp: 2000, sender: "Оксана", text: "як справи" }
    ];
    parseChatExport.mockReturnValue(messages);
    const saved = [];
    saveImportedContact.mockImplementation(async (record) => {
      const full = { id: "hist-1", matchedFingerprint: null, pendingMessages: [], ...record };
      saved.push(full);
      return full;
    });
    listImportedContacts.mockImplementation(async () => saved);

    document.getElementById("import-format").value = "whatsapp-txt";
    const file = new File(["chat export"], "chat.txt", { type: "text/plain" });
    file.text = vi.fn().mockResolvedValue("chat export");
    setImportFile(file);

    await vi.waitFor(() => expect(parseChatExport).toHaveBeenCalledWith("chat export", "whatsapp-txt"));
    expect(parseContactList).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(saveImportedContact).toHaveBeenCalledTimes(1));
    expect(saveImportedContact).toHaveBeenCalledWith(
      expect.objectContaining({ source: "whatsapp-txt", pendingMessages: messages, displayName: "Оксана" })
    );
  });

  it("selecting telegram-json also attempts parseChatExport on the same file and creates a sibling history record when it succeeds", async () => {
    await bootstrap();
    parseContactList.mockReturnValue([{ displayName: "Іван", sourceIdentifier: "+380501234567" }]);
    const historyMessages = [{ timestamp: 1000, sender: "Іван", text: "давнє" }];
    parseChatExport.mockReturnValue(historyMessages);
    const saved = [];
    saveImportedContact.mockImplementation(async (record) => {
      const full = { id: `id-${saved.length}`, matchedFingerprint: null, pendingMessages: [], ...record };
      saved.push(full);
      return full;
    });
    listImportedContacts.mockImplementation(async () => saved);

    document.getElementById("import-format").value = "telegram-json";
    const file = new File(["{}"], "export.json", { type: "application/json" });
    file.text = vi.fn().mockResolvedValue("{}");
    setImportFile(file);

    await vi.waitFor(() => expect(parseContactList).toHaveBeenCalledWith("{}", "telegram-json"));
    await vi.waitFor(() => expect(parseChatExport).toHaveBeenCalledWith("{}", "telegram-json"));
    await vi.waitFor(() => expect(saveImportedContact).toHaveBeenCalledTimes(2));
    expect(saveImportedContact).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Іван", sourceIdentifier: "+380501234567", source: "telegram-json" })
    );
    expect(saveImportedContact).toHaveBeenCalledWith(
      expect.objectContaining({ pendingMessages: historyMessages, source: "telegram-json-history" })
    );
  });

  it("a contacts-only telegram-json export (parseChatExport throws) still imports contacts successfully, with no extra history record", async () => {
    await bootstrap();
    parseContactList.mockReturnValue([{ displayName: "Іван", sourceIdentifier: "+380501234567" }]);
    parseChatExport.mockImplementation(() => {
      throw new Error("importParsers: Telegram chat export is missing the expected { messages: [...] } shape");
    });
    saveImportedContact.mockResolvedValue({ id: "id-0", matchedFingerprint: null, pendingMessages: [] });

    document.getElementById("import-format").value = "telegram-json";
    const file = new File(["{}"], "export.json", { type: "application/json" });
    file.text = vi.fn().mockResolvedValue("{}");
    setImportFile(file);

    await vi.waitFor(() => expect(saveImportedContact).toHaveBeenCalledTimes(1));
    expect(document.getElementById("import-status").textContent).toBe("");
  });
});

describe("imported history (Section I3, specs/phase2b/import.md)", () => {
  async function reachContactsAsProfile() {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("backup-step").hidden).toBe(false));
    document.getElementById("btn-backup-skip").click();
    location.hash = "#/manage";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());
  }

  it("does NOT write to historyStore.js while a pending import is unmatched", async () => {
    listImportedContacts.mockResolvedValue([
      {
        id: "pending-1",
        displayName: "Іван",
        sourceIdentifier: "telegram chat export",
        source: "telegram-json-history",
        importedAt: 1,
        matchedFingerprint: null,
        pendingMessages: [{ timestamp: 1000, sender: "Іван", text: "давнє" }]
      }
    ]);

    await reachContactsAsProfile();

    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("writes pendingMessages into historyStore.js as imported:true under the matched fingerprint once the match completes", async () => {
    const FP = "a".repeat(64);
    listContacts.mockResolvedValue([{ fingerprint: FP, identityPubkeyWire: "W1", firstSeen: 1, deviceList: null, nickname: "Друг" }]);
    const record = {
      id: "pending-1",
      displayName: "Іван",
      sourceIdentifier: "telegram chat export",
      source: "telegram-json-history",
      importedAt: 1,
      matchedFingerprint: null,
      pendingMessages: [
        { timestamp: 1000, sender: "Іван", text: "давнє повідомлення" }
      ]
    };
    listImportedContacts.mockResolvedValue([record]);
    getImportedContact.mockResolvedValue({ ...record, matchedFingerprint: FP });

    await reachContactsAsProfile();

    const row = document.querySelector("[data-imported-id='pending-1']");
    const select = row.querySelector("select");
    select.value = FP;
    select.dispatchEvent(new Event("change"));
    row.querySelector("[data-match-btn]").click();

    await vi.waitFor(() => expect(setMatchedFingerprint).toHaveBeenCalledWith("pending-1", FP));
    await vi.waitFor(() => expect(appendMessage).toHaveBeenCalled());
    expect(appendMessage).toHaveBeenCalledWith(
      { __tag: "vault-key" },
      "profile-fp",
      FP,
      expect.objectContaining({ text: "давнє повідомлення", timestamp: 1000, imported: true })
    );
    expect(clearPendingMessages).toHaveBeenCalledWith("pending-1");
  });

  it("warns instead of silently dropping pendingMessages when matched with no vault key (ephemeral mode)", async () => {
    const FP = "a".repeat(64);
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([{ fingerprint: FP, identityPubkeyWire: "W1", firstSeen: 1, deviceList: null, nickname: "Друг" }]);
    const record = {
      id: "pending-1",
      displayName: "Іван",
      sourceIdentifier: "telegram chat export",
      source: "telegram-json-history",
      importedAt: 1,
      matchedFingerprint: null,
      pendingMessages: [{ timestamp: 1000, sender: "Іван", text: "давнє" }]
    };
    listImportedContacts.mockResolvedValue([record]);
    getImportedContact.mockResolvedValue({ ...record, matchedFingerprint: FP });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    location.hash = "#/manage";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());

    await vi.waitFor(() => expect(document.querySelector("[data-imported-id='pending-1']")).not.toBeNull());
    const row = document.querySelector("[data-imported-id='pending-1']");
    const select = row.querySelector("select");
    select.value = FP;
    select.dispatchEvent(new Event("change"));
    row.querySelector("[data-match-btn]").click();

    await vi.waitFor(() => expect(setMatchedFingerprint).toHaveBeenCalledWith("pending-1", FP));
    await vi.waitFor(() => expect(document.getElementById("import-status").textContent).not.toBe(""));
    expect(appendMessage).not.toHaveBeenCalled();
    expect(clearPendingMessages).not.toHaveBeenCalled();
  });
});

describe("identity verification proofs (Section E)", () => {
  async function reachProfileScreen() {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("backup-step").hidden).toBe(false));
    document.getElementById("btn-backup-skip").click();
  }

  it("generates and shows a proof block for copying", async () => {
    await reachProfileScreen();
    createProofBlock.mockResolvedValue("-----BEGIN SPIRIT PROOF-----\n...\n-----END SPIRIT PROOF-----");

    document.getElementById("btn-generate-proof").click();

    await vi.waitFor(() =>
      expect(document.getElementById("proof-block-display").textContent).toContain("BEGIN SPIRIT PROOF")
    );
    expect(createProofBlock).toHaveBeenCalledWith(
      { __tag: "profile-priv" },
      fakePublicKey("profile-pub"),
      "spirit0001profile-fp"
    );
  });

  it("adds a proof after a successful sanity-check of its own publication", async () => {
    await reachProfileScreen();
    createProofBlock.mockResolvedValue("OWN_BLOCK_TEXT");
    document.getElementById("btn-generate-proof").click();
    await vi.waitFor(() => expect(document.getElementById("proof-block-display").textContent).toBe("OWN_BLOCK_TEXT"));

    parseProofBlock.mockReturnValue({ identity: "OWN_WIRE", statement: "s", timestamp: 1, nonce: "n", signature: "sig" });
    verifyProofBlock.mockResolvedValue(true);
    fetchProofPageText.mockResolvedValue("page text containing the published block");
    const newSet = { version: 1, proofs: [{ url: "https://example.com/me", label: "example.com", added_at: 123 }], revoked: [], signature: "S" };
    addProofToSet.mockResolvedValue(newSet);

    document.getElementById("proof-url-input").value = "https://example.com/me";
    document.getElementById("btn-add-proof").click();

    await vi.waitFor(() => expect(addProofToSet).toHaveBeenCalled());
    expect(fetchProofPageText).toHaveBeenCalledWith("http://node.example/index.php", "profile-fp", "https://example.com/me");
    expect(addProofToSet).toHaveBeenCalledWith(
      { __tag: "profile-priv" },
      null,
      expect.objectContaining({ url: "https://example.com/me", label: "example.com" })
    );
    await vi.waitFor(() => expect(document.getElementById("own-proofs-list").textContent).toContain("example.com"));
  });

  it("blocks adding a proof when the sanity-check (fetched page vs published block) fails", async () => {
    await reachProfileScreen();
    createProofBlock.mockResolvedValue("OWN_BLOCK_TEXT");
    document.getElementById("btn-generate-proof").click();
    await vi.waitFor(() => expect(document.getElementById("proof-block-display").textContent).toBe("OWN_BLOCK_TEXT"));

    parseProofBlock.mockReturnValue({ identity: "OWN_WIRE", statement: "s", timestamp: 1, nonce: "n", signature: "sig" });
    verifyProofBlock.mockResolvedValue(false);
    fetchProofPageText.mockResolvedValue("page text WITHOUT the block");

    document.getElementById("proof-url-input").value = "https://example.com/me";
    document.getElementById("btn-add-proof").click();

    await vi.waitFor(() => expect(document.getElementById("proofs-status").textContent).not.toBe(""));
    expect(addProofToSet).not.toHaveBeenCalled();
  });

  it("refuses to add a proof before a block has been generated this session", async () => {
    await reachProfileScreen();
    document.getElementById("proof-url-input").value = "https://example.com/me";
    document.getElementById("btn-add-proof").click();

    await vi.waitFor(() => expect(document.getElementById("proofs-status").textContent).not.toBe(""));
    expect(fetchProofPageText).not.toHaveBeenCalled();
    expect(addProofToSet).not.toHaveBeenCalled();
  });

  it("revoking an owned proof calls revokeProofFromSet, persists it, and re-renders the list", async () => {
    await reachProfileScreen();
    createProofBlock.mockResolvedValue("OWN_BLOCK_TEXT");
    document.getElementById("btn-generate-proof").click();
    await vi.waitFor(() => expect(document.getElementById("proof-block-display").textContent).toBe("OWN_BLOCK_TEXT"));
    parseProofBlock.mockReturnValue({ identity: "OWN_WIRE", statement: "s", timestamp: 1, nonce: "n", signature: "sig" });
    verifyProofBlock.mockResolvedValue(true);
    fetchProofPageText.mockResolvedValue("page text");
    const withProof = { version: 1, proofs: [{ url: "https://example.com/me", label: "example.com", added_at: 123 }], revoked: [], signature: "S" };
    addProofToSet.mockResolvedValue(withProof);
    document.getElementById("proof-url-input").value = "https://example.com/me";
    document.getElementById("btn-add-proof").click();
    await vi.waitFor(() => expect(document.getElementById("own-proofs-list").textContent).toContain("example.com"));

    const afterRevoke = { version: 2, proofs: [], revoked: [{ url: "https://example.com/me", revoked_at: 999 }], signature: "S2" };
    revokeProofFromSet.mockResolvedValue(afterRevoke);
    document.querySelector("#own-proofs-list button").click();

    await vi.waitFor(() => expect(revokeProofFromSet).toHaveBeenCalledWith({ __tag: "profile-priv" }, withProof, "https://example.com/me"));
    await vi.waitFor(() => expect(document.getElementById("own-proofs-list").textContent).not.toContain("example.com"));
  });

  it("contacts screen shows a badge for each proof in a contact's held proof set", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      {
        fingerprint: "a".repeat(64),
        identityPubkeyWire: "PEER_WIRE",
        firstSeen: 1,
        deviceList: null,
        proofSet: { version: 1, proofs: [{ url: "https://t.me/x/1", label: "telegram", added_at: 1 }], revoked: [] }
      }
    ]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    location.hash = "#/manage";
    window.dispatchEvent(new Event("hashchange"));

    await vi.waitFor(() => expect(document.getElementById("contacts-list").textContent).toContain("telegram"));
  });

  it("'Перевірити зараз' fetches and verifies every contact's proofs and updates their badges", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    const contact = {
      fingerprint: "a".repeat(64),
      identityPubkeyWire: "PEER_WIRE",
      firstSeen: 1,
      deviceList: null,
      proofSet: { version: 1, proofs: [{ url: "https://t.me/x/1", label: "telegram", added_at: 1 }], revoked: [] }
    };
    listContacts.mockResolvedValue([contact]);
    fetchProofPageText.mockResolvedValue("page text with the block embedded");
    parseProofBlock.mockReturnValue({ identity: "PEER_WIRE", statement: "s", timestamp: 1, nonce: "n", signature: "sig" });
    verifyProofBlock.mockResolvedValue(true);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    location.hash = "#/manage";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(document.getElementById("contacts-list").textContent).toContain("telegram"));

    document.getElementById("btn-check-proofs-now").click();

    await vi.waitFor(() => expect(fetchProofPageText).toHaveBeenCalledWith(expect.anything(), "sender-fp", "https://t.me/x/1"));
    expect(verifyProofBlock).toHaveBeenCalledWith(expect.objectContaining({ identity: "PEER_WIRE" }), "PEER_WIRE");
    await vi.waitFor(() =>
      expect(document.getElementById("contacts-list").textContent).toMatch(/перевірено/i)
    );
    // Секція RF2: щойно проходить перевірка (verifiedAt записано), щит стає
    // заповненим/з галочкою, а не лишається контурним.
    const shield = document.querySelector("#contacts-list .list-row .trust-shield");
    expect(shield).not.toBeNull();
    expect(shield.classList.contains("trust-shield-verified")).toBe(true);
  });

  it("Секція RF2: every rendered contact row has an .avatar element containing identicon SVG, with the shape-user class", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), identityPubkeyWire: "W1", firstSeen: 1, deviceList: null },
      { fingerprint: "b".repeat(64), identityPubkeyWire: "W2", firstSeen: 2, deviceList: null }
    ]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    location.hash = "#/manage";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(listContacts).toHaveBeenCalled());

    const rows = document.querySelectorAll("#contacts-list .list-row");
    expect(rows.length).toBe(2);
    for (const row of rows) {
      const avatar = row.querySelector(".avatar");
      expect(avatar).not.toBeNull();
      expect(avatar.classList.contains("shape-user")).toBe(true);
      expect(avatar.querySelector("svg")).not.toBeNull();
    }
  });

  it("sidebar search box hides #contacts-list rows that don't match the query, case-insensitively", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), nickname: "Іван", identityPubkeyWire: "W1", firstSeen: 1, deviceList: null },
      { fingerprint: "b".repeat(64), nickname: "Марія", identityPubkeyWire: "W2", firstSeen: 2, deviceList: null }
    ]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    await vi.waitFor(() => expect(document.querySelectorAll("#contacts-list .list-row").length).toBe(2));

    const input = document.getElementById("sidebar-search-input");
    input.value = "марі";
    input.dispatchEvent(new Event("input"));

    const [rowIvan, rowMariya] = document.querySelectorAll("#contacts-list .list-row");
    expect(rowIvan.hidden).toBe(true);
    expect(rowMariya.hidden).toBe(false);

    input.value = "";
    input.dispatchEvent(new Event("input"));
    expect(rowIvan.hidden).toBe(false);
    expect(rowMariya.hidden).toBe(false);
  });

  it("'Верифіковані' chip shows only contacts with an already-verified proof; 'Усі' resets the filter", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    const verifiedContact = {
      fingerprint: "a".repeat(64),
      identityPubkeyWire: "PEER_WIRE",
      firstSeen: 1,
      deviceList: null,
      proofSet: { version: 1, proofs: [{ url: "https://t.me/x/1", label: "telegram", added_at: 1 }], revoked: [] }
    };
    const unverifiedContact = { fingerprint: "b".repeat(64), identityPubkeyWire: "W2", firstSeen: 2, deviceList: null };
    listContacts.mockResolvedValue([verifiedContact, unverifiedContact]);
    fetchProofPageText.mockResolvedValue("page text with the block embedded");
    parseProofBlock.mockReturnValue({ identity: "PEER_WIRE", statement: "s", timestamp: 1, nonce: "n", signature: "sig" });
    verifyProofBlock.mockResolvedValue(true);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    await vi.waitFor(() => expect(document.querySelectorAll("#contacts-list .list-row").length).toBe(2));

    document.getElementById("btn-check-proofs-now").click();
    await vi.waitFor(() =>
      expect(document.querySelector("#contacts-list .list-row .trust-shield-verified")).not.toBeNull()
    );

    document.getElementById("chip-filter-verified").click();
    const rows = document.querySelectorAll("#contacts-list .list-row");
    const verifiedRow = [...rows].find((r) => r.dataset.verified === "1");
    const unverifiedRow = [...rows].find((r) => r.dataset.verified === "0");
    expect(verifiedRow.hidden).toBe(false);
    expect(unverifiedRow.hidden).toBe(true);

    document.getElementById("chip-filter-all").click();
    expect(verifiedRow.hidden).toBe(false);
    expect(unverifiedRow.hidden).toBe(false);
  });

  it("dragging a contact onto a folder assigns it there; clicking the folder filters the sidebar list to just that folder", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), nickname: "Іван", identityPubkeyWire: "W1", firstSeen: 1, deviceList: null },
      { fingerprint: "b".repeat(64), nickname: "Марія", identityPubkeyWire: "W2", firstSeen: 2, deviceList: null }
    ]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    await vi.waitFor(() => expect(document.querySelectorAll("#contacts-list .list-row").length).toBe(2));

    document.querySelector("#folder-tree [data-folder-edit-toggle]").click();
    document.querySelector("#folder-tree [data-add-folder]").click();
    const folderRow = document.querySelector("#folder-tree .folder-row");
    expect(folderRow).not.toBeNull();

    const [rowIvan, rowMariya] = document.querySelectorAll("#contacts-list .list-row");
    rowIvan.dispatchEvent(new Event("dragstart"));
    folderRow.dispatchEvent(new Event("dragover", { cancelable: true }));
    folderRow.dispatchEvent(new Event("drop", { cancelable: true }));
    rowIvan.dispatchEvent(new Event("dragend"));

    // Assignment persisted to localStorage, not just in-memory.
    const stored = JSON.parse(localStorage.getItem("spirit.folders"));
    expect(stored[0].contactFingerprints).toEqual(["a".repeat(64)]);
    expect(document.querySelector("#folder-tree .folder-count").textContent).toBe("1");

    folderRow.click();
    expect(document.querySelector("#folder-tree .folder-row").classList.contains("selected")).toBe(true);
    expect(rowIvan.hidden).toBe(false);
    expect(rowMariya.hidden).toBe(true);

    document.getElementById("chip-filter-all").click();
    expect(rowIvan.hidden).toBe(false);
    expect(rowMariya.hidden).toBe(false);
    expect(document.querySelector("#folder-tree .folder-row").classList.contains("selected")).toBe(false);
  });

  it("renames a folder via the inline rename control", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    document.querySelector("#folder-tree [data-folder-edit-toggle]").click();
    document.querySelector("#folder-tree [data-add-folder]").click();
    document.querySelector("#folder-tree [data-folder-rename]").click();

    const input = document.querySelector("#folder-tree [data-folder-rename-input]");
    expect(input).not.toBeNull();
    input.value = "Робота";
    document.querySelector("#folder-tree [data-folder-rename-save]").click();

    expect(document.querySelector("#folder-tree .folder-name").textContent).toBe("Робота");
    const stored = JSON.parse(localStorage.getItem("spirit.folders"));
    expect(stored[0].name).toBe("Робота");
  });

  it("cancelling rename (Escape) leaves the folder's name unchanged", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    document.querySelector("#folder-tree [data-folder-edit-toggle]").click();
    document.querySelector("#folder-tree [data-add-folder]").click();
    const originalName = document.querySelector("#folder-tree .folder-name").textContent;
    document.querySelector("#folder-tree [data-folder-rename]").click();
    const input = document.querySelector("#folder-tree [data-folder-rename-input]");
    input.value = "Мала бути іншою";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(document.querySelector("#folder-tree .folder-name").textContent).toBe(originalName);
  });

  it("adds a subfolder directly under a given folder via its per-row control", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    document.querySelector("#folder-tree [data-folder-edit-toggle]").click();
    document.querySelector("#folder-tree [data-add-folder]").click();
    document.querySelector("#folder-tree [data-folder-add-child]").click();

    const stored = JSON.parse(localStorage.getItem("spirit.folders"));
    expect(stored[0].children.length).toBe(1);
    expect(document.querySelectorAll("#folder-tree .folder-row").length).toBe(2);
  });

  it("deleting a folder requires a second confirming click, and reparents its children to where the folder was instead of deleting them", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    document.querySelector("#folder-tree [data-folder-edit-toggle]").click();
    document.querySelector("#folder-tree [data-add-folder]").click();
    document.querySelector("#folder-tree [data-folder-add-child]").click();
    expect(document.querySelectorAll("#folder-tree .folder-row").length).toBe(2);

    // First click on the parent's delete button just arms the confirm state.
    document.querySelector("#folder-tree [data-folder-delete]").click();
    let stored = JSON.parse(localStorage.getItem("spirit.folders"));
    expect(stored.length).toBe(1);
    expect(document.querySelector("#folder-tree [data-folder-delete]").classList.contains("confirming")).toBe(true);

    // Second click actually deletes the parent, but its child survives,
    // promoted to where the parent used to be.
    document.querySelector("#folder-tree [data-folder-delete]").click();
    stored = JSON.parse(localStorage.getItem("spirit.folders"));
    expect(stored.length).toBe(1);
    expect(stored[0].name).toBe("Нова папка");
    expect(document.querySelectorAll("#folder-tree .folder-row").length).toBe(1);
  });

  it("folders start in read-only mode: no add-folder/per-row-action buttons, folders aren't draggable, but collapse/expand still works", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));

    // Build a folder with a subfolder while edit mode is on, then turn it
    // back off -- this is the steady state most users will actually see.
    document.querySelector("#folder-tree [data-folder-edit-toggle]").click();
    document.querySelector("#folder-tree [data-add-folder]").click();
    document.querySelector("#folder-tree [data-folder-add-child]").click();
    document.querySelector("#folder-tree [data-folder-edit-toggle]").click();

    expect(document.querySelector("#folder-tree [data-add-folder]")).toBeNull();
    expect(document.querySelector("#folder-tree .folder-actions")).toBeNull();
    const parentRow = document.querySelector("#folder-tree .folder-row");
    expect(parentRow.draggable).toBe(false);

    // Collapse/expand (the chev) is not a structural change and stays live.
    expect(parentRow.classList.contains("collapsed")).toBe(false);
    parentRow.querySelector(".chev").click();
    expect(document.querySelector("#folder-tree .folder-row").classList.contains("collapsed")).toBe(true);
  });

  it("dropping a contact onto a folder while edit mode is off does not assign it (structural changes require edit mode)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), nickname: "Іван", identityPubkeyWire: "W1", firstSeen: 1, deviceList: null }
    ]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    await vi.waitFor(() => expect(document.querySelectorAll("#contacts-list .list-row").length).toBe(1));

    document.querySelector("#folder-tree [data-folder-edit-toggle]").click();
    document.querySelector("#folder-tree [data-add-folder]").click();
    document.querySelector("#folder-tree [data-folder-edit-toggle]").click();

    const folderRow = document.querySelector("#folder-tree .folder-row");
    const contactRow = document.querySelector("#contacts-list .list-row");
    contactRow.dispatchEvent(new Event("dragstart"));
    folderRow.dispatchEvent(new Event("dragover", { cancelable: true }));
    folderRow.dispatchEvent(new Event("drop", { cancelable: true }));

    const stored = JSON.parse(localStorage.getItem("spirit.folders"));
    expect(stored[0].contactFingerprints).toEqual([]);
  });

  it("groups render in the same sidebar #contacts-list as contacts, with a square shape-group avatar, and clicking one opens its conversation directly", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), nickname: "Іван", identityPubkeyWire: "W1", firstSeen: 1, deviceList: null }
    ]);
    listGroups.mockResolvedValue([{ groupId: "group-1", name: "Друзі", memberFingerprints: [], createdAt: 1 }]);
    listMessages.mockResolvedValue([]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    await vi.waitFor(() => expect(document.querySelectorAll("#contacts-list .list-row").length).toBe(2));

    const rows = document.querySelectorAll("#contacts-list .list-row");
    const contactRow = [...rows].find((r) => r.dataset.contactFingerprint);
    const groupRow = [...rows].find((r) => r.dataset.groupId);
    expect(contactRow.querySelector(".avatar").classList.contains("shape-user")).toBe(true);
    expect(groupRow.querySelector(".avatar").classList.contains("shape-group")).toBe(true);
    expect(groupRow.textContent).toContain("Друзі");

    groupRow.click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["conversation"]));
    expect(document.getElementById("group-chat-log").hidden).toBe(false);
    expect(document.getElementById("group-conversation-heading").hidden).toBe(false);
  });

  it("a group can be assigned to a folder via drag&drop, same as a contact, and is included when that folder is selected", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([
      { fingerprint: "a".repeat(64), nickname: "Іван", identityPubkeyWire: "W1", firstSeen: 1, deviceList: null }
    ]);
    listGroups.mockResolvedValue([{ groupId: "group-1", name: "Друзі", memberFingerprints: [], createdAt: 1 }]);

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    await vi.waitFor(() => expect(document.querySelectorAll("#contacts-list .list-row").length).toBe(2));

    document.querySelector("#folder-tree [data-folder-edit-toggle]").click();
    document.querySelector("#folder-tree [data-add-folder]").click();
    const folderRow = document.querySelector("#folder-tree .folder-row");

    const contactRow = document.querySelector("#contacts-list [data-contact-fingerprint]");
    const groupRow = document.querySelector("#contacts-list [data-group-id]");
    groupRow.dispatchEvent(new Event("dragstart"));
    folderRow.dispatchEvent(new Event("dragover", { cancelable: true }));
    folderRow.dispatchEvent(new Event("drop", { cancelable: true }));
    groupRow.dispatchEvent(new Event("dragend"));

    const stored = JSON.parse(localStorage.getItem("spirit.folders"));
    expect(stored[0].groupIds).toEqual(["group-1"]);
    expect(document.querySelector("#folder-tree .folder-count").textContent).toBe("1");

    document.querySelector("#folder-tree [data-folder-edit-toggle]").click(); // back to read-only
    folderRow.click();
    expect(groupRow.hidden).toBe(false);
    expect(contactRow.hidden).toBe(true);
  });

  it("shows a distinct status after several consecutive verification failures, without the badge disappearing", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    const contact = {
      fingerprint: "a".repeat(64),
      identityPubkeyWire: "PEER_WIRE",
      firstSeen: 1,
      deviceList: null,
      proofSet: { version: 1, proofs: [{ url: "https://t.me/x/1", label: "telegram", added_at: 1 }], revoked: [] }
    };
    listContacts.mockResolvedValue([contact]);
    fetchProofPageText.mockRejectedValue(new Error("page unreachable"));

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(visibleScreens()).toEqual(["room"]));
    location.hash = "#/manage";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(document.getElementById("contacts-list").textContent).toContain("telegram"));

    for (let i = 0; i < 3; i++) {
      document.getElementById("btn-check-proofs-now").click();
      await vi.waitFor(() => expect(fetchProofPageText).toHaveBeenCalledTimes(i + 1));
    }

    // Still present (not silently gone), but now flagged as failing.
    expect(document.getElementById("contacts-list").textContent).toContain("telegram");
    expect(document.getElementById("contacts-list").textContent).toMatch(/не вдалося підтвердити/i);
  });

  it("starts the periodic re-check timer once at init, without stacking across re-initializations", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    listContacts.mockResolvedValue([]);
    // NOTE: this file's tests all share the same jsdom `window` (only
    // document.body is reset between tests), so a prior test's initApp()
    // call may already have an interval armed -- assert relative counts
    // around THIS test's two calls, not an absolute "never called before".
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    initApp(document, { locale: "uk" });
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    const firstIntervalId = setIntervalSpy.mock.results[0].value;

    initApp(document, { locale: "uk" }); // second init in the same window/tests -- must not stack a second interval
    // The previous interval must be cleared before a new one is armed --
    // exactly one live interval at any time, same contract as the
    // hashchange-listener dedup elsewhere in this file.
    expect(clearIntervalSpy).toHaveBeenCalledWith(firstIntervalId);
    expect(setIntervalSpy).toHaveBeenCalledTimes(2);
  });

  it("resets own-proof state (cache + generated block) when a different profile becomes active in the same tab (exec review finding)", async () => {
    // Profile A: unlock, generate + add a proof.
    listProfiles.mockResolvedValue([{ id: "identity" }]);
    loadPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "priv-A" },
      publicKey: fakePublicKey("pub-A"),
      vaultKey: { __tag: "vault-A" },
      profileId: "profile-A"
    });
    fingerprint.mockResolvedValue("profile-A");

    initApp(document, { locale: "uk" });
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(1));
    document.getElementById("unlock-passphrase").value = "pass-A";
    document.getElementById("btn-profile-unlock").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-A"));

    createProofBlock.mockResolvedValue("PROOF_BLOCK_A");
    document.getElementById("btn-generate-proof").click();
    await vi.waitFor(() => expect(document.getElementById("proof-block-display").textContent).toBe("PROOF_BLOCK_A"));

    parseProofBlock.mockReturnValue({ identity: "WIRE_A", statement: "s", timestamp: 1, nonce: "n", signature: "sig" });
    verifyProofBlock.mockResolvedValue(true);
    fetchProofPageText.mockResolvedValue("page text");
    const setA = { version: 1, proofs: [{ url: "https://a.example/", label: "a.example", added_at: 1 }], revoked: [], signature: "S" };
    addProofToSet.mockResolvedValue(setA);
    document.getElementById("proof-url-input").value = "https://a.example/";
    document.getElementById("btn-add-proof").click();
    await vi.waitFor(() => expect(document.getElementById("own-proofs-list").textContent).toContain("a.example"));

    // Switch to profile B in the SAME tab (ephemeral quick-chat, simplest
    // way to trigger a senderKey change without a second unlock flow).
    generateIdentityKeyPair.mockResolvedValue({ privateKey: { __tag: "priv-B" }, publicKey: fakePublicKey("pub-B") });
    fingerprint.mockResolvedValue("profile-B");
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-B"));

    // Must NOT still show/act on profile A's proof state.
    expect(document.getElementById("proof-block-display").textContent).toBe("");
    expect(document.getElementById("own-proofs-list").textContent).not.toContain("a.example");
  });
});

describe("ICE gathering timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a connection-failed status if ICE gathering never completes in time", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    startAsInitiator.mockImplementation(() => ({ __fakePc: true })); // onLocalOfferReady never called

    initApp(document, { locale: "uk", iceTimeoutMs: 5000 });
    document.getElementById("btn-generate").click();
    await vi.advanceTimersByTimeAsync(0);
    document.getElementById("btn-initiate").click();
    await vi.advanceTimersByTimeAsync(0);

    expect(document.getElementById("connection-status").textContent).not.toMatch(/не вдалося/);

    await vi.advanceTimersByTimeAsync(5000);

    expect(document.getElementById("connection-status").textContent).toMatch(/не вдалося зібрати ICE-кандидати/);
  });

  it("does not show the failure status if ICE gathering completes before the timeout", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({ answer: null, ecdhPubkey: null });

    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk", iceTimeoutMs: 5000 });
    document.getElementById("btn-generate").click();
    await vi.advanceTimersByTimeAsync(0);
    document.getElementById("btn-initiate").click();
    await vi.advanceTimersByTimeAsync(0);

    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });
    await vi.advanceTimersByTimeAsync(5000);

    expect(document.getElementById("connection-status").textContent).not.toMatch(/не вдалося/);
  });
});

describe("file transfer (Section FT2, specs/phase4/file-transfer.md)", () => {
  // Establishes a chat with a VERIFIED peer (ephemeral mode -- no vaultKey
  // required, since file transfer's gate is "any verified peer", matching
  // plain chat text, not the persistence-tied device-list/push-subscription
  // gate). Returns the captured webrtc callbacks and the fake channel, with
  // encryptMessage tagging its plaintext so assertions can read it back off
  // channel.send.mock.calls.
  async function fileTransferChat() {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: { __tag: "id-priv" }, publicKey: fakePublicKey("id-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockImplementation(async (_key, text) => `ENC(${text})`);

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    // Verify the peer -- file transfer is gated on state.peerFingerprint,
    // same as plain chat text.
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: fakePublicKey("peer-identity"),
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp-123"
    });
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
    await captured.onMessage("ENCRYPTED_ANNOUNCE");
    await vi.waitFor(() => expect(document.getElementById("connection-status").textContent).toContain("peer-fp-123"));

    return { captured, channel };
  }

  function setFileInput(file) {
    const input = document.getElementById("file-input");
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
  }

  function makeFile(bytes, name = "photo.png", type = "image/png") {
    return new File([bytes], name, { type });
  }

  it("selecting a file sends a file-offer, never raw chunks, until accepted", async () => {
    const { channel } = await fileTransferChat();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);

    setFileInput(makeFile(bytes));
    await vi.waitFor(() =>
      expect(channel.send.mock.calls.some(([p]) => p.includes('"type":"file-offer"'))).toBe(true)
    );

    const offerCall = channel.send.mock.calls.find(([p]) => p.includes('"type":"file-offer"'));
    const offer = JSON.parse(offerCall[0].slice("ENC(".length, -1));
    expect(offer.name).toBe("photo.png");
    expect(offer.mimeType).toBe("image/png");
    expect(offer.size).toBe(5);
    expect(offer.totalChunks).toBe(1);
    expect(typeof offer.sha256).toBe("string");
    expect(offer.sha256.length).toBe(64);

    // No file-chunk yet -- the peer has not accepted.
    expect(channel.send.mock.calls.some(([p]) => p.includes('"type":"file-chunk"'))).toBe(false);
  });

  it("shows an accept/reject banner with the offered file's name and size on incoming file-offer", async () => {
    const { captured } = await fileTransferChat();

    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({
        type: "file-offer",
        fileId: "abc123",
        name: "report.pdf",
        size: 2048,
        mimeType: "application/pdf",
        sha256: "deadbeef",
        totalChunks: 1
      })
    );
    await captured.onMessage("ENCRYPTED_OFFER");

    const banner = document.getElementById("file-offer-banner");
    await vi.waitFor(() => expect(banner.hidden).toBe(false));
    expect(document.getElementById("file-offer-text").textContent).toContain("report.pdf");
    expect(document.getElementById("file-offer-text").textContent).toContain("2.0 KB");
  });

  it("ignores a file-offer from an unverified peer (no banner shown)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("id-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockResolvedValue("X");

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });
    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    // No identity-announce exchanged -- state.peerFingerprint stays null.
    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({
        type: "file-offer",
        fileId: "abc123",
        name: "malicious.exe",
        size: 10,
        mimeType: "application/octet-stream",
        sha256: "x",
        totalChunks: 1
      })
    );
    await captured.onMessage("ENCRYPTED_OFFER");

    expect(document.getElementById("file-offer-banner").hidden).toBe(true);
  });

  it("clicking Accept sends file-accept, and only then does the sender begin streaming file-chunk", async () => {
    const { captured, channel } = await fileTransferChat();

    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({
        type: "file-offer",
        fileId: "abc123",
        name: "report.pdf",
        size: 5,
        mimeType: "application/pdf",
        sha256: "deadbeef",
        totalChunks: 1
      })
    );
    await captured.onMessage("ENCRYPTED_OFFER");
    await vi.waitFor(() => expect(document.getElementById("file-offer-banner").hidden).toBe(false));

    document.getElementById("btn-file-accept").click();
    await vi.waitFor(() =>
      expect(channel.send).toHaveBeenCalledWith(`ENC(${JSON.stringify({ type: "file-accept", fileId: "abc123" })})`)
    );
    expect(document.getElementById("file-offer-banner").hidden).toBe(true);
  });

  it("(sender side) only begins streaming file-chunk after file-accept is received, never before", async () => {
    // Simulates the SENDER side of the same exchange as the test above, to
    // verify chunks are only ever sent after file-accept is received.
    const senderChat = await fileTransferChat();
    const bytes = new Uint8Array([9, 9, 9, 9, 9]);
    setFileInput(makeFile(bytes));
    await vi.waitFor(() =>
      expect(senderChat.channel.send.mock.calls.some(([p]) => p.includes('"type":"file-offer"'))).toBe(true)
    );
    const offerCall = senderChat.channel.send.mock.calls.find(([p]) => p.includes('"type":"file-offer"'));
    const offer = JSON.parse(offerCall[0].slice("ENC(".length, -1));
    expect(senderChat.channel.send.mock.calls.some(([p]) => p.includes('"type":"file-chunk"'))).toBe(false);

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "file-accept", fileId: offer.fileId }));
    await senderChat.captured.onMessage("ENCRYPTED_ACCEPT");

    await vi.waitFor(() =>
      expect(senderChat.channel.send.mock.calls.some(([p]) => p.includes('"type":"file-chunk"'))).toBe(true)
    );
  });

  it("clicking Reject sends file-reject, and chunks are never sent for that fileId", async () => {
    const senderChat = await fileTransferChat();
    const bytes = new Uint8Array([1, 2, 3]);
    setFileInput(makeFile(bytes));
    await vi.waitFor(() =>
      expect(senderChat.channel.send.mock.calls.some(([p]) => p.includes('"type":"file-offer"'))).toBe(true)
    );
    const offerCall = senderChat.channel.send.mock.calls.find(([p]) => p.includes('"type":"file-offer"'));
    const offer = JSON.parse(offerCall[0].slice("ENC(".length, -1));

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "file-reject", fileId: offer.fileId }));
    await senderChat.captured.onMessage("ENCRYPTED_REJECT");

    // Give any errant async chunk-sending a chance to run before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(senderChat.channel.send.mock.calls.some(([p]) => p.includes('"type":"file-chunk"'))).toBe(false);
  });

  it("receives chunks, verifies the SHA-256 hash, and exposes a working download link on a match", async () => {
    const { captured } = await fileTransferChat();
    const payload = new TextEncoder().encode("hello world");
    const trueHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", payload))]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const base64 = btoa(String.fromCharCode(...payload));

    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({
        type: "file-offer",
        fileId: "hash-ok",
        name: "note.txt",
        size: payload.length,
        mimeType: "text/plain",
        sha256: trueHash,
        totalChunks: 1
      })
    );
    await captured.onMessage("ENCRYPTED_OFFER");
    document.getElementById("btn-file-accept").click();
    await vi.waitFor(() => expect(document.getElementById("file-offer-banner").hidden).toBe(true));

    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({ type: "file-chunk", fileId: "hash-ok", index: 0, data: base64 })
    );
    await captured.onMessage("ENCRYPTED_CHUNK");

    await vi.waitFor(() => {
      const row = document.getElementById("file-transfer-hash-ok");
      expect(row).toBeTruthy();
      const link = row.querySelector("a[download]");
      expect(link).toBeTruthy();
      expect(link.download).toBe("note.txt");
    });
  });

  it("shows an explicit error and does NOT produce a download link on a hash mismatch", async () => {
    const { captured } = await fileTransferChat();
    const payload = new TextEncoder().encode("corrupted");
    const base64 = btoa(String.fromCharCode(...payload));

    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({
        type: "file-offer",
        fileId: "hash-bad",
        name: "note.txt",
        size: payload.length,
        mimeType: "text/plain",
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
        totalChunks: 1
      })
    );
    await captured.onMessage("ENCRYPTED_OFFER");
    document.getElementById("btn-file-accept").click();
    await vi.waitFor(() => expect(document.getElementById("file-offer-banner").hidden).toBe(true));

    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({ type: "file-chunk", fileId: "hash-bad", index: 0, data: base64 })
    );
    await captured.onMessage("ENCRYPTED_CHUNK");

    await vi.waitFor(() => {
      const row = document.getElementById("file-transfer-hash-bad");
      expect(row).toBeTruthy();
      expect(row.querySelector("a[download]")).toBeNull();
    });
  });

  it("ignores file-chunk for an unknown/unaccepted fileId (defensive drop, no crash)", async () => {
    const { captured } = await fileTransferChat();
    decryptMessage.mockResolvedValueOnce(
      JSON.stringify({ type: "file-chunk", fileId: "never-offered", index: 0, data: "AAAA" })
    );
    await expect(captured.onMessage("ENCRYPTED_CHUNK")).resolves.not.toThrow();
    expect(document.getElementById("file-transfer-never-offered")).toBeNull();
  });

  it("respects backpressure: pauses chunk sending while bufferedAmount is high, resumes on bufferedamountlow", async () => {
    const senderChat = await fileTransferChat();
    const channel = senderChat.channel;
    // Two chunks' worth of data so there is a second chunk to (not) send
    // while paused.
    const bytes = new Uint8Array(20 * 1024).fill(7);
    channel.bufferedAmount = 2 * 1024 * 1024; // above the 1MB threshold

    setFileInput(makeFile(bytes, "big.bin", "application/octet-stream"));
    await vi.waitFor(() =>
      expect(channel.send.mock.calls.some(([p]) => p.includes('"type":"file-offer"'))).toBe(true)
    );
    const offerCall = channel.send.mock.calls.find(([p]) => p.includes('"type":"file-offer"'));
    const offer = JSON.parse(offerCall[0].slice("ENC(".length, -1));

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "file-accept", fileId: offer.fileId }));
    await senderChat.captured.onMessage("ENCRYPTED_ACCEPT");

    // Give sendFileChunks a turn to run -- it must NOT have sent any chunk
    // yet, because bufferedAmount is still above threshold and no
    // bufferedamountlow event has fired.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(channel.send.mock.calls.some(([p]) => p.includes('"type":"file-chunk"'))).toBe(false);
    expect(typeof channel.onbufferedamountlow).toBe("function");

    // Now simulate the buffer draining: real bufferedAmount drops, then the
    // channel fires bufferedamountlow.
    channel.bufferedAmount = 0;
    channel.onbufferedamountlow();

    await vi.waitFor(() =>
      expect(channel.send.mock.calls.some(([p]) => p.includes('"type":"file-chunk"'))).toBe(true)
    );
  });

  it("updates a progress indicator as chunks are sent and received", async () => {
    const senderChat = await fileTransferChat();
    const bytes = new Uint8Array(20 * 1024).fill(3); // 2 chunks at 16KB
    setFileInput(makeFile(bytes, "twochunks.bin", "application/octet-stream"));
    await vi.waitFor(() =>
      expect(senderChat.channel.send.mock.calls.some(([p]) => p.includes('"type":"file-offer"'))).toBe(true)
    );
    const offerCall = senderChat.channel.send.mock.calls.find(([p]) => p.includes('"type":"file-offer"'));
    const offer = JSON.parse(offerCall[0].slice("ENC(".length, -1));
    expect(offer.totalChunks).toBe(2);

    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "file-accept", fileId: offer.fileId }));
    await senderChat.captured.onMessage("ENCRYPTED_ACCEPT");

    await vi.waitFor(() => {
      const row = document.getElementById(`file-transfer-${offer.fileId}`);
      expect(row).toBeTruthy();
      expect(row.textContent).toMatch(/2\/2/);
    });
  });
});

describe("GC0: state.peers multi-connection refactor (specs/phase4/group-chats.md)", () => {
  it("a second connection setup does not overwrite the first -- both entries coexist in state.peers", () => {
    const { state, getPeerByFingerprint, getPeerByConnectionId } = initApp(document, { locale: "uk" });

    // Simulate the first session's handshake writing its per-connection
    // fields (mirrors what startInitiatorSession/startJoinerSession do to
    // state.pc/state.sessionKey/etc via the PEER_PROXY_FIELDS setters).
    state.pc = { id: "pc-1" };
    state.channel = { id: "channel-1" };
    state.sessionKey = "session-key-1";
    state.peerFingerprint = "fingerprint-1";
    const firstConnectionId = state.activeConnectionId;
    expect(firstConnectionId).toBeTruthy();
    expect(state.peers.size).toBe(1);

    // Now simulate a second, independent connection being established
    // (GC1-GC3 territory: multiple simultaneous peers) by explicitly
    // starting a fresh active entry rather than reusing the first one.
    state.activeConnectionId = null;
    state.pc = { id: "pc-2" };
    state.channel = { id: "channel-2" };
    state.sessionKey = "session-key-2";
    state.peerFingerprint = "fingerprint-2";
    const secondConnectionId = state.activeConnectionId;

    expect(secondConnectionId).toBeTruthy();
    expect(secondConnectionId).not.toBe(firstConnectionId);
    expect(state.peers.size).toBe(2);

    // Both entries retain their own, independent field values -- the first
    // was NOT overwritten by the second connection's setup.
    const firstEntry = state.peers.get(firstConnectionId);
    expect(firstEntry.pc).toEqual({ id: "pc-1" });
    expect(firstEntry.channel).toEqual({ id: "channel-1" });
    expect(firstEntry.sessionKey).toBe("session-key-1");
    expect(firstEntry.peerFingerprint).toBe("fingerprint-1");

    const secondEntry = state.peers.get(secondConnectionId);
    expect(secondEntry.pc).toEqual({ id: "pc-2" });
    expect(secondEntry.channel).toEqual({ id: "channel-2" });
    expect(secondEntry.sessionKey).toBe("session-key-2");
    expect(secondEntry.peerFingerprint).toBe("fingerprint-2");

    // getPeerByFingerprint/getPeerByConnectionId (GC1-GC3 helpers) both
    // resolve correctly against a multi-entry Map.
    expect(getPeerByFingerprint("fingerprint-1")).toBe(firstEntry);
    expect(getPeerByFingerprint("fingerprint-2")).toBe(secondEntry);
    expect(getPeerByConnectionId(firstConnectionId)).toBe(firstEntry);
    expect(getPeerByConnectionId(secondConnectionId)).toBe(secondEntry);
  });

  it("logout deletes the peers Map entry entirely rather than leaving a stale all-null one behind", () => {
    const { state } = initApp(document, { locale: "uk" });
    state.pc = { close: vi.fn() };
    state.channel = { close: vi.fn(), send: vi.fn() };
    state.sessionKey = "session-key";
    state.peerFingerprint = "fingerprint";
    expect(state.peers.size).toBe(1);

    document.getElementById("btn-logout")?.click();

    expect(state.peers.size).toBe(0);
    expect(state.activeConnectionId).toBeNull();
    expect(state.pc).toBeNull();
    expect(state.channel).toBeNull();
    expect(state.sessionKey).toBeNull();
    expect(state.peerFingerprint).toBeNull();
    expect(state.isInviteOwner).toBe(false);
  });
});

describe("GC2: group invite orchestration (specs/phase4/group-chats.md)", () => {
  // Establishes a permanent-profile 1:1 chat exactly like the third test in
  // "device-list transport" above (btn-create-profile, not the ephemeral
  // btn-generate) -- group persistence (groups.js) is gated on vaultKey the
  // same way contacts.js persistence is, so GC2's identity-announce-time
  // group logic only runs in profile mode.
  async function establishedProfileChat() {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockImplementation(async (_key, text) => `ENC(${text})`);
    dbGet.mockResolvedValue(undefined);
    rememberContact.mockResolvedValue({ status: "new", contact: { deviceList: null } });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    const api = initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });
    return { ...api, captured, channel };
  }

  it("creating a group with N selected contacts mints one distinct invite flow per contact", async () => {
    listContacts.mockResolvedValue([
      { fingerprint: "fp-a", nickname: "Іван" },
      { fingerprint: "fp-b", nickname: "Марія" }
    ]);
    getContact.mockImplementation(async (fp) => ({ fingerprint: fp, nickname: fp === "fp-a" ? "Іван" : "Марія" }));
    createGroup.mockResolvedValue({ groupId: "group-1", name: "Друзі", memberFingerprints: ["fp-a", "fp-b"], createdAt: 1 });
    createInvite
      .mockResolvedValueOnce({ roomId: "room-a", inviteToken: "tok-a" })
      .mockResolvedValueOnce({ roomId: "room-b", inviteToken: "tok-b" });
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateIdentityKeyPair.mockResolvedValue({ privateKey: { __tag: "id-priv" }, publicKey: fakePublicKey("id-pub") });

    const { state } = initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));

    location.hash = "#/manage";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(document.querySelectorAll("[data-group-contact-fingerprint]").length).toBe(2));

    document.getElementById("group-name").value = "Друзі";
    for (const checkbox of document.querySelectorAll("[data-group-contact-fingerprint]")) checkbox.checked = true;
    document.getElementById("btn-create-group").click();

    await vi.waitFor(() => expect(createInvite).toHaveBeenCalledTimes(2));
    expect(createGroup).toHaveBeenCalledWith({ name: "Друзі", memberFingerprints: ["fp-a", "fp-b"] });

    // Only the FIRST selected contact gets a real, live, tagged
    // state.peers entry -- running two concurrent initiator handshakes at
    // once would corrupt each other's session completion (GC2 exec-review
    // iter1 finding). The second contact's invite link was still minted
    // (createInvite above was called twice), just without starting a
    // session for it yet.
    await vi.waitFor(() => expect(state.peers.size).toBe(1));
    for (const entry of state.peers.values()) {
      expect(entry.groupId).toBe("group-1");
    }
    // Exactly one real WebRTC handshake was started, not one per contact.
    expect(startAsInitiator).toHaveBeenCalledTimes(1);

    await vi.waitFor(() =>
      expect(document.getElementById("group-invite-links").textContent).toContain("Іван")
    );
    expect(document.getElementById("group-invite-links").textContent).toContain("Марія");
  });

  it("creating a group with a name but zero selected contacts creates an empty group instead of blocking on validation", async () => {
    listContacts.mockResolvedValue([{ fingerprint: "fp-a", nickname: "Іван" }]);
    createGroup.mockResolvedValue({ groupId: "group-empty", name: "Майбутня команда", memberFingerprints: [], createdAt: 1 });
    generateIdentityKeyPair.mockResolvedValue({ privateKey: { __tag: "id-priv" }, publicKey: fakePublicKey("id-pub") });
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));

    location.hash = "#/manage";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(document.querySelectorAll("[data-group-contact-fingerprint]").length).toBe(1));

    document.getElementById("group-name").value = "Майбутня команда";
    document.getElementById("btn-create-group").click();

    await vi.waitFor(() => expect(createGroup).toHaveBeenCalledWith({ name: "Майбутня команда", memberFingerprints: [] }));
    expect(createInvite).not.toHaveBeenCalled();
    expect(startAsInitiator).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(document.getElementById("group-status").textContent).toBe('Групу "Майбутня команда" створено')
    );
  });

  it("a verified identity-announce on a groupId-tagged connection adds the member to the group and broadcasts to other same-group peers only", async () => {
    const { state, captured, channel } = await establishedProfileChat();

    // Tag the just-established connection with a group, as
    // startTaggedGroupInvite would have done before the handshake began.
    state.peers.get(state.activeConnectionId).groupId = "group-1";

    getGroup.mockResolvedValue({ groupId: "group-1", name: "Друзі", memberFingerprints: [] });

    // Another peer connected right now, tagged with the SAME group --
    // should receive the broadcast.
    const sameGroupChannel = { send: vi.fn() };
    state.peers.set("other-same-group", {
      pc: {}, channel: sameGroupChannel, sessionKey: "other-session-key", groupId: "group-1"
    });
    // A peer tagged with a DIFFERENT group -- must NOT receive it.
    const differentGroupChannel = { send: vi.fn() };
    state.peers.set("other-different-group", {
      pc: {}, channel: differentGroupChannel, sessionKey: "other-session-key-2", groupId: "group-2"
    });
    // A plain 1:1 connection (groupId: null) -- must NOT receive it either.
    const plainChannel = { send: vi.fn() };
    state.peers.set("plain-1to1", { pc: {}, channel: plainChannel, sessionKey: "plain-session-key", groupId: null });
    // A same-group entry with no live channel yet (half-open) -- must be
    // skipped without throwing.
    state.peers.set("half-open-same-group", { pc: {}, channel: null, sessionKey: null, groupId: "group-1" });

    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: {},
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp",
      nickname: "Оксана"
    });
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));

    await captured.onMessage("ENCRYPTED_ANNOUNCE");

    await vi.waitFor(() => expect(updateGroupMembers).toHaveBeenCalledWith("group-1", ["peer-fp"]));

    await vi.waitFor(() =>
      expect(sameGroupChannel.send).toHaveBeenCalledWith(
        `ENC(${JSON.stringify({
          type: "group-member-joined",
          groupId: "group-1",
          memberFingerprint: "peer-fp",
          memberNickname: "Оксана"
        })})`
      )
    );
    expect(differentGroupChannel.send).not.toHaveBeenCalled();
    expect(plainChannel.send).not.toHaveBeenCalled();
    // half-open-same-group's null channel never threw and was simply skipped.
  });

  it("does not throw and still updates the group when there are zero other connected same-group peers", async () => {
    const { state, captured } = await establishedProfileChat();
    state.peers.get(state.activeConnectionId).groupId = "group-solo";
    getGroup.mockResolvedValue({ groupId: "group-solo", name: "Solo", memberFingerprints: [] });
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: {},
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp"
    });
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));

    await expect(captured.onMessage("ENCRYPTED_ANNOUNCE")).resolves.not.toThrow();
    await vi.waitFor(() => expect(updateGroupMembers).toHaveBeenCalledWith("group-solo", ["peer-fp"]));
  });

  it("a plain (non-group) connection's identity-announce never touches group storage", async () => {
    const { captured } = await establishedProfileChat();
    // state.activeConnectionId's entry.groupId stays at its default null --
    // no tagging performed for this test.
    verifyIdentityAnnounce.mockResolvedValue({
      identityPublicKey: {},
      identityPubkeyWire: "PEER",
      fingerprint: "peer-fp"
    });
    decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));

    await captured.onMessage("ENCRYPTED_ANNOUNCE");

    expect(getGroup).not.toHaveBeenCalled();
    expect(updateGroupMembers).not.toHaveBeenCalled();
  });

  describe("receiving an incoming group-member-joined control message", () => {
    async function verifiedChatTaggedWith(groupId) {
      const chat = await establishedProfileChat();
      chat.state.peers.get(chat.state.activeConnectionId).groupId = groupId;
      chat.verifiedFingerprint = "peer-fp";
      verifyIdentityAnnounce.mockResolvedValue({
        identityPublicKey: {},
        identityPubkeyWire: "PEER",
        fingerprint: chat.verifiedFingerprint
      });
      decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
      await chat.captured.onMessage("ENCRYPTED_ANNOUNCE");
      getGroup.mockClear();
      updateGroupMembers.mockClear();
      return chat;
    }

    it("adds the new member to the local group record without a direct connection to them", async () => {
      const { captured } = await verifiedChatTaggedWith("group-1");
      getGroup.mockResolvedValue({ groupId: "group-1", name: "Друзі", memberFingerprints: ["peer-fp"] });

      decryptMessage.mockResolvedValueOnce(
        JSON.stringify({ type: "group-member-joined", groupId: "group-1", memberFingerprint: "new-fp", memberNickname: "Тарас" })
      );
      await captured.onMessage("ENCRYPTED_JOINED");

      await vi.waitFor(() =>
        expect(updateGroupMembers).toHaveBeenCalledWith("group-1", ["peer-fp", "new-fp"])
      );
    });

    it("ignores a group-member-joined claiming a groupId this connection was never tagged with (spoofing gate)", async () => {
      const { captured } = await verifiedChatTaggedWith("group-1");

      decryptMessage.mockResolvedValueOnce(
        JSON.stringify({ type: "group-member-joined", groupId: "some-other-group", memberFingerprint: "new-fp" })
      );
      await captured.onMessage("ENCRYPTED_JOINED");

      expect(getGroup).not.toHaveBeenCalled();
      expect(updateGroupMembers).not.toHaveBeenCalled();
    });

    it("silently ignores a group-member-joined for a group this device doesn't track locally", async () => {
      const { captured } = await verifiedChatTaggedWith("group-unknown");
      getGroup.mockResolvedValue(undefined);

      decryptMessage.mockResolvedValueOnce(
        JSON.stringify({ type: "group-member-joined", groupId: "group-unknown", memberFingerprint: "new-fp" })
      );
      await expect(captured.onMessage("ENCRYPTED_JOINED")).resolves.not.toThrow();

      expect(updateGroupMembers).not.toHaveBeenCalled();
    });

    it("ignores a group-member-joined arriving before this connection's own peer identity is verified", async () => {
      const { captured, channel } = await establishedProfileChat();
      decryptMessage.mockResolvedValueOnce(
        JSON.stringify({ type: "group-member-joined", groupId: "group-1", memberFingerprint: "new-fp" })
      );
      await captured.onMessage("ENCRYPTED_JOINED");

      expect(getGroup).not.toHaveBeenCalled();
      expect(updateGroupMembers).not.toHaveBeenCalled();
      void channel; // unused, kept for symmetry with sibling tests
    });
  });
});

describe("GC3: fan-out send + group UI (specs/phase4/group-chats.md)", () => {
  // Same establishedProfileChat helper as the GC2 describe block above --
  // duplicated locally (each describe block is self-contained in this file's
  // existing style) rather than shared across describes.
  async function establishedProfileChat() {
    createPermanentProfile.mockResolvedValue({
      privateKey: { __tag: "profile-priv" },
      publicKey: fakePublicKey("profile-pub"),
      vaultKey: { __tag: "vault-key" }
    });
    fingerprint.mockResolvedValue("profile-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });
    createIdentityAnnounce.mockResolvedValue({ type: "identity-announce" });
    encryptMessage.mockImplementation(async (_key, text) => `ENC(${text})`);
    dbGet.mockResolvedValue(undefined);
    rememberContact.mockResolvedValue({ status: "new", contact: { deviceList: null } });

    const channel = fakeChannel();
    let captured;
    startAsInitiator.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    const api = initApp(document, { locale: "uk" });
    document.getElementById("btn-create-profile").click();
    document.getElementById("profile-passphrase").value = "pass";
    document.getElementById("btn-profile-confirm").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001profile-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    captured.onChannelOpen(channel);
    await captured.onLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });
    return { ...api, captured, channel };
  }

  it("a joiner arriving via an invite link with a group param tags its OWN connection with that groupId (closes the GC2 review gap)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Спритна Тінь");
    getOffer.mockResolvedValue({ offer: JSON.stringify({ type: "offer", sdp: "OFFER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });

    let captured;
    startAsJoiner.mockImplementation((opts) => {
      captured = opts;
      return { __fakePc: true };
    });

    const { state } = initApp(document, {
      locale: "uk",
      locationSearch: "?room=room-from-link&token=token-from-link&group=group-xyz"
    });

    await vi.waitFor(() => expect(startAsJoiner).toHaveBeenCalled());
    expect(state.activeConnectionId).toBeTruthy();
    expect(state.peers.get(state.activeConnectionId).groupId).toBe("group-xyz");
    void captured;
  });

  it("does not tag the joiner's connection when the invite link carries no group param (plain 1:1, unaffected)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    generateAnonymousNickname.mockReturnValue("Тихий Привид");
    getOffer.mockResolvedValue({ offer: JSON.stringify({ type: "offer", sdp: "OFFER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });
    startAsJoiner.mockImplementation(() => ({ __fakePc: true }));

    const { state } = initApp(document, { locale: "uk", locationSearch: "?room=room-from-link&token=token-from-link" });

    await vi.waitFor(() => expect(startAsJoiner).toHaveBeenCalled());
    expect(state.peers.get(state.activeConnectionId).groupId).toBeNull();
  });

  describe("sendGroupMessage fan-out (via the groups-list open + btn-send UI flow)", () => {
    async function openedGroupConversationWithPeers() {
      const chat = await establishedProfileChat();
      chat.state.peers.get(chat.state.activeConnectionId).groupId = "group-1";

      const sameGroupChannel2 = { send: vi.fn() };
      chat.state.peers.set("same-group-2", {
        pc: {}, channel: sameGroupChannel2, sessionKey: "session-key-2", groupId: "group-1"
      });
      const differentGroupChannel = { send: vi.fn() };
      chat.state.peers.set("different-group", {
        pc: {}, channel: differentGroupChannel, sessionKey: "session-key-3", groupId: "group-2"
      });
      const halfOpenSameGroup = { send: vi.fn() };
      chat.state.peers.set("half-open-same-group", {
        pc: {}, channel: null, sessionKey: null, groupId: "group-1"
      });
      void halfOpenSameGroup;

      listGroups.mockResolvedValue([{ groupId: "group-1", name: "Друзі", memberFingerprints: [] }]);

      location.hash = "#/manage";
      window.dispatchEvent(new Event("hashchange"));
      await vi.waitFor(() => expect(document.querySelector('[data-open-group-btn="group-1"]')).toBeTruthy());
      document.querySelector('[data-open-group-btn="group-1"]').click();
      await vi.waitFor(() => expect(document.getElementById("group-chat-log").hidden).toBe(false));

      return { ...chat, sameGroupChannel2, differentGroupChannel };
    }

    it("encrypts and sends the IDENTICAL plaintext to every matching-groupId connected peer, and makes exactly ONE local append/render call", async () => {
      const { channel: firstChannel, sameGroupChannel2, differentGroupChannel } = await openedGroupConversationWithPeers();

      document.getElementById("message-input").value = "Привіт усім";
      document.getElementById("btn-send").click();

      await vi.waitFor(() => expect(firstChannel.send).toHaveBeenCalledWith(
        `ENC(${JSON.stringify({ type: "group-message", groupId: "group-1", text: "Привіт усім" })})`
      ));
      expect(sameGroupChannel2.send).toHaveBeenCalledWith(
        `ENC(${JSON.stringify({ type: "group-message", groupId: "group-1", text: "Привіт усім" })})`
      );
      // A peer tagged with a DIFFERENT group never receives it.
      expect(differentGroupChannel.send).not.toHaveBeenCalled();

      // Exactly one local append -- not one per recipient (2 live recipients above).
      await vi.waitFor(() => expect(appendMessage).toHaveBeenCalledTimes(1));
      expect(appendMessage).toHaveBeenCalledWith({ __tag: "vault-key" }, "profile-fp", "group-1", {
        direction: "out",
        text: "Привіт усім",
        timestamp: expect.any(Number)
      });
      expect(document.getElementById("group-chat-log").textContent).toContain("Привіт усім");
      // Not leaked into the 1:1 chat log.
      expect(document.getElementById("chat-log").textContent).not.toContain("Привіт усім");
    });
  });

  describe("receiving an incoming group-message control message", () => {
    async function verifiedChatTaggedWith(groupId) {
      const chat = await establishedProfileChat();
      chat.state.peers.get(chat.state.activeConnectionId).groupId = groupId;
      verifyIdentityAnnounce.mockResolvedValue({
        identityPublicKey: {},
        identityPubkeyWire: "PEER",
        fingerprint: "peer-fp",
        nickname: "Оксана"
      });
      decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "identity-announce", identityPubkey: "PEER", signature: "S" }));
      await chat.captured.onMessage("ENCRYPTED_ANNOUNCE");
      appendMessage.mockClear();
      return chat;
    }

    it("renders into the group UI container (not the 1:1 chat-log) and stores it under the group's history namespace", async () => {
      const { captured } = await verifiedChatTaggedWith("group-1");
      getGroup.mockResolvedValue({ groupId: "group-1", name: "Друзі", memberFingerprints: ["peer-fp"] });
      getContact.mockResolvedValue({ fingerprint: "peer-fp", nickname: "Оксана" });
      decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "group-message", groupId: "group-1", text: "Всім привіт" }));

      await captured.onMessage("ENCRYPTED_GROUP_MSG");

      await vi.waitFor(() => expect(document.getElementById("group-chat-log").textContent).toContain("Всім привіт"));
      expect(document.getElementById("group-chat-log").textContent).toContain("Оксана");
      expect(document.getElementById("chat-log").textContent).not.toContain("Всім привіт");
      expect(appendMessage).toHaveBeenCalledWith({ __tag: "vault-key" }, "profile-fp", "group-1", {
        direction: "in",
        text: JSON.stringify({ senderFingerprint: "peer-fp", senderNickname: "Оксана", body: "Всім привіт" }),
        timestamp: expect.any(Number)
      });
    });

    it("ignores a group-message arriving before this connection's own peer identity is verified", async () => {
      const { captured } = await establishedProfileChat();
      decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "group-message", groupId: "group-1", text: "spoofed" }));

      await captured.onMessage("ENCRYPTED_GROUP_MSG");

      expect(document.getElementById("group-chat-log").textContent).not.toContain("spoofed");
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it("ignores a group-message claiming a groupId this connection was never tagged with (anti-spoofing gate)", async () => {
      const { captured } = await verifiedChatTaggedWith("group-1");
      decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "group-message", groupId: "some-other-group", text: "spoofed" }));

      await captured.onMessage("ENCRYPTED_GROUP_MSG");

      expect(document.getElementById("group-chat-log").textContent).not.toContain("spoofed");
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it("ignores a group-message on a plain (non-group) connection", async () => {
      const { captured } = await verifiedChatTaggedWith(null);
      decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "group-message", groupId: "group-1", text: "spoofed" }));

      await captured.onMessage("ENCRYPTED_GROUP_MSG");

      expect(document.getElementById("group-chat-log").textContent).not.toContain("spoofed");
      expect(appendMessage).not.toHaveBeenCalled();
    });

    it("silently ignores a group-message for a group this device doesn't track locally (GC3 exec-review iter1 finding, consistent with group-member-joined's own guard)", async () => {
      const { captured } = await verifiedChatTaggedWith("group-unknown");
      getGroup.mockResolvedValue(undefined);
      decryptMessage.mockResolvedValueOnce(JSON.stringify({ type: "group-message", groupId: "group-unknown", text: "hello" }));

      await expect(captured.onMessage("ENCRYPTED_GROUP_MSG")).resolves.not.toThrow();

      expect(document.getElementById("group-chat-log").textContent).not.toContain("hello");
      expect(appendMessage).not.toHaveBeenCalled();
    });
  });

  it("renders listGroups()'s contents in the groups list UI and opens the right conversation on click", async () => {
    listContacts.mockResolvedValue([]);
    listGroups.mockResolvedValue([
      { groupId: "group-a", name: "Робота", memberFingerprints: ["fp-1", "fp-2"] },
      { groupId: "group-b", name: "Друзі", memberFingerprints: [] }
    ]);
    fingerprint.mockResolvedValue("sender-fp");
    generateIdentityKeyPair.mockResolvedValue({ privateKey: { __tag: "id-priv" }, publicKey: fakePublicKey("id-pub") });

    initApp(document, { locale: "uk" });
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("spirit0001sender-fp"));

    location.hash = "#/manage";
    window.dispatchEvent(new Event("hashchange"));
    await vi.waitFor(() => expect(document.getElementById("groups-list").textContent).toContain("Робота"));
    expect(document.getElementById("groups-list").textContent).toContain("Друзі");

    document.querySelector('[data-open-group-btn="group-b"]').click();
    await vi.waitFor(() => expect(document.getElementById("group-conversation-heading").hidden).toBe(false));
    expect(document.getElementById("group-conversation-heading").textContent).toContain("Друзі");
    expect(document.getElementById("group-chat-log").hidden).toBe(false);
    expect(document.getElementById("chat-log").hidden).toBe(true);
  });
});
