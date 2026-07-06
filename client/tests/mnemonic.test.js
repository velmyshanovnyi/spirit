import { describe, it, expect } from "vitest";
import { bytesToMnemonic, mnemonicToBytes } from "../js/mnemonic.js";
import { BIP39_ENGLISH_WORDLIST } from "../js/bip39-wordlist-en.js";

// Known-answer test vector generated independently via the reference
// `bip39` npm package (entropyToMnemonic), not derived from our own
// implementation -- guards against a self-consistent-but-wrong encoding.
const KNOWN_ENTROPY_BYTES = new Uint8Array([
  166, 239, 8, 59, 38, 119, 232, 138, 93, 132, 61, 126, 172, 223, 163, 4, 236, 20, 18, 19, 6, 7, 242, 107, 93, 72, 57,
  223, 224, 188, 164, 198
]);
const KNOWN_MNEMONIC = [
  "plunge", "joke", "attract", "erupt", "leader", "early", "invite", "marble", "leaf", "group", "trip", "antenna",
  "scout", "animal", "equal", "science", "venue", "foot", "faith", "inhale", "wrap", "furnace", "narrow", "spawn"
];

describe("bytesToMnemonic", () => {
  it("matches a known-answer test vector from an independent BIP39 implementation", async () => {
    const words = await bytesToMnemonic(KNOWN_ENTROPY_BYTES);
    expect(words).toEqual(KNOWN_MNEMONIC);
  });

  it("returns 24 words for a 32-byte input, all drawn from the wordlist", async () => {
    const entropy = crypto.getRandomValues(new Uint8Array(32));
    const words = await bytesToMnemonic(entropy);

    expect(words).toHaveLength(24);
    for (const word of words) {
      expect(BIP39_ENGLISH_WORDLIST).toContain(word);
    }
  });

  it("throws a clear error for input that isn't exactly 32 bytes", async () => {
    await expect(bytesToMnemonic(new Uint8Array(16))).rejects.toThrow(/32 bytes/i);
    await expect(bytesToMnemonic(new Uint8Array(33))).rejects.toThrow(/32 bytes/i);
  });
});

describe("mnemonicToBytes", () => {
  it("matches the known-answer test vector in reverse", async () => {
    const entropy = await mnemonicToBytes(KNOWN_MNEMONIC);
    expect(entropy).toEqual(KNOWN_ENTROPY_BYTES);
  });

  it("round-trips arbitrary random 32-byte entropy exactly", async () => {
    const original = crypto.getRandomValues(new Uint8Array(32));
    const words = await bytesToMnemonic(original);
    const restored = await mnemonicToBytes(words);
    expect(restored).toEqual(original);
  });

  it("throws a clear error when a word isn't in the wordlist", async () => {
    const badMnemonic = [...KNOWN_MNEMONIC];
    badMnemonic[5] = "notarealbip39word";

    await expect(mnemonicToBytes(badMnemonic)).rejects.toThrow(/not in the.*wordlist/i);
  });

  it("throws a clear error for the wrong number of words", async () => {
    await expect(mnemonicToBytes(KNOWN_MNEMONIC.slice(0, 12))).rejects.toThrow(/24 words/i);
    await expect(mnemonicToBytes([...KNOWN_MNEMONIC, "abandon"])).rejects.toThrow(/24 words/i);
  });

  it("rejects a mnemonic with a valid-looking but corrupted checksum (e.g. reordered words)", async () => {
    const reordered = [...KNOWN_MNEMONIC];
    [reordered[0], reordered[1]] = [reordered[1], reordered[0]];

    await expect(mnemonicToBytes(reordered)).rejects.toThrow(/checksum/i);
  });
});
