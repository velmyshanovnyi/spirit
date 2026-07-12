import { BIP39_ENGLISH_WORDLIST } from "./bip39-wordlist-en.js";

// Section H2 (specs/phase3/deterministic-accounts.md): a default, generated
// password offered at portable-account creation -- 6 words from the same
// 2048-word list mnemonic.js already uses gives ~66 bits of entropy
// (6 * 11 bits/word), matching the spec's Argon2id-resistance target. No
// checksum (unlike mnemonic.js's 24-word recovery phrase) -- this is a KDF
// input the user can also freely replace, not a recoverable seed encoding.
const WORD_COUNT = 6;

function pickRandomWord() {
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % BIP39_ENGLISH_WORDLIST.length;
  return BIP39_ENGLISH_WORDLIST[index];
}

export function generateStrongPassword() {
  return Array.from({ length: WORD_COUNT }, pickRandomWord).join(" ");
}
