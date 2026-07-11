// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../js/identity.js", () => ({
  generateIdentityKeyPair: vi.fn(),
  generateEcdhKeyPair: vi.fn(),
  fingerprint: vi.fn(),
  exportEcdhPublicKeyForWire: vi.fn().mockResolvedValue("ECDH_PUB_WIRE"),
  importEcdhPublicKeyFromWire: vi.fn().mockResolvedValue({ __tag: "restored-peer-ecdh-pub" }),
  exportPrivateKeyScalar: vi.fn(),
  exportPrivateKeyRaw: vi.fn()
}));
vi.mock("../js/profile.js", () => ({
  createPermanentProfile: vi.fn(),
  exportRawIdentity: vi.fn(),
  listProfiles: vi.fn().mockResolvedValue([]),
  loadPermanentProfile: vi.fn(),
  setNickname: vi.fn(),
  getNickname: vi.fn().mockResolvedValue(null)
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
  listContacts: vi.fn().mockResolvedValue([])
}));
vi.mock("../js/proofSet.js", () => ({
  acceptNewerProofSet: vi.fn(),
  signProofSet: vi.fn(),
  addProofToSet: vi.fn(),
  revokeProofFromSet: vi.fn()
}));
vi.mock("../js/historyStore.js", () => ({
  appendMessage: vi.fn(),
  listMessages: vi.fn().mockResolvedValue([]),
  listConversations: vi.fn().mockResolvedValue([])
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
  applyRenegotiationAnswer: vi.fn()
}));
vi.mock("../js/signalingClient.js", () => ({
  createInvite: vi.fn(),
  createOffer: vi.fn(),
  getOffer: vi.fn(),
  submitAnswer: vi.fn(),
  pollForAnswer: vi.fn()
}));
vi.mock("../js/e2ee.js", () => ({
  deriveSessionKey: vi.fn(),
  encryptMessage: vi.fn(),
  decryptMessage: vi.fn()
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
  exportPrivateKeyRaw
} from "../js/identity.js";
import { createPermanentProfile, exportRawIdentity, listProfiles, loadPermanentProfile, setNickname, getNickname } from "../js/profile.js";
import {
  generateDeviceKeyPair,
  createLinkRequest,
  createLinkGrant,
  applyLinkGrant,
  appendDeviceToList,
  acceptNewerDeviceList
} from "../js/deviceLinking.js";
import { createIdentityAnnounce, verifyIdentityAnnounce } from "../js/identityAnnounce.js";
import { rememberContact, getContact, updateContactDeviceList, updateContactProofSet, listContacts } from "../js/contacts.js";
import { acceptNewerProofSet, signProofSet, addProofToSet, revokeProofFromSet } from "../js/proofSet.js";
import { get as dbGet, put as dbPut } from "../js/db.js";
import { appendMessage, listMessages, listConversations } from "../js/historyStore.js";
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
import { encryptMessage, decryptMessage, deriveSessionKey } from "../js/e2ee.js";
import { promptGoogleSignIn, verifyGoogleIdToken } from "../js/googleOAuth.js";
import { initApp } from "../js/app.js";

const ROUTES = ["account", "profile", "server", "room", "conversation", "contacts", "history"];

const HTML = `
  <button id="theme-toggle" type="button"></button>
  <select id="lang-select"></select>
  <nav>
    ${ROUTES.map((r) => `<a class="nav-item" data-route="${r}" href="#/${r}">${r}</a>`).join("")}
  </nav>

  <section data-screen="account">
    <h2 id="account-heading" data-i18n="section.account"></h2>
    <div id="account-login-block" hidden>
      <select id="profile-select"></select>
      <input id="unlock-passphrase" type="password">
      <button id="btn-profile-unlock" type="button">Увійти</button>
    </div>
    <button id="btn-generate" type="button">Швидкий чат</button>
    <button id="btn-create-profile" type="button">Створити профіль</button>
    <div id="profile-setup" hidden>
      <input id="nickname-input" type="text">
      <input id="profile-passphrase" type="password">
      <button id="btn-profile-confirm" type="button">Створити</button>
    </div>
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
  </section>

  <section data-screen="server">
    <input id="server-url" type="text" value="http://node.example/index.php">
    <input id="stun-url" type="text" value="stun:stun.example:19302">
    <div id="admin-login-form">
      <input id="admin-password" type="password">
      <button id="btn-admin-login" type="button">Увійти</button>
    </div>
    <div id="admin-status"></div>
    <div id="admin-config-list" hidden></div>
  </section>

  <section data-screen="room">
    <input id="room-id" type="text">
    <input id="invite-token" type="text">
    <button id="btn-initiate" type="button">Ініціювати чат</button>
    <button id="btn-join" type="button">Приєднатися до чату</button>
    <div id="connection-status" data-i18n="conn.none">не з'єднано</div>
    <button id="btn-copy-invite" type="button">Скопіювати запрошення</button>
    <div id="invite-link-display"></div>
    <div id="invite-status"></div>
  </section>

  <section data-screen="conversation">
    <video id="video-remote"></video>
    <video id="video-local"></video>
    <button id="btn-start-call" type="button"></button>
    <button id="btn-toggle-camera" type="button"></button>
    <button id="btn-toggle-mic" type="button"></button>
    <div id="video-status"></div>
    <div id="chat-log"></div>
    <input id="message-input" type="text">
    <button id="btn-send" type="button">Надіслати</button>
  </section>

  <section data-screen="contacts">
    <div id="contacts-list"></div>
    <p id="contacts-empty"></p>
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
    expect(createInvite).toHaveBeenCalledWith("http://node.example/index.php", "sender-fp");

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
  it("refuses to send before a session key exists, instead of throwing", async () => {
    initApp(document, { locale: "uk" });
    document.getElementById("message-input").value = "привіт";
    document.getElementById("btn-send").click();
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/немає активного з'єднання/)
    );
    expect(encryptMessage).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalled());

    expect(encryptMessage).toHaveBeenCalledWith({ __tag: "session-key" }, "привіт");
    expect(channel.send).toHaveBeenCalledWith("ENCRYPTED_PAYLOAD");
    expect(channel.send).not.toHaveBeenCalledWith("привіт");
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
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalled());

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
      await vi.waitFor(() => expect(channel.send).toHaveBeenCalledWith(`ENC(${word})`));
    }

    const log = document.getElementById("chat-log").textContent;
    expect(log.indexOf("один")).toBeLessThan(log.indexOf("два"));
    expect(log.indexOf("два")).toBeLessThan(log.indexOf("три"));
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
    const offerMsg = { type: "webrtc-call-offer", sdp: { type: "offer", sdp: "PEER_OFFER" } };
    decryptMessage.mockResolvedValueOnce(JSON.stringify(offerMsg));
    await captured.onMessage("ENCRYPTED_CALL_OFFER");

    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    expect(createRenegotiationAnswer).not.toHaveBeenCalled();
  });

  it("applies an incoming call answer via applyRenegotiationAnswer", async () => {
    const { captured, pc } = await establishedInitiatorChat();
    const answerMsg = { type: "webrtc-call-answer", sdp: { type: "answer", sdp: "PEER_ANSWER" } };
    decryptMessage.mockResolvedValueOnce(JSON.stringify(answerMsg));
    await captured.onMessage("ENCRYPTED_CALL_ANSWER");

    await vi.waitFor(() => expect(applyRenegotiationAnswer).toHaveBeenCalledWith(pc, answerMsg.sdp));
  });

  it("sets the remote video's srcObject when a media track arrives", async () => {
    const { captured } = await establishedInitiatorChat();
    const remoteStream = fakeStream([fakeTrack("video")]);
    captured.onRemoteTrack(remoteStream);
    expect(document.getElementById("video-remote").srcObject).toBe(remoteStream);
  });

  it("toggles the camera/mic tracks without requesting getUserMedia again", async () => {
    const localTracks = [fakeTrack("video"), fakeTrack("audio")];
    const stream = fakeStream(localTracks);
    navigator.mediaDevices.getUserMedia.mockResolvedValue(stream);
    createRenegotiationOffer.mockResolvedValue({ type: "offer", sdp: "RENEG_OFFER" });

    await establishedInitiatorChat();
    document.getElementById("btn-start-call").click();
    await vi.waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));

    document.getElementById("btn-toggle-camera").click();
    expect(localTracks[0].enabled).toBe(false);
    document.getElementById("btn-toggle-mic").click();
    expect(localTracks[1].enabled).toBe(false);
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

    location.hash = "#/contacts";
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
