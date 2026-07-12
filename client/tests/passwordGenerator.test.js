import { describe, it, expect } from "vitest";
import { generateStrongPassword } from "../js/passwordGenerator.js";
import { BIP39_ENGLISH_WORDLIST } from "../js/bip39-wordlist-en.js";

describe("generateStrongPassword", () => {
  it("returns 6 space-separated words from the wordlist", () => {
    const password = generateStrongPassword();
    const words = password.split(" ");

    expect(words.length).toBe(6);
    for (const word of words) {
      expect(BIP39_ENGLISH_WORDLIST).toContain(word);
    }
  });

  it("produces varied results across many calls (not always the same one)", () => {
    const results = new Set();
    for (let i = 0; i < 20; i++) {
      results.add(generateStrongPassword());
    }
    expect(results.size).toBeGreaterThan(1);
  });
});
