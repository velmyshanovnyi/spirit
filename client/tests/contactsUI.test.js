// @vitest-environment jsdom
// Section R5 (specs/phase5/app-decomposition.md, backlog A4): the contacts
// sidebar/screen + live proof re-checking extracted out of app.js.
// Behavioral coverage stays in app.test.js -- this pins the module boundary.
import { describe, it, expect, vi } from "vitest";
import { initContactsUI } from "../js/contactsUI.js";

vi.mock("../js/contacts.js", () => ({
  listContacts: vi.fn(async () => []),
  getContact: vi.fn()
}));
vi.mock("../js/groups.js", () => ({ listGroups: vi.fn(async () => []) }));
import { listContacts } from "../js/contacts.js";

function boot() {
  document.body.innerHTML = `
    <div id="contacts-list"></div>
    <p id="contacts-empty"></p>`;
  return initContactsUI({
    doc: document,
    el: (id) => document.getElementById(id),
    t: (key) => key,
    state: {},
    win: window,
    navigate: () => {},
    applyContactsFilter: () => {},
    setContactDragFingerprint: () => {},
    setGroupDragId: () => {},
    openGroupConversation: () => {},
    initiateChatSession: async () => {},
    renderGroupsCard: async () => {},
    renderImportedContactsScreen: async () => {}
  });
}

describe("contactsUI module boundary (Section R5)", () => {
  it("initContactsUI returns the two functions app.js consumes", () => {
    const api = boot();
    expect(typeof api.renderContactsScreen).toBe("function");
    expect(typeof api.checkContactProofs).toBe("function");
  });

  it("renders the empty state for no contacts, and a row with a message button for one", async () => {
    const api = boot();
    await api.renderContactsScreen();
    expect(document.getElementById("contacts-empty").hidden).toBe(false);

    listContacts.mockResolvedValueOnce([{ fingerprint: "fp1", nickname: "Оля", proofSet: null }]);
    await api.renderContactsScreen();
    const row = document.querySelector("[data-contact-fingerprint='fp1']");
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("Оля");
    expect(row.querySelector("[data-i18n='contacts.message']")).not.toBeNull();
    expect(document.getElementById("contacts-empty").hidden).toBe(true);
  });
});
