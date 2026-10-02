// @vitest-environment jsdom
// Section R9 (specs/phase5/app-decomposition.md, backlog A4): chat sending
// (queue / flush / 1:1 / group fan-out) extracted out of app.js. Behavioral
// coverage stays in app.test.js -- this pins the module boundary.
import { describe, it, expect, vi } from "vitest";
import { initChatSend } from "../js/chatSend.js";

vi.mock("../js/e2ee.js", () => ({ encryptMessage: vi.fn(async (_key, text) => `ENC(${text})`) }));
vi.mock("../js/ratchetChain.js", () => ({ encodeRatchetPayload: vi.fn((index, cipher) => `R2:${index}:${cipher}`) }));
vi.mock("../js/historyStore.js", () => ({ appendMessage: vi.fn() }));

function boot(state) {
  document.body.innerHTML = `
    <input id="message-input" value="привіт">
    <div id="chat-send-status" hidden></div>
    <div id="connection-status"></div>
    <div id="video-status"></div>
    <div id="chat-log"></div>
    <div id="group-chat-log"></div>`;
  const appendChat = vi.fn(() => { const row = document.createElement("div"); document.getElementById("chat-log").append(row); return row; });
  const appendGroupChat = vi.fn();
  const api = initChatSend({
    el: (id) => document.getElementById(id),
    t: (key) => key,
    state,
    setStatus: (text) => { document.getElementById("connection-status").textContent = text; },
    setVideoStatus: (text) => { document.getElementById("video-status").textContent = text; },
    setDynamicText: (node, text) => { node.textContent = text; },
    appendChat,
    appendGroupChat,
    clearPendingBadge: vi.fn(),
    nextSendMessageKey: vi.fn(async () => ({ messageKey: "mk", index: 7 }))
  });
  return { api, appendChat, appendGroupChat };
}

describe("chatSend module boundary (Section R9)", () => {
  it("returns the three functions app.js consumes", () => {
    const { api } = boot({ pendingOutgoingMessages: [], channel: null, sessionKey: null, peers: new Map() });
    expect(typeof api.sendChatMessage).toBe("function");
    expect(typeof api.sendGroupMessage).toBe("function");
    expect(typeof api.flushPendingOutgoingMessages).toBe("function");
  });

  it("queues a message while there is no channel, then flushes it as a ratchet payload once channel + key exist", async () => {
    const state = { pendingOutgoingMessages: [], channel: null, sessionKey: null, peers: new Map(), identityKeyPair: null };
    const { api, appendChat } = boot(state);
    await api.sendChatMessage();
    expect(state.pendingOutgoingMessages).toHaveLength(1);
    expect(appendChat).toHaveBeenCalledWith("привіт", "out", expect.any(Number), false, true);
    expect(document.getElementById("chat-send-status").hidden).toBe(false);
    expect(document.getElementById("connection-status").textContent).toBe("status.noActiveConnection");

    state.channel = { send: vi.fn() };
    state.sessionKey = "sk";
    await api.flushPendingOutgoingMessages();
    expect(state.channel.send).toHaveBeenCalledWith("R2:7:ENC(привіт)");
    expect(state.pendingOutgoingMessages).toHaveLength(0);
    expect(document.getElementById("chat-send-status").hidden).toBe(true);
  });

  it("sendGroupMessage fans out to every live peer of that group and renders exactly once", async () => {
    const a = { groupId: "g1", channel: { send: vi.fn() }, sessionKey: "ka" };
    const b = { groupId: "g1", channel: { send: vi.fn() }, sessionKey: "kb" };
    const other = { groupId: "g2", channel: { send: vi.fn() }, sessionKey: "kc" };
    // A real channel but no session key yet (review): proves the key check,
    // not just a TypeError swallowed by the per-peer catch.
    const dead = { groupId: "g1", channel: { send: vi.fn() }, sessionKey: null };
    const state = { pendingOutgoingMessages: [], peers: new Map([["1", a], ["2", b], ["3", other], ["4", dead]]), identityKeyPair: null };
    const { api, appendGroupChat } = boot(state);
    await api.sendGroupMessage("g1", "hi group");
    const expected = `ENC(${JSON.stringify({ type: "group-message", groupId: "g1", text: "hi group" })})`;
    expect(a.channel.send).toHaveBeenCalledWith(expected);
    expect(b.channel.send).toHaveBeenCalledWith(expected);
    expect(other.channel.send).not.toHaveBeenCalled();
    expect(dead.channel.send).not.toHaveBeenCalled();
    expect(appendGroupChat).toHaveBeenCalledTimes(1);
    expect(appendGroupChat).toHaveBeenCalledWith("hi group", "out", null, expect.any(Number));
  });
});
