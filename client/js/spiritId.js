/**
 * Human-facing Spirit ID format: "spirit0001" + identity fingerprint.
 * "0001" is the format version -- a future ID scheme bumps it without
 * ambiguity. This is a DISPLAY/exchange encoding only: storage keys,
 * signaling sender_key and every internal API keep using the raw
 * fingerprint (changing those would be a breaking protocol migration).
 */
export const SPIRIT_ID_PREFIX = "spirit0001";

export function formatSpiritId(fingerprint) {
  return SPIRIT_ID_PREFIX + fingerprint;
}

/**
 * Reverses formatSpiritId. Returns the raw fingerprint, or null for
 * anything that isn't a well-formed v1 Spirit ID (foreign prefix, wrong
 * length, non-hex) -- callers treat null as "not a Spirit ID".
 */
export function parseSpiritId(spiritId) {
  if (typeof spiritId !== "string" || !spiritId.startsWith(SPIRIT_ID_PREFIX)) return null;
  const fingerprint = spiritId.slice(SPIRIT_ID_PREFIX.length);
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) return null;
  return fingerprint;
}
