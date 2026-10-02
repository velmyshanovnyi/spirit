// @vitest-environment jsdom
// Section C4 (specs/phase5/core-dispatch.md): the five per-contact
// announcement handlers extracted out of app.js. Behavioural coverage stays
// in app.test.js -- this pins the module boundary.
import { describe, it, expect, vi } from "vitest";
import { initPeerAnnouncements } from "../js/peerAnnouncements.js";

const contacts = vi.hoisted(() => ({
  getContact: vi.fn(async () => ({ deviceList: null })),
  updateContactDeviceList: vi.fn(),
  updateContactProofSet: vi.fn(),
  updateContactPushSubscription: vi.fn()
}));
vi.mock("../js/contacts.js", () => contacts);
vi.mock("../js/deviceLinking.js", () => ({ acceptNewerDeviceList: vi.fn(async () => ({ v: 1 })) }));
vi.mock("../js/proofSet.js", () => ({ acceptNewerProofSet: vi.fn() }));
vi.mock("../js/pushSubscription.js", () => ({ parsePushSubscriptionAnnounce: vi.fn() }));
vi.mock("../js/recoveryShare.js", () => ({ parseRecoveryShareAnnounce: vi.fn() }));
vi.mock("../js/trustedShares.js", () => ({ saveTrustedShare: vi.fn() }));

function boot(state) {
  const renderSafetyHint = vi.fn();
  const api = initPeerAnnouncements({ state, renderSafetyHint });
  return { api, renderSafetyHint };
}

describe("peerAnnouncements module boundary (Section C4)", () => {
  it("returns the five announcement handlers as functions", () => {
    const { api } = boot({});
    expect(Object.keys(api.announcementHandlers).sort()).toEqual(
      ["device-list-announce", "proof-set-announce", "push-subscription-announce", "recovery-share-announce", "safety-display-mode"]
    );
    for (const fn of Object.values(api.announcementHandlers)) expect(typeof fn).toBe("function");
  });

  it("device-list-announce is a no-op without a vault key (ephemeral identity): contacts are never touched", async () => {
    const { api } = boot({ peerFingerprint: "peer", identityKeyPair: { vaultKey: null }, peerIdentityPublicKey: {} });
    await api.announcementHandlers["device-list-announce"]({ type: "device-list-announce", list: { v: 1 } });
    expect(contacts.getContact).not.toHaveBeenCalled();
    expect(contacts.updateContactDeviceList).not.toHaveBeenCalled();
  });

  it("device-list-announce with a vault key accepts the newer list and stores it", async () => {
    const { api } = boot({ peerFingerprint: "peer", identityKeyPair: { vaultKey: {} }, peerIdentityPublicKey: {} });
    await api.announcementHandlers["device-list-announce"]({ type: "device-list-announce", list: { v: 1 } });
    expect(contacts.updateContactDeviceList).toHaveBeenCalledWith("peer", { v: 1 });
  });

  it("safety-display-mode has no identity gate: it sets the mode and re-renders the hint", async () => {
    const state = { safetyDisplayMode: "peer" };
    const { api, renderSafetyHint } = boot(state);
    await api.announcementHandlers["safety-display-mode"]({ type: "safety-display-mode", mode: "shared" });
    expect(state.safetyDisplayMode).toBe("shared");
    expect(renderSafetyHint).toHaveBeenCalledTimes(1);
    await api.announcementHandlers["safety-display-mode"]({ type: "safety-display-mode", mode: "garbage" });
    expect(state.safetyDisplayMode).toBe("peer");
  });
});
