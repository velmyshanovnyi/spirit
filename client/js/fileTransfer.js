// Section FT1 (specs/phase4/file-transfer.md): pure chunking/reassembly/
// hashing core for file transfer over the existing WebRTC DataChannel.
// No DOM dependency, no app.js/state dependency -- integration into the
// live chat flow (control messages, backpressure, UI) is Section FT2.

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
