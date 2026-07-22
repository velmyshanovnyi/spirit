/**
 * Section RF10: two ways to present a safety-number verification value --
 *
 * - "peer" mode (the original, default): each side shows the fingerprint it
 *   independently verified for the OTHER party (see app.js's identity-announce
 *   handling). Not symmetric -- each side sees a DIFFERENT value (their own
 *   peer's), verified by asking the other person to read out their OWN Spirit
 *   ID from their own Profile screen.
 * - "shared" mode: a single value derived from BOTH parties' fingerprints
 *   together, computed identically on both sides (order-independent -- see
 *   the sort below) so it CAN be compared banner-to-banner directly, closer
 *   to Signal's classic combined safety number.
 *
 * Neither mode is "more secure" than the other -- both are already anchored
 * in the same cryptographically-verified identity-announce exchange
 * (docs/e2ee.md); this only changes how the resulting value is displayed
 * and what verification instructions make sense for it.
 */

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Order-independent: sorting the two fingerprints before concatenating
 * means both participants compute the exact same hash regardless of which
 * side is "me" vs "the peer".
 */
export async function computeSharedSafetyNumber(fingerprintA, fingerprintB) {
  const [first, second] = [fingerprintA, fingerprintB].sort();
  return sha256Hex(`${first}:${second}`);
}

// Curated for universal rendering and easy visual distinction: common
// animal emoji only -- no skin-tone/gender variants, no flags (locale-
// sensitive rendering), no near-duplicate silhouettes at small size.
const EMOJI_PALETTE = [
  "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
  "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🐤", "🦆",
  "🦉", "🦇", "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌",
  "🐞", "🐜", "🦂", "🐢", "🐍", "🦎", "🐙", "🦑", "🦐", "🦀",
  "🐡", "🐠", "🐟", "🐬", "🐳", "🐋", "🦈", "🐊", "🐅", "🦓"
];

/**
 * Turns any hex string into a short, human-comparable emoji sequence --
 * NOT a security boundary on its own (collisions are expected and fine;
 * the underlying hex/fingerprint stays available too), purely a friendlier
 * "read this out loud" / "eyeball compare" surface than raw hex.
 */
export function hexToEmoji(hex, count = 5) {
  const bytes = [];
  for (let i = 0; i < hex.length - 1; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  if (bytes.length === 0) return "";
  const step = Math.max(1, Math.floor(bytes.length / count));
  const emojis = [];
  for (let i = 0; i < count; i++) {
    const byte = bytes[(i * step) % bytes.length];
    emojis.push(EMOJI_PALETTE[byte % EMOJI_PALETTE.length]);
  }
  return emojis.join(" ");
}
