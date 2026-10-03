// Section I1 (specs/phase5/ice-servers.md): the ICE server list, built by
// one pure function in a fixed precedence order -- public STUN first, then
// Cloudflare Realtime TURN (short-lived credential fetched from the
// signaling node, Section I3), then any user-supplied TURN, then the Open
// Relay public fallback. ICE itself picks the best candidate pair; the
// order only matters for forceTurnRelay (relay-only) and for readers.
export const DEFAULT_STUN_URLS = ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"];

// Cloudflare Realtime TURN: all six transports in ONE entry, so the browser
// tries them in parallel and restrictive networks (UDP blocked, only 443
// open) still get through.
export const CLOUDFLARE_TURN_URLS = [
  "turn:turn.cloudflare.com:3478?transport=udp",
  "turn:turn.cloudflare.com:3478?transport=tcp",
  "turns:turn.cloudflare.com:5349?transport=tcp",
  "turn:turn.cloudflare.com:443?transport=udp",
  "turn:turn.cloudflare.com:80?transport=tcp",
  "turns:turn.cloudflare.com:443?transport=tcp"
];

// Open Relay Project (metered.ca): a public, no-signup relay with the
// vendor's published static credential. Shared and best-effort -- a
// fallback, never the primary (user decision 2026-10-03).
export const OPEN_RELAY_SERVER = Object.freeze({
  urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turn:openrelay.metered.ca:443?transport=tcp"],
  username: "openrelayproject",
  credential: "openrelayproject"
});

/**
 * @param {object} options
 * @param {string} [options.stunUrl] an extra STUN url (the node screen's field); ignored when empty or already listed
 * @param {{ username: string, credential: string } | null} [options.cloudflareCredential]
 * @param {{ turnUrl?: string, turnUsername?: string, turnCredential?: string } | null} [options.customTurn]
 * @param {boolean} [options.includeOpenRelay]
 * @returns {Array<{ urls: string | string[], username?: string, credential?: string }>}
 */
export function buildIceServers({ stunUrl = "", cloudflareCredential = null, customTurn = null, includeOpenRelay = true } = {}) {
  const stunUrls = [...DEFAULT_STUN_URLS];
  if (stunUrl && !stunUrls.includes(stunUrl)) stunUrls.push(stunUrl);
  const servers = stunUrls.map((urls) => ({ urls }));
  if (cloudflareCredential && cloudflareCredential.username && cloudflareCredential.credential) {
    servers.push({ urls: CLOUDFLARE_TURN_URLS, username: cloudflareCredential.username, credential: cloudflareCredential.credential });
  }
  if (customTurn && customTurn.turnUrl) {
    servers.push({ urls: customTurn.turnUrl, username: customTurn.turnUsername ?? "", credential: customTurn.turnCredential ?? "" });
  }
  if (includeOpenRelay) servers.push(OPEN_RELAY_SERVER);
  return servers;
}
