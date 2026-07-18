import { describe, it, expect } from "vitest";
import { buildRtcConfig } from "../js/webrtc.js";

describe("buildRtcConfig", () => {
  it("defaults to a plain iceServers config with no iceTransportPolicy key at all", () => {
    const config = buildRtcConfig("stun:stun.l.google.com:19302");
    expect(config).toEqual({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    expect("iceTransportPolicy" in config).toBe(false);
  });

  it("omits iceTransportPolicy when forceTurnRelay is explicitly false", () => {
    const config = buildRtcConfig("stun:example.org", { forceTurnRelay: false });
    expect("iceTransportPolicy" in config).toBe(false);
  });

  it("sets iceTransportPolicy to relay when forceTurnRelay is true", () => {
    const config = buildRtcConfig("turn:example.org", { forceTurnRelay: true });
    expect(config).toEqual({
      iceServers: [{ urls: "turn:example.org" }],
      iceTransportPolicy: "relay"
    });
  });
});
