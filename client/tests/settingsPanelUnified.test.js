// @vitest-environment jsdom
// Section U1 (specs/ui/settings-render-unification.md, backlog D5): the
// four settings panels expose ONE combined re-render entry point, so a
// future fifth panel cannot be forgotten in the language-switch handler
// (the bug class caught twice before). DOM equivalence of the refactored
// renderers is pinned by the existing panel tests in app.test.js.
import { describe, it, expect } from "vitest";
import { initSettingsPanelUI } from "../js/settingsPanelUI.js";

describe("settings panel unified render (Section U1)", () => {
  it("initSettingsPanelUI returns renderAllSettingsPanels, which renders every panel list", () => {
    document.body.innerHTML = `
      <div id="settings-registry-list"></div>
      <div id="design-settings-list"></div>
      <div id="footer-settings-list"></div>
      <div id="feature-flags-list"></div>`;
    const api = initSettingsPanelUI({
      doc: document,
      el: (id) => document.getElementById(id),
      t: (key) => key
    });
    expect(typeof api.renderAllSettingsPanels).toBe("function");
    // ALL four lists (footer included -- exec-review note: leaving one out
    // of this loop would let renderAllSettingsPanels silently drop a panel,
    // defeating the section's whole point).
    const lists = ["settings-registry-list", "design-settings-list", "footer-settings-list", "feature-flags-list"];
    for (const id of lists) document.getElementById(id).innerHTML = "";
    api.renderAllSettingsPanels();
    for (const id of lists) {
      expect({ id, rendered: document.getElementById(id).children.length > 0 }).toEqual({ id, rendered: true });
    }
  });
});
