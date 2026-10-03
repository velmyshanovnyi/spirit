// @vitest-environment jsdom
// Section C5 (specs/phase5/core-dispatch.md): the call/media domain
// extracted out of app.js. Behavioural coverage stays in app.test.js --
// this pins the module boundary and the shared stopLocalMedia() teardown.
import { describe, it, expect, vi } from "vitest";
import { initCallUI } from "../js/callUI.js";

vi.mock("../js/webrtc.js", () => ({
  addLocalMediaTracks: vi.fn(),
  createRenegotiationOffer: vi.fn(),
  createRenegotiationAnswer: vi.fn(),
  applyRenegotiationAnswer: vi.fn()
}));
vi.mock("../js/e2ee.js", () => ({ encryptMessage: vi.fn(async (_k, text) => `ENC(${text})`) }));

function boot(state) {
  document.body.innerHTML = `
    <div id="video-status"></div>
    <video id="video-local"></video><video id="video-remote" hidden></video>
    <button id="btn-toggle-camera"></button><button id="btn-toggle-mic"></button>`;
  const getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  const api = initCallUI({ doc: document, el: (id) => document.getElementById(id), t: (key, p) => (p ? `${key}:${p.msg}` : key), state });
  return { api, getUserMedia };
}

describe("callUI module boundary (Section C5)", () => {
  it("returns the two call control handlers and the media API app.js keeps using", () => {
    const { api } = boot({});
    expect(Object.keys(api.callControlHandlers).sort()).toEqual(["webrtc-call-answer", "webrtc-call-offer"]);
    for (const name of ["previewLocalMedia", "acquireLocalStream", "updateCallButtonStates", "stopLocalMedia", "setVideoStatus", "autoStartOwnerCall"]) {
      expect(typeof api[name]).toBe("function");
    }
  });

  it("webrtc-call-offer from an unverified peer is rejected without touching the camera", async () => {
    const { api, getUserMedia } = boot({ peerFingerprint: null });
    await api.callControlHandlers["webrtc-call-offer"]({ type: "webrtc-call-offer", sdp: {} });
    expect(document.getElementById("video-status").textContent).toBe("status.incomingRejected");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("stopLocalMedia stops the tracks, clears the stream and both call flags, and hides the remote tile", () => {
    const tracks = [{ kind: "video", enabled: true, stop: vi.fn() }, { kind: "audio", enabled: true, stop: vi.fn() }];
    const state = { localStream: { getTracks: () => tracks }, localMediaPreviewTimeoutId: setTimeout(() => {}, 100000), localTracksAddedToPeer: true, callOfferSent: true };
    const { api } = boot(state);
    const remote = document.getElementById("video-remote");
    remote.hidden = false;
    api.stopLocalMedia();
    for (const track of tracks) expect(track.stop).toHaveBeenCalled();
    expect(state.localStream).toBeNull();
    expect(state.localMediaPreviewTimeoutId).toBeNull();
    expect(state.localTracksAddedToPeer).toBe(false);
    expect(state.callOfferSent).toBe(false);
    expect(remote.hidden).toBe(true);
    expect(document.getElementById("btn-toggle-mic").getAttribute("aria-pressed")).toBe("false");
  });
});
