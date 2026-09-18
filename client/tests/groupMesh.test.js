// @vitest-environment jsdom
// Section R2 (specs/phase5/app-decomposition.md, backlog A4): the GC4
// mesh-relay domain extracted out of app.js. Full behavioral coverage stays
// in app.test.js; this file pins the module boundary and the one security
// invariant cheap to assert in isolation: relayGroupMeshMessage only
// forwards to an already-verified same-groupId peer.
import { describe, it, expect, vi } from "vitest";
import { initGroupMesh } from "../js/groupMesh.js";

vi.mock("../js/e2ee.js", () => ({
  deriveSessionKey: vi.fn(),
  encryptMessage: vi.fn(async (_key, json) => `ENC(${json})`),
  decryptMessage: vi.fn()
}));

function makeMesh(state) {
  return initGroupMesh({
    state,
    handleChatMessage: async () => {},
    randomConnectionId: () => "conn-x",
    createPeerEntry: () => ({ pc: null, channel: null, sessionKey: null, groupId: null }),
    getGroupPeerByFingerprint: (groupId, fp) => {
      for (const peer of state.peers.values()) {
        if (peer.groupId === groupId && peer.peerFingerprint === fp) return peer;
      }
      return null;
    },
    makeEntryIdentityAnnouncer: () => async () => {},
    currentRtcConfig: () => ({}),
    ensureLocalGroupRecord: async () => null
  });
}

describe("groupMesh module boundary (Section R2)", () => {
  it("initGroupMesh returns the four functions app.js consumes", () => {
    const api = makeMesh({ peers: new Map(), pendingMeshRelays: new Map(), messageDispatchLock: Promise.resolve() });
    expect(typeof api.initiateMeshRelayConnect).toBe("function");
    expect(typeof api.relayGroupMeshMessage).toBe("function");
    expect(typeof api.handleIncomingMeshRelayOffer).toBe("function");
    expect(typeof api.handleIncomingMeshRelayAnswer).toBe("function");
  });

  it("relayGroupMeshMessage re-encrypts to the verified same-groupId target and drops silently without a path", async () => {
    const send = vi.fn();
    const state = {
      peers: new Map([
        ["c1", { groupId: "g1", peerFingerprint: "FP-T", channel: { send }, sessionKey: { tag: "k1" } }],
        ["c2", { groupId: "g2", peerFingerprint: "FP-T", channel: { send: vi.fn() }, sessionKey: { tag: "k2" } }]
      ]),
      pendingMeshRelays: new Map(),
      messageDispatchLock: Promise.resolve()
    };
    const api = makeMesh(state);
    const control = { type: "mesh-relay-offer", groupId: "g1", toFingerprint: "FP-T" };
    await api.relayGroupMeshMessage(control);
    expect(send).toHaveBeenCalledWith(`ENC(${JSON.stringify(control)})`);
    // no target in that group -> silent drop, no throw
    await expect(api.relayGroupMeshMessage({ groupId: "g3", toFingerprint: "FP-T" })).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("handleIncomingMeshRelayAnswer drops an unknown relayId without touching peers", async () => {
    const state = { peers: new Map(), pendingMeshRelays: new Map(), messageDispatchLock: Promise.resolve() };
    const api = makeMesh(state);
    await expect(api.handleIncomingMeshRelayAnswer({ relayId: "nope" })).resolves.toBeUndefined();
    expect(state.peers.size).toBe(0);
  });
});
