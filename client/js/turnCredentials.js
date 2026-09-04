// User request (2026-08-08): a genuinely free, no-signup public TURN option
// for the STUN/TURN preset dropdown (client/index.html, Section C8 area).
//
// Researched live before writing any code (WebFetch against
// metered.ca/tools/openrelay/, cross-checked with independent search
// results): the widely-copy-pasted "username: openrelayproject / credential:
// openrelayproject" static pair from countless WebRTC tutorials is STALE --
// the official Open Relay Project page no longer documents it and now
// requires signup + an API key for that endpoint ("Signup Required... free
// tier: 20 GB/month"). Hardcoding it would have silently stopped working
// with no way for a user to tell "TURN is unreachable" apart from "our
// candidate credentials were revoked."
//
// The ONE mechanism still documented WITHOUT signup is
// staticauth.openrelay.metered.ca, which Metered explicitly ships for
// services (their own example: Nextcloud Talk) that embed a shared secret
// directly rather than calling a per-account REST endpoint. It is the
// standard coturn "TURN REST API" / use-auth-secret scheme (RFC-adjacent,
// not a Spirit invention -- same scheme Nextcloud Talk, Jitsi and many
// coturn deployments use): a client-computed, TIME-LIMITED credential pair,
// not a fixed username/password:
//   username   = "<unixExpiryTimestamp>:<label>"
//   credential = base64(HMAC-SHA1(sharedSecret, username))
// The TURN server independently recomputes the same HMAC to verify --
// nothing is transmitted that isn't already implied by the (published)
// shared secret and the clock, so this is safe to compute client-side.
//
// Because the credential expires (default TTL below), the actual shipped
// design does NOT fill it into the turn-username/turn-credential fields
// once and leave it there indefinitely, unlike the STUN presets -- see
// app.js: it's recomputed fresh on every "select the preset" action
// (clicking #turn-preset, or selecting a saved signaling node that was
// saved with this preset active -- see the "turnPreset" field on saved
// nodes, exec review finding, specs/reviews/turn-preset-iter1.md). A
// value sitting in the form fields can still go stale if the user leaves
// the page open past the TTL without reselecting, same caveat that
// applies to any time-limited credential displayed in a UI.

import { bytesToBase64 } from "./codec.js";

/**
 * @param {string} sharedSecret
 * @param {{ ttlSeconds?: number, label?: string, now?: number }} [options]
 *   ttlSeconds: how long the credential remains valid for, from `now`.
 *   label: an arbitrary identifier appended to the username (purely
 *     informational on the server side -- some deployments use it for
 *     per-app usage attribution/rate-limiting; harmless if ignored).
 *   now: injectable clock (ms since epoch) for deterministic tests.
 * @returns {Promise<{ username: string, credential: string }>}
 */
export async function computeTurnRestCredential(sharedSecret, { ttlSeconds = 86400, label = "spirit", now = Date.now() } = {}) {
  const expiryUnixSeconds = Math.floor(now / 1000) + ttlSeconds;
  const username = `${expiryUnixSeconds}:${label}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(sharedSecret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(username));
  const credential = bytesToBase64(new Uint8Array(signature));
  return { username, credential };
}
