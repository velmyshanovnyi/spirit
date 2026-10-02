// @vitest-environment jsdom
// Section C3 (specs/phase5/core-dispatch.md): group-chat control handlers
// (group-member-joined / group-message / mesh-relay-*) and the two group
// helpers extracted out of app.js. Behavioural coverage stays in
// app.test.js -- this pins the module boundary.
import { describe, it, expect, vi } from "vitest";
import { initGroupChatHandlers } from "../js/groupChatHandlers.js";

vi.mock("../js/contacts.js", () => ({ getContact: vi.fn(async () => null) }));
vi.mock("../js/groups.js", () => ({ getGroup: vi.fn(async () => ({ groupId: "g1", memberFingerprints: [] })), ensureGroupBootstrap: vi.fn(), updateGroupMembers: vi.fn() }));
vi.mock("../js/historyStore.js", () => ({ appendMessage: vi.fn() }));
vi.mock("../js/e2ee.js", () => ({ encryptMessage: vi.fn(async (_k, text) => `ENC(${text})`) }));

function boot(activePeer, state = {}) {
  const appendGroupChat = vi.fn();
  const noteIncomingForDrawer = vi.fn();
  const api = initGroupChatHandlers({
    t: (key) => key,
    state: { senderKey: "me", peerFingerprint: "peer", identityKeyPair: null, peers: new Map(), activeConnectionId: "c1", ...state },
    getActivePeer: () => activePeer,
    appendGroupChat,
    noteIncomingForDrawer,
    initiateMeshRelayConnect: vi.fn(),
    relayGroupMeshMessage: vi.fn(),
    handleIncomingMeshRelayOffer: vi.fn(),
    handleIncomingMeshRelayAnswer: vi.fn()
  });
  return { api, appendGroupChat, noteIncomingForDrawer };
}

describe("groupChatHandlers module boundary (Section C3)", () => {
  it("returns the four group control handlers plus the two helpers app.js keeps using", () => {
    const { api } = boot({ groupId: "g1" });
    expect(Object.keys(api.groupControlHandlers).sort()).toEqual(["group-member-joined", "group-message", "mesh-relay-answer", "mesh-relay-offer"]);
    for (const fn of Object.values(api.groupControlHandlers)) expect(typeof fn).toBe("function");
    expect(typeof api.ensureLocalGroupRecord).toBe("function");
    expect(typeof api.broadcastGroupMemberJoined).toBe("function");
  });

  it("group-message on a connection not tagged with that group is dropped silently", async () => {
    const { api, appendGroupChat, noteIncomingForDrawer } = boot({ groupId: "other" });
    await api.groupControlHandlers["group-message"]({ type: "group-message", groupId: "g1", text: "hi" });
    expect(appendGroupChat).not.toHaveBeenCalled();
    expect(noteIncomingForDrawer).not.toHaveBeenCalled();
  });

  it("group-message on a tagged connection renders with the sender label and notes the incoming event", async () => {
    const { api, appendGroupChat, noteIncomingForDrawer } = boot({ groupId: "g1" });
    await api.groupControlHandlers["group-message"]({ type: "group-message", groupId: "g1", text: "hi group" });
    expect(appendGroupChat).toHaveBeenCalledTimes(1);
    expect(appendGroupChat.mock.calls[0][0]).toBe("hi group");
    expect(appendGroupChat.mock.calls[0][1]).toBe("in");
    expect(appendGroupChat.mock.calls[0][2]).toContain("spirit"); // formatSpiritId(peer)
    expect(noteIncomingForDrawer).toHaveBeenCalledTimes(1);
  });
});
