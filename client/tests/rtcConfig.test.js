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

  // Section B3 (specs/reviews/spirit-evaluation-triage.md): the client had
  // no way to configure a real TURN server's long-term credentials at all
  // -- turn: URIs have no userinfo component, so there was no way to type
  // "username:password" into the single STUN field the UI hinted at.
  describe("Section B3: TURN server with username/credential", () => {
    it("adds a second iceServers entry with username/credential when turnUrl is given", () => {
      const config = buildRtcConfig("stun:stun.l.google.com:19302", {
        turnUrl: "turn:turn.example.org:3478",
        turnUsername: "alice",
        turnCredential: "s3cret"
      });
      expect(config).toEqual({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "turn:turn.example.org:3478", username: "alice", credential: "s3cret" }
        ]
      });
    });

    it("does not add a TURN entry when turnUrl is empty/absent", () => {
      const config = buildRtcConfig("stun:stun.l.google.com:19302", { turnUsername: "alice", turnCredential: "s3cret" });
      expect(config.iceServers).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);
    });

    it("combines with forceTurnRelay", () => {
      const config = buildRtcConfig("stun:stun.l.google.com:19302", {
        forceTurnRelay: true,
        turnUrl: "turn:turn.example.org:3478",
        turnUsername: "alice",
        turnCredential: "s3cret"
      });
      expect(config.iceTransportPolicy).toBe("relay");
      expect(config.iceServers).toHaveLength(2);
    });
  });
});
