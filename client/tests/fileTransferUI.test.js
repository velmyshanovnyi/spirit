// @vitest-environment jsdom
// Section C2 (specs/phase5/core-dispatch.md): the whole file-transfer domain
// (UI entry points + receiving-side control handlers) lives in
// fileTransferUI.js. Behavioural coverage stays in app.test.js -- this pins
// the module boundary.
import { describe, it, expect, vi } from "vitest";
import { initFileTransferUI } from "../js/fileTransferUI.js";

vi.mock("../js/e2ee.js", () => ({ encryptMessage: vi.fn(async (_k, text) => `ENC(${text})`) }));
vi.mock("../js/settingsRegistry.js", () => ({ getSetting: vi.fn(() => 16384) }));

function boot(state) {
  document.body.innerHTML = `
    <input id="file-input" type="file" hidden>
    <div id="file-offer-banner" hidden><span id="file-offer-text"></span>
      <button id="btn-file-accept"></button><button id="btn-file-reject"></button></div>
    <div id="file-transfers"></div>`;
  const noteIncomingForDrawer = vi.fn();
  const api = initFileTransferUI({
    doc: document,
    el: (id) => document.getElementById(id),
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    state,
    setDynamicText: (node, text) => { node.textContent = text; },
    noteIncomingForDrawer
  });
  return { api, noteIncomingForDrawer };
}

describe("fileTransferUI module boundary (Section C2)", () => {
  it("returns the four file control handlers as functions", () => {
    const { api } = boot({ pendingFileOffers: {}, outgoingFileTransfers: {}, incomingFileTransfers: {} });
    expect(Object.keys(api.fileControlHandlers).sort()).toEqual(["file-accept", "file-chunk", "file-offer", "file-reject"]);
    for (const fn of Object.values(api.fileControlHandlers)) expect(typeof fn).toBe("function");
  });

  it("file-reject for an unknown fileId is a no-op (no status row rendered)", async () => {
    const { api } = boot({ peerFingerprint: "peer", pendingFileOffers: {}, outgoingFileTransfers: {}, incomingFileTransfers: {} });
    await api.fileControlHandlers["file-reject"]({ type: "file-reject", fileId: "nope" });
    expect(document.getElementById("file-transfers").children.length).toBe(0);
  });

  it("file-offer from a verified peer renders the banner with the file name and notes the incoming event for the drawer", async () => {
    const state = { peerFingerprint: "peer", pendingFileOffers: {}, outgoingFileTransfers: {}, incomingFileTransfers: {} };
    const { api, noteIncomingForDrawer } = boot(state);
    await api.fileControlHandlers["file-offer"]({ type: "file-offer", fileId: "f1", name: "report.pdf", size: 2048, totalChunks: 1 });
    const banner = document.getElementById("file-offer-banner");
    expect(banner.hidden).toBe(false);
    expect(banner.dataset.fileId).toBe("f1");
    expect(document.getElementById("file-offer-text").textContent).toContain("report.pdf");
    expect(document.getElementById("file-offer-text").textContent).toContain("2.0 KB");
    expect(state.pendingFileOffers.f1.name).toBe("report.pdf");
    expect(noteIncomingForDrawer).toHaveBeenCalledTimes(1);
  });
});
