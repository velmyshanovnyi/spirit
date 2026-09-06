import { describe, it, expect, vi } from "vitest";
import {
  RATCHET_WIRE_PREFIX_V1,
  RATCHET_WIRE_PREFIX_V2,
  MAX_SKIPPED_MESSAGE_KEYS,
  encodeRatchetPayload,
  parseRatchetPayload,
  createReceiveChain,
  receiveMessageKeyForIndex,
  RatchetDesyncError
} from "../js/ratchetChain.js";
import { deriveInitialChainKeys, ratchetStep } from "../js/ratchet.js";
import { encryptMessage, decryptMessage } from "../js/e2ee.js";

// Deterministic fake step: message key = tag of the input chain key, next chain key = input+1.
function fakeStep() {
  const step = vi.fn(async (chainKeyBytes) => {
    const n = chainKeyBytes[0];
    return { messageKey: { tag: `mk-${n}` }, nextChainKeyBytes: new Uint8Array([n + 1]) };
  });
  return step;
}

describe("wire format", () => {
  it("parses a legacy R1 payload as version 1 without an index", () => {
    expect(parseRatchetPayload(RATCHET_WIRE_PREFIX_V1 + "abc")).toEqual({ version: 1, index: null, ciphertext: "abc" });
  });

  it("parses an R2 payload into a numeric index and the ciphertext, even when the ciphertext contains colons", () => {
    expect(parseRatchetPayload("R2:7:ab:cd==")).toEqual({ version: 2, index: 7, ciphertext: "ab:cd==" });
  });

  it("returns null for a payload that is not ratchet-encrypted (control messages stay on the session key)", () => {
    expect(parseRatchetPayload("PLAIN_SESSION_KEY_CIPHERTEXT")).toBeNull();
  });

  it("flags an R2 payload without a valid index as malformed instead of throwing", () => {
    expect(parseRatchetPayload("R2:abc")).toEqual({ version: 2, index: null, malformed: true });
    expect(parseRatchetPayload("R2:-1:x")).toEqual({ version: 2, index: null, malformed: true });
    expect(parseRatchetPayload("R2::x")).toEqual({ version: 2, index: null, malformed: true });
    expect(parseRatchetPayload("R2:007:x")).toEqual({ version: 2, index: null, malformed: true });
  });

  it("encode/parse round-trip", () => {
    const payload = encodeRatchetPayload(12, "ct==");
    expect(payload.startsWith(RATCHET_WIRE_PREFIX_V2)).toBe(true);
    expect(parseRatchetPayload(payload)).toEqual({ version: 2, index: 12, ciphertext: "ct==" });
  });
});

describe("receiveMessageKeyForIndex", () => {
  it("advances one step per in-order message", async () => {
    const step = fakeStep();
    const chain = createReceiveChain(new Uint8Array([0]));
    expect(await receiveMessageKeyForIndex(chain, 0, step)).toEqual({ tag: "mk-0" });
    expect(await receiveMessageKeyForIndex(chain, 1, step)).toEqual({ tag: "mk-1" });
    expect(await receiveMessageKeyForIndex(chain, 2, step)).toEqual({ tag: "mk-2" });
    expect(step).toHaveBeenCalledTimes(3);
    expect(chain.nextIndex).toBe(3);
    expect(chain.skipped.size).toBe(0);
  });

  it("on a forward jump, stores the skipped keys and later serves them without stepping again (out-of-order delivery)", async () => {
    const step = fakeStep();
    const chain = createReceiveChain(new Uint8Array([0]));
    expect(await receiveMessageKeyForIndex(chain, 3, step)).toEqual({ tag: "mk-3" });
    expect(step).toHaveBeenCalledTimes(4);
    expect([...chain.skipped.keys()]).toEqual([0, 1, 2]);

    expect(await receiveMessageKeyForIndex(chain, 1, step)).toEqual({ tag: "mk-1" });
    expect(step).toHaveBeenCalledTimes(4); // served from the window, no new step
    expect(chain.skipped.has(1)).toBe(false); // one-shot
  });

  it("rejects a replayed (already consumed) index with a RatchetDesyncError instead of desyncing or returning a wrong key", async () => {
    const step = fakeStep();
    const chain = createReceiveChain(new Uint8Array([0]));
    await receiveMessageKeyForIndex(chain, 0, step);
    await expect(receiveMessageKeyForIndex(chain, 0, step)).rejects.toBeInstanceOf(RatchetDesyncError);
    await expect(receiveMessageKeyForIndex(chain, 0, step)).rejects.toMatchObject({ code: "replay-or-expired", index: 0 });
    expect(chain.nextIndex).toBe(1);
  });

  it("refuses a jump beyond the skip window and leaves the chain untouched", async () => {
    const step = fakeStep();
    const chain = createReceiveChain(new Uint8Array([0]));
    await expect(receiveMessageKeyForIndex(chain, MAX_SKIPPED_MESSAGE_KEYS + 1, step)).rejects.toMatchObject({
      code: "too-far-ahead",
      index: MAX_SKIPPED_MESSAGE_KEYS + 1
    });
    expect(step).not.toHaveBeenCalled();
    expect(chain.nextIndex).toBe(0);
    // exactly the window edge is still accepted
    await receiveMessageKeyForIndex(chain, MAX_SKIPPED_MESSAGE_KEYS, step);
    expect(chain.skipped.size).toBe(MAX_SKIPPED_MESSAGE_KEYS);
  });

  it("bounds the skipped-key window by evicting the oldest entries", async () => {
    const step = fakeStep();
    const chain = createReceiveChain(new Uint8Array([0]));
    await receiveMessageKeyForIndex(chain, 10, step); // skipped 0..9
    await receiveMessageKeyForIndex(chain, 10 + MAX_SKIPPED_MESSAGE_KEYS, step); // skipped 11..(10+64-1)
    expect(chain.skipped.size).toBe(MAX_SKIPPED_MESSAGE_KEYS);
    expect(chain.skipped.has(0)).toBe(false); // evicted
    expect(chain.skipped.has(9 + MAX_SKIPPED_MESSAGE_KEYS)).toBe(true);
    await expect(receiveMessageKeyForIndex(chain, 0, step)).rejects.toMatchObject({ code: "replay-or-expired" });
  });

  it("does not mutate the chain when the step itself rejects", async () => {
    const step = vi.fn().mockRejectedValue(new Error("crypto down"));
    const chain = createReceiveChain(new Uint8Array([0]));
    await expect(receiveMessageKeyForIndex(chain, 0, step)).rejects.toThrow("crypto down");
    expect(chain.nextIndex).toBe(0);
    expect(chain.skipped.size).toBe(0);
  });
});

describe("end to end with the real ratchet and AES-GCM", () => {
  it("a sender emitting 0..3 and a receiver getting them as 3,1,0,2 decrypts all four", async () => {
    const root = crypto.getRandomValues(new Uint8Array(32));
    const a = await deriveInitialChainKeys(root, "AAAA", "BBBB");
    const b = await deriveInitialChainKeys(root, "BBBB", "AAAA");
    expect(a.sendChainKey).toEqual(b.receiveChainKey);

    // sender side: sequential chain
    const sent = [];
    let sendKey = a.sendChainKey;
    for (let i = 0; i < 4; i++) {
      const { messageKey, nextChainKeyBytes } = await ratchetStep(sendKey);
      sendKey = nextChainKeyBytes;
      sent.push(encodeRatchetPayload(i, await encryptMessage(messageKey, `msg-${i}`)));
    }

    const chain = createReceiveChain(b.receiveChainKey);
    const got = [];
    for (const idx of [3, 1, 0, 2]) {
      const parsed = parseRatchetPayload(sent[idx]);
      const key = await receiveMessageKeyForIndex(chain, parsed.index, ratchetStep);
      got.push(await decryptMessage(key, parsed.ciphertext));
    }
    expect(got).toEqual(["msg-3", "msg-1", "msg-0", "msg-2"]);
    expect(chain.skipped.size).toBe(0);
  });
});
