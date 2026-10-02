// @vitest-environment jsdom
// Section R7 (specs/phase5/app-decomposition.md, backlog A4): profile /
// account handlers extracted out of app.js. Behavioral coverage stays in
// app.test.js -- this pins the module boundary.
import { describe, it, expect, vi } from "vitest";
import { initProfileUI } from "../js/profileUI.js";

vi.mock("../js/profile.js", () => ({
  listProfiles: vi.fn(async () => [{ id: "fp-old" }, { id: "fp-recent" }]),
  loadPermanentProfile: vi.fn(),
  createPermanentProfile: vi.fn(),
  setNickname: vi.fn(),
  getNickname: vi.fn(),
  adoptScalarIdentity: vi.fn()
}));
vi.mock("../js/session.js", () => ({
  rememberSession: vi.fn(),
  getRememberedProfileId: vi.fn(() => "fp-old"),
  recordRecentAccount: vi.fn(),
  getRecentAccounts: vi.fn(() => ["fp-recent"])
}));

function boot(state) {
  document.body.innerHTML = `
    <select id="profile-select"></select>
    <div id="account-login-block" hidden></div>
    <div id="account-create-mode"></div>
    <a id="link-switch-to-login"></a>
    <a id="link-switch-to-create"></a>
    <a id="link-toggle-portable-login"></a>
    <form id="portable-login-form" hidden></form>
    <div id="portable-login-status"></div>
    <div id="profile-status"></div>
    <button id="btn-create-profile"></button>
    <div id="profile-setup" hidden></div>
    <input id="portable-account-checkbox" type="checkbox">
    <input id="profile-passphrase">
    <button id="btn-backup-skip"></button>
    <div id="backup-step"></div>
    <div id="backup-reminder" hidden></div>`;
  return initProfileUI({
    doc: document,
    el: (id) => document.getElementById(id),
    t: (key) => key,
    state,
    withBusyButton: () => {},
    setDynamicText: () => {},
    resetOwnProofsState: () => {},
    renderGuestQuickActions: () => {},
    renderNotificationsCard: () => {},
    renderRecoveryCard: () => {},
    readSessionTtlHours: () => 24,
    postIdentityRoute: () => "profile",
    navigate: () => {}
  });
}

describe("profileUI module boundary (Section R7)", () => {
  it("returns refreshProfileSelector, which lists profiles MRU-first and preselects the remembered one", async () => {
    const api = boot({ senderKey: null });
    expect(typeof api.refreshProfileSelector).toBe("function");
    const select = document.getElementById("profile-select");
    // init fires the selector refresh itself (startup fire-and-forget); a
    // second explicit call must be idempotent, not double the options.
    await vi.waitFor(() => expect(select.options.length).toBe(2));
    await api.refreshProfileSelector();
    expect([...select.options].map((o) => o.value)).toEqual(["fp-recent", "fp-old"]);
    expect(select.value).toBe("fp-old");
    expect(document.getElementById("account-login-block").hidden).toBe(false);
    expect(document.getElementById("account-create-mode").hidden).toBe(true);
  });

  it("hides the login block once an identity is active, and the switch links flip the two blocks", async () => {
    boot({ senderKey: "fp-recent" });
    await vi.waitFor(() => expect(document.getElementById("profile-select").options.length).toBe(2));
    expect(document.getElementById("account-login-block").hidden).toBe(true);
    expect(document.getElementById("account-create-mode").hidden).toBe(false);
    document.getElementById("link-switch-to-login").click();
    expect(document.getElementById("account-login-block").hidden).toBe(false);
    expect(document.getElementById("account-create-mode").hidden).toBe(true);
    document.getElementById("link-switch-to-create").click();
    expect(document.getElementById("account-create-mode").hidden).toBe(false);
  });
});
