// @vitest-environment jsdom
// Section R8 (specs/phase5/app-decomposition.md, backlog A4): push
// notifications toggle extracted out of app.js. Pins the module boundary.
import { describe, it, expect, vi } from "vitest";
import { initNotificationsUI, ownPushSubscriptionKey } from "../js/notificationsUI.js";

vi.mock("../js/db.js", () => ({ put: vi.fn() }));

function boot(state) {
  document.body.innerHTML = `
    <div id="notifications-card">
      <input id="notifications-enabled" type="checkbox">
      <div id="notifications-status"></div>
    </div>`;
  return initNotificationsUI({ doc: document, el: (id) => document.getElementById(id), t: (k) => k, state });
}

describe("notificationsUI module boundary (Section R8)", () => {
  it("exports ownPushSubscriptionKey and hides/shows the card by vaultKey", () => {
    expect(ownPushSubscriptionKey("abc")).toBe("pushSubscription:abc");
    const state = { identityKeyPair: null };
    const api = boot(state);
    const card = document.getElementById("notifications-card");
    expect(card.hidden).toBe(true); // init renders once at startup
    state.identityKeyPair = { vaultKey: {} };
    api.renderNotificationsCard();
    expect(card.hidden).toBe(false);
  });

  it("checking the toggle without a Notification API unchecks it and reports notSupported", async () => {
    boot({ identityKeyPair: { vaultKey: {} } });
    const box = document.getElementById("notifications-enabled");
    expect("Notification" in window).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(box.checked).toBe(false));
    expect(document.getElementById("notifications-status").textContent).toBe("notifications.notSupported");
  });
});
