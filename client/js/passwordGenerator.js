// Section A5/L2 (specs/phase5/lazy-loading.md): the 23KB wordlist is only
// needed when a portable-account password is generated (or a mnemonic is
// handled, mnemonic.js), so it is imported lazily at first use. This makes
// generateStrongPassword async.
let wordlistPromise = null;
function loadWordlist() {
  if (!wordlistPromise) {
    // A failed import must not poison the cache forever (exec-review note):
    // drop it so the next call retries the fetch.
    wordlistPromise = import("./bip39-wordlist-en.js").then((m) => m.BIP39_ENGLISH_WORDLIST).catch((err) => {
      wordlistPromise = null;
      throw err;
    });
  }
  return wordlistPromise;
}

// Section H2 (specs/phase3/deterministic-accounts.md): a default, generated
// password offered at portable-account creation -- 6 words from the same
// 2048-word list mnemonic.js already uses gives ~66 bits of entropy
// (6 * 11 bits/word), matching the spec's Argon2id-resistance target. No
// checksum (unlike mnemonic.js's 24-word recovery phrase) -- this is a KDF
// input the user can also freely replace, not a recoverable seed encoding.
const WORD_COUNT = 6;

function pickRandomWord(wordlist) {
  const index = crypto.getRandomValues(new Uint32Array(1))[0] % wordlist.length;
  return wordlist[index];
}

export async function generateStrongPassword() {
  const wordlist = await loadWordlist();
  return Array.from({ length: WORD_COUNT }, () => pickRandomWord(wordlist)).join(" ");
}
