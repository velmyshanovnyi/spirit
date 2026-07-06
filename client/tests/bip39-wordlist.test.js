import { describe, it, expect } from "vitest";
import { BIP39_ENGLISH_WORDLIST } from "../js/bip39-wordlist-en.js";

// Guards the generated data file's integrity independently of the
// known-answer mnemonic test vector (which is looked up through this same
// file, so it cannot by itself catch a wrong-but-internally-consistent
// wordlist -- e.g. a typo at some index that both the vector and this file
// happen to agree on).
describe("BIP39_ENGLISH_WORDLIST", () => {
  it("has exactly 2048 entries", () => {
    expect(BIP39_ENGLISH_WORDLIST).toHaveLength(2048);
  });

  it("starts with 'abandon' and ends with 'zoo' (known official anchors)", () => {
    expect(BIP39_ENGLISH_WORDLIST[0]).toBe("abandon");
    expect(BIP39_ENGLISH_WORDLIST[2047]).toBe("zoo");
  });

  it("contains only unique, lowercase-alphabetic words", () => {
    expect(new Set(BIP39_ENGLISH_WORDLIST).size).toBe(2048);
    for (const word of BIP39_ENGLISH_WORDLIST) {
      expect(word).toMatch(/^[a-z]+$/);
    }
  });

  it("is sorted alphabetically (a property of the official BIP39 English list)", () => {
    const sorted = [...BIP39_ENGLISH_WORDLIST].sort();
    expect(BIP39_ENGLISH_WORDLIST).toEqual(sorted);
  });
});
