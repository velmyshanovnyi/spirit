// Section FT1 (specs/phase4/file-transfer.md): pure chunking/reassembly/
// hashing core for file transfer over the existing WebRTC DataChannel.
// No DOM dependency, no app.js/state dependency -- integration into the
// live chat flow (control messages, backpressure, UI) is Section FT2.

import { createSHA256 } from "./vendor/hash-wasm.esm.js";

/**
 * Splits an ArrayBuffer into an array of Uint8Array chunks of exactly
 * `chunkSize` bytes each, except possibly the last one which may be
 * shorter. A file whose size is an exact multiple of `chunkSize` does NOT
 * get a spurious empty trailing chunk. An empty buffer yields zero chunks
 * (there is nothing meaningful to transfer).
 */
export function splitFileIntoChunks(arrayBuffer, chunkSize) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  const bytes = new Uint8Array(arrayBuffer);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.slice(offset, offset + chunkSize));
  }
  return chunks;
}

// Binary-safe base64 encode/decode. Deliberately NOT TextEncoder/TextDecoder
// (those interpret bytes as UTF-8 text and would corrupt arbitrary binary
// data) -- same String.fromCharCode-per-byte bridge pattern already used by
// bytesToBase64Url/base64UrlToBytes in client/js/webPushCrypto.js, minus the
// URL-safe alphabet swap since this goes straight into a JSON string field.

/** Encodes a chunk of raw bytes (Uint8Array or ArrayBuffer) as standard base64. */
export function chunkToBase64(chunkBytes) {
  const bytes = chunkBytes instanceof Uint8Array ? chunkBytes : new Uint8Array(chunkBytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Decodes a standard base64 string back into a Uint8Array of raw bytes. */
export function base64ToChunk(base64String) {
  return Uint8Array.from(atob(base64String), (c) => c.charCodeAt(0));
}

/**
 * SHA-256 of the whole file via Web Crypto, formatted as a lowercase hex
 * string -- the same convention `fingerprint()` uses in client/js/identity.js
 * (`[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")`),
 * kept consistent here rather than introducing a new format.
 */
export async function computeFileHash(arrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Internal read-window size for computeFileHashStreaming -- independent of
// the app's own configurable fileChunkSize (Section D0 deliberately keeps
// these separate: the DataChannel chunk size is a user-tunable transport
// concern, this is purely an internal memory-bound knob for hashing).
const HASH_STREAM_WINDOW_BYTES = 1024 * 1024;

/**
 * Section D0 (specs/reviews/spirit-evaluation-triage.md): streaming
 * SHA-256 over a File/Blob -- constant memory regardless of file size,
 * unlike computeFileHash(arrayBuffer) above which requires the whole file
 * already resident in memory. Reads via Blob.slice()/.arrayBuffer() in
 * fixed-size windows rather than Blob.stream() -- deliberately, since
 * jsdom's File polyfill (used by this project's own test suite) doesn't
 * implement .stream(), while .slice()/.arrayBuffer() work identically in
 * every real browser and in jsdom, so the exact same code path is
 * exercised by tests and production. Used on the SENDING side (app.js's
 * file-input handler); computeFileHash(buffer) is still used on the
 * RECEIVING side to verify a fully-reassembled buffer, where the whole
 * buffer is already necessarily in memory by the time verification
 * happens (createFileAssembler.assemble() below). Web Crypto's
 * SubtleCrypto.digest() has no incremental/streaming API in browsers,
 * hence the separate vendored WASM implementation
 * (vendor/hash-wasm.esm.js, already used elsewhere for Argon2id) -- both
 * produce byte-identical SHA-256 output for the same input, verified in
 * fileTransfer.test.js against Web Crypto's own known test vectors.
 */
export async function computeFileHashStreaming(blob) {
  const hasher = await createSHA256();
  hasher.init();
  for (let offset = 0; offset < blob.size; offset += HASH_STREAM_WINDOW_BYTES) {
    const window = blob.slice(offset, offset + HASH_STREAM_WINDOW_BYTES);
    hasher.update(new Uint8Array(await window.arrayBuffer()));
  }
  return hasher.digest("hex");
}

/**
 * How many chunks splitFileIntoChunks(arrayBuffer, chunkSize) WOULD have
 * produced for a buffer of `size` bytes, without needing the buffer itself
 * -- same empty-file-yields-zero-chunks and short-last-chunk semantics.
 */
export function countFileChunks(size, chunkSize) {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error("chunkSize must be a positive integer");
  }
  return Math.ceil(size / chunkSize);
}

/**
 * Reads chunk `index` (0-based) of a File/Blob directly via Blob.slice(),
 * without ever reading the rest of the file into memory -- the on-demand
 * counterpart to splitFileIntoChunks, which requires the whole file
 * pre-loaded into an ArrayBuffer. Same chunk boundaries countFileChunks
 * above describes.
 */
export async function readFileChunk(blob, index, chunkSize) {
  const start = index * chunkSize;
  const slice = blob.slice(start, start + chunkSize);
  return new Uint8Array(await slice.arrayBuffer());
}

/**
 * Creates a handle that accumulates chunks arriving in ANY order (the
 * DataChannel is ordered+reliable by default in this app, but that is
 * deliberately NOT relied upon here -- see spec Section FT1) and reassembles
 * them in correct INDEX order once complete.
 *
 * Duplicate-chunk policy: FIRST-WRITE-WINS. If `addChunk` is called twice
 * for the same index, the second call is ignored and the originally
 * received bytes for that index are kept.
 */
export function createFileAssembler(totalChunks) {
  if (!Number.isInteger(totalChunks) || totalChunks < 0) {
    throw new Error("totalChunks must be a non-negative integer");
  }
  const received = new Array(totalChunks);
  let receivedCount = 0;

  return {
    addChunk(index, chunkBytes) {
      if (!Number.isInteger(index) || index < 0 || index >= totalChunks) {
        throw new Error(`chunk index ${index} out of range [0, ${totalChunks})`);
      }
      if (received[index] !== undefined) return; // first-write-wins on duplicates
      received[index] = chunkBytes instanceof Uint8Array ? chunkBytes : new Uint8Array(chunkBytes);
      receivedCount += 1;
    },

    isComplete() {
      return receivedCount === totalChunks;
    },

    missingIndices() {
      const missing = [];
      for (let i = 0; i < totalChunks; i++) {
        if (received[i] === undefined) missing.push(i);
      }
      return missing;
    },

    assemble() {
      if (receivedCount !== totalChunks) {
        throw new Error(
          `cannot assemble: ${totalChunks - receivedCount} of ${totalChunks} chunks missing`
        );
      }
      let total = 0;
      for (let i = 0; i < totalChunks; i++) total += received[i].length;
      const out = new Uint8Array(total);
      let offset = 0;
      for (let i = 0; i < totalChunks; i++) {
        out.set(received[i], offset);
        offset += received[i].length;
      }
      return out.buffer;
    },
  };
}
