// @vitest-environment jsdom
// Section R4 (specs/phase5/app-decomposition.md, backlog A4): the imported-
// contacts domain (Sections I2/I3) extracted out of app.js. Behavioral
// coverage stays in app.test.js -- this pins the module boundary.
import { describe, it, expect, vi } from "vitest";
import { initImportedContactsUI } from "../js/importedContactsUI.js";

vi.mock("../js/importedContacts.js", () => ({
  saveImportedContact: vi.fn(),
  listImportedContacts: vi.fn(async () => [{ id: "i1", displayName: "Old Friend", sourceIdentifier: "+380..." }]),
  getImportedContact: vi.fn(),
  setMatchedFingerprint: vi.fn(),
  deleteImportedContact: vi.fn(),
  clearPendingMessages: vi.fn()
}));
vi.mock("../js/contacts.js", () => ({ listContacts: vi.fn(async () => []) }));
vi.mock("../js/historyStore.js", () => ({ appendMessage: vi.fn() }));

function boot(state = {}) {
  document.body.innerHTML = `
    <p id="import-status"></p>
    <div id="import-pending-list"></div>
    <p id="import-pending-empty"></p>`;
  return initImportedContactsUI({
    doc: document,
    el: (id) => document.getElementById(id),
    t: (key) => key,
    state
  });
}

describe("importedContactsUI module boundary (Section R4)", () => {
  it("initImportedContactsUI returns renderImportedContactsScreen, which renders the pending list", async () => {
    const api = boot();
    expect(typeof api.renderImportedContactsScreen).toBe("function");
    await api.renderImportedContactsScreen();
    expect(document.getElementById("import-pending-list").textContent).toContain("Old Friend");
    expect(document.getElementById("import-pending-empty").hidden).toBe(true);
  });

  it("direction heuristic: only the active profile's own nickname maps to 'out'", async () => {
    const api = boot({ nickname: "  Марта " });
    expect(api.inferImportedDirection("марта")).toBe("out");
    expect(api.inferImportedDirection("хтось інший")).toBe("in");
    expect(boot({ nickname: "" }).inferImportedDirection("марта")).toBe("in");
  });
});
