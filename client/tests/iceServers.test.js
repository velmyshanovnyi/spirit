// Section I1 (specs/phase5/ice-servers.md): the ICE server list is built by
// one pure function in a fixed precedence order.
import { describe, it, expect } from "vitest";
import { buildIceServers, DEFAULT_STUN_URLS, OPEN_RELAY_SERVER, CLOUDFLARE_TURN_URLS } from "../js/iceServers.js";

describe("buildIceServers (Section I1)", () => {
  it("default: the two public STUN servers followed by the Open Relay fallback", () => {
    expect(DEFAULT_STUN_URLS).toEqual(["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"]);
    expect(buildIceServers({})).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun.cloudflare.com:3478" },
      OPEN_RELAY_SERVER
    ]);
    expect(OPEN_RELAY_SERVER).toEqual({ urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"], username: "openrelayproject", credential: "openrelayproject" });
  });

  it("Cloudflare TURN (all six transports, short-lived credential) sits between STUN and the fallbacks", () => {
    const servers = buildIceServers({ cloudflareCredential: { username: "cf-user", credential: "cf-pass" } });
    expect(CLOUDFLARE_TURN_URLS).toEqual([
      "turn:turn.cloudflare.com:3478?transport=udp",
      "turn:turn.cloudflare.com:3478?transport=tcp",
      "turns:turn.cloudflare.com:5349?transport=tcp",
      "turn:turn.cloudflare.com:443?transport=udp",
      "turn:turn.cloudflare.com:80?transport=tcp",
      "turns:turn.cloudflare.com:443?transport=tcp"
    ]);
    expect(servers[2]).toEqual({ urls: CLOUDFLARE_TURN_URLS, username: "cf-user", credential: "cf-pass" });
    expect(servers[3]).toEqual(OPEN_RELAY_SERVER);
  });

  it("a user-supplied TURN goes after Cloudflare and before Open Relay; an empty url adds nothing", () => {
    const custom = { turnUrl: "turn:my.example:3478", turnUsername: "u", turnCredential: "p" };
    const servers = buildIceServers({ cloudflareCredential: { username: "a", credential: "b" }, customTurn: custom });
    expect(servers.map((s) => (Array.isArray(s.urls) ? s.urls[0] : s.urls))).toEqual([
      "stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478",
      "turn:turn.cloudflare.com:3478?transport=udp", "turn:my.example:3478", "turn:openrelay.metered.ca:80"
    ]);
    expect(servers[3]).toEqual({ urls: "turn:my.example:3478", username: "u", credential: "p" });
    expect(buildIceServers({ customTurn: { turnUrl: "", turnUsername: "u", turnCredential: "p" } })).toHaveLength(3);
  });

  it("includeOpenRelay:false drops the fallback; a custom STUN url is added once, never duplicated", () => {
    expect(buildIceServers({ includeOpenRelay: false })).toHaveLength(2);
    const withDup = buildIceServers({ stunUrl: "stun:stun.l.google.com:19302", includeOpenRelay: false });
    expect(withDup).toHaveLength(2);
    const withNew = buildIceServers({ stunUrl: "stun:mine.example:3478", includeOpenRelay: false });
    expect(withNew.map((s) => s.urls)).toEqual(["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478", "stun:mine.example:3478"]);
  });
});
