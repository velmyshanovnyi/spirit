import { BIP39_ENGLISH_WORDLIST } from "./bip39-wordlist-en.js";

const ENTROPY_BYTES = 32; // matches the P-256 private scalar size (D8: encodes raw key bytes, not a derivation)
const BITS_PER_WORD = 11; // 2^11 = 2048 = wordlist size
const CHECKSUM_BITS = ENTROPY_BYTES / 4; // BIP39: checksum length = ENT/32 bits, ENT = ENTROPY_BYTES*8 -> ENT/32 = ENTROPY_BYTES/4
const WORD_COUNT = (ENTROPY_BYTES * 8 + CHECKSUM_BITS) / BITS_PER_WORD; // 24 for 32-byte entropy

function bytesToBinaryString(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += byte.toString(2).padStart(8, "0");
  }
  return binary;
}

function binaryStringToBytes(binary) {
  const bytes = new Uint8Array(binary.length / 8);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(binary.slice(i * 8, i * 8 + 8), 2);
  }
  return bytes;
}

async function checksumBitsFor(entropyBytes) {
  const hash = await crypto.subtle.digest("SHA-256", entropyBytes);
  return bytesToBinaryString(new Uint8Array(hash)).slice(0, CHECKSUM_BITS);
}

/**
 * Encodes 32 bytes of entropy (a P-256 private scalar, per docs/accounts.md
 * D8) as a 24-word BIP39-style mnemonic: this is a direct, standard BIP39
 * encoding of the given entropy bytes -- NOT a key derivation. The same
 * raw bytes always produce the same mnemonic and vice versa.
 */
export async function bytesToMnemonic(entropyBytes) {
  if (entropyBytes.length !== ENTROPY_BYTES) {
    throw new Error(`Invalid entropy length: expected exactly ${ENTROPY_BYTES} bytes, got ${entropyBytes.length}`);
  }

  const entropyBits = bytesToBinaryString(entropyBytes);
  const checksumBits = await checksumBitsFor(entropyBytes);
  const combinedBits = entropyBits + checksumBits;

  const words = [];
  for (let i = 0; i < combinedBits.length; i += BITS_PER_WORD) {
    const index = parseInt(combinedBits.slice(i, i + BITS_PER_WORD), 2);
    words.push(BIP39_ENGLISH_WORDLIST[index]);
  }
  return words;
}

/**
 * Reverses bytesToMnemonic, verifying the BIP39 checksum. Throws if any
 * word isn't in the wordlist, the word count is wrong, or the checksum
 * doesn't match (a mistyped, reordered, or otherwise corrupted mnemonic
 * would fail this check rather than silently returning wrong bytes).
 */
export async function mnemonicToBytes(words) {
  if (words.length !== WORD_COUNT) {
    throw new Error(`Invalid mnemonic: expected exactly ${WORD_COUNT} words, got ${words.length}`);
  }

  const indices = words.map((word) => {
    const index = BIP39_ENGLISH_WORDLIST.indexOf(word);
    if (index === -1) {
      throw new Error(`Invalid mnemonic word: "${word}" is not in the BIP39 English wordlist`);
    }
    return index;
  });

  const combinedBits = indices.map((index) => index.toString(2).padStart(BITS_PER_WORD, "0")).join("");
  const entropyBitLength = ENTROPY_BYTES * 8;
  const entropyBits = combinedBits.slice(0, entropyBitLength);
  const providedChecksumBits = combinedBits.slice(entropyBitLength);

  const entropyBytes = binaryStringToBytes(entropyBits);
  const expectedChecksumBits = await checksumBitsFor(entropyBytes);

  if (providedChecksumBits !== expectedChecksumBits) {
    throw new Error("Invalid mnemonic checksum: words may be mistyped, reordered, or corrupted");
  }

  return entropyBytes;
}
