// @vitest-environment jsdom
// Section R3 (specs/phase5/app-decomposition.md, backlog A4): the Server
// screen's config domain (admin panel, STUN/TURN presets, signaling-node
// registry) extracted out of app.js. Behavioral coverage stays in
// app.test.js -- this file pins the module boundary.
import { describe, it, expect } from "vitest";
import { initServerConfigUI } from "../js/serverConfigUI.js";

describe("serverConfigUI module boundary (Section R3)", () => {
  it("renders the saved signaling nodes from localStorage on init", () => {
    document.body.innerHTML = `
      <div id="signaling-nodes-list"></div>
      <p id="signaling-nodes-empty"></p>`;
    localStorage.setItem("spirit.signalingNodes", JSON.stringify([
      { id: "n1", name: "Kolo", serverUrl: "https://spirit.kolo.media/spirit" }
    ]));
    initServerConfigUI({
      doc: document,
      el: (id) => document.getElementById(id),
      t: (key) => key,
      withBusyButton: () => {}
    });
    const list = document.getElementById("signaling-nodes-list");
    expect(list.textContent).toContain("Kolo");
    expect(document.getElementById("signaling-nodes-empty").hidden).toBe(true);
    localStorage.clear();
  });

  it("fails open to an empty list on malformed storage", () => {
    document.body.innerHTML = `
      <div id="signaling-nodes-list"></div>
      <p id="signaling-nodes-empty"></p>`;
    localStorage.setItem("spirit.signalingNodes", "{not json");
    initServerConfigUI({
      doc: document,
      el: (id) => document.getElementById(id),
      t: (key) => key,
      withBusyButton: () => {}
    });
    expect(document.getElementById("signaling-nodes-list").children.length).toBe(0);
    localStorage.clear();
  });
});
