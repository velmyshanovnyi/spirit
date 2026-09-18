// @vitest-environment jsdom
// Section R1 (specs/phase5/app-decomposition.md, backlog A4): the recovery
// domain extracted out of app.js's initApp() closure. Behavioral coverage
// stays in app.test.js (Sections S2/S3) -- this file only pins the module
// boundary: the init signature and the two functions app.js consumes.
import { describe, it, expect } from "vitest";
import { initRecoveryUI } from "../js/recoveryUI.js";

describe("recoveryUI module boundary (Section R1)", () => {
  it("initRecoveryUI returns the two functions app.js consumes", () => {
    document.body.innerHTML = "";
    const api = initRecoveryUI({
      doc: document,
      el: (id) => document.getElementById(id),
      t: (key) => key,
      state: {},
      withBusyButton: () => {},
      setDynamicText: () => {},
      resetOwnProofsState: () => {},
      renderGuestQuickActions: () => {},
      renderNotificationsCard: () => {},
      refreshProfileSelector: async () => {},
      readSessionTtlHours: () => 0,
      postIdentityRoute: () => "room",
      navigate: () => {}
    });
    expect(typeof api.renderRecoveryCard).toBe("function");
    expect(typeof api.drainRecoveryShareOutboxForPeer).toBe("function");
  });

  it("renderRecoveryCard hides the card for a non-permanent profile without touching anything else", async () => {
    document.body.innerHTML = '<div id="recovery-card"></div>';
    const api = initRecoveryUI({
      doc: document,
      el: (id) => document.getElementById(id),
      t: (key) => key,
      state: { identityKeyPair: null },
      withBusyButton: () => {},
      setDynamicText: () => {},
      resetOwnProofsState: () => {},
      renderGuestQuickActions: () => {},
      renderNotificationsCard: () => {},
      refreshProfileSelector: async () => {},
      readSessionTtlHours: () => 0,
      postIdentityRoute: () => "room",
      navigate: () => {}
    });
    await api.renderRecoveryCard();
    expect(document.getElementById("recovery-card").hidden).toBe(true);
  });
});
