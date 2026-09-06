// Section P2c (specs/phase5/security-hardening.md, backlog A6): indexed wire
// format + a bounded window of skipped message keys on the receive side, so a
// lost or reordered chat message no longer desyncs the KDF chain for the rest
// of the session. Pure logic -- the ratchet step is injected so this module has
// no crypto of its own and app.js can drive it with the real (or a mocked)
// `ratchetStep` from ratchet.js.

export const RATCHET_WIRE_PREFIX_V1 = "R1:"; // legacy: no index, strictly sequential
export const RATCHET_WIRE_PREFIX_V2 = "R2:"; // "R2:<index>:<ciphertext>"
export const MAX_SKIPPED_MESSAGE_KEYS = 64;

const V2_PATTERN = /^R2:(0|[1-9]\d{0,9}):([\s\S]*)$/;

export function encodeRatchetPayload(index, ciphertext) {
  return `${RATCHET_WIRE_PREFIX_V2}${index}:${ciphertext}`;
}

// Returns null for payloads that are not ratchet-encrypted (control messages
// on the static session key), { version: 1, index: null, ciphertext } for the
// legacy marker, { version: 2, index, ciphertext } for the indexed format, and
// { version: 2, malformed: true } when the R2 header cannot be parsed -- the
// caller must surface that, never silently drop it.
export function parseRatchetPayload(payload) {
  if (payload.startsWith(RATCHET_WIRE_PREFIX_V1)) {
    return { version: 1, index: null, ciphertext: payload.slice(RATCHET_WIRE_PREFIX_V1.length) };
  }
  if (payload.startsWith(RATCHET_WIRE_PREFIX_V2)) {
    const match = V2_PATTERN.exec(payload);
    if (!match) return { version: 2, index: null, malformed: true };
    return { version: 2, index: Number(match[1]), ciphertext: match[2] };
  }
  return null;
}

export class RatchetDesyncError extends Error {
  constructor(code, index) {
    super(`ratchet desync (${code}) at message index ${index}`);
    this.name = "RatchetDesyncError";
    this.code = code; // "replay-or-expired" | "too-far-ahead"
    this.index = index;
  }
}

export function createReceiveChain(chainKeyBytes) {
  return { chainKey: chainKeyBytes, nextIndex: 0, skipped: new Map() };
}

// Resolves the message key for `index`, advancing the chain as needed and
// parking the keys of any indexes jumped over in `chain.skipped` (bounded by
// MAX_SKIPPED_MESSAGE_KEYS, oldest evicted first). The chain object is only
// mutated once every needed step has succeeded, so a rejected step leaves it
// exactly as it was. Callers must serialize invocations per chain.
export async function receiveMessageKeyForIndex(chain, index, ratchetStep) {
  if (index < chain.nextIndex) {
    const parked = chain.skipped.get(index);
    if (!parked) throw new RatchetDesyncError("replay-or-expired", index);
    chain.skipped.delete(index);
    return parked;
  }
  if (index - chain.nextIndex > MAX_SKIPPED_MESSAGE_KEYS) {
    throw new RatchetDesyncError("too-far-ahead", index);
  }

  let chainKey = chain.chainKey;
  const newlySkipped = [];
  for (let i = chain.nextIndex; i < index; i++) {
    const { messageKey, nextChainKeyBytes } = await ratchetStep(chainKey);
    newlySkipped.push([i, messageKey]);
    chainKey = nextChainKeyBytes;
  }
  const { messageKey, nextChainKeyBytes } = await ratchetStep(chainKey);

  for (const [i, key] of newlySkipped) chain.skipped.set(i, key);
  while (chain.skipped.size > MAX_SKIPPED_MESSAGE_KEYS) {
    chain.skipped.delete(chain.skipped.keys().next().value); // Map iterates in insertion order -> oldest first
  }
  chain.chainKey = nextChainKeyBytes;
  chain.nextIndex = index + 1;
  return messageKey;
}
