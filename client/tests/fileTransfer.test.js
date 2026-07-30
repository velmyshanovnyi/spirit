// Section FT1 (specs/phase4/file-transfer.md): pure chunking/reassembly/hashing
// core for file transfer over the DataChannel. No DOM, no app.js/state
// dependency -- exercised directly against client/js/fileTransfer.js.
import { describe, it, expect } from "vitest";
import {
  splitFileIntoChunks,
  chunkToBase64,
  base64ToChunk,
  computeFileHash,
  computeFileHashStreaming,
  countFileChunks,
  readFileChunk,
  createFileAssembler,
} from "../js/fileTransfer.js";

function bytesFrom(arr) {
  return new Uint8Array(arr).buffer;
}

describe("splitFileIntoChunks", () => {
  it("splits an exact multiple into equal chunks with no spurious trailing empty chunk", () => {
    const buf = new Uint8Array(32).map((_, i) => i).buffer; // 32 bytes, chunkSize 16 -> 2 chunks
    const chunks = splitFileIntoChunks(buf, 16);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(16);
    expect(chunks[1].length).toBe(16);
  });

  it("last chunk is shorter when size is not an exact multiple", () => {
    const buf = new Uint8Array(35).map((_, i) => i).buffer; // chunkSize 16 -> 16,16,3
    const chunks = splitFileIntoChunks(buf, 16);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(16);
    expect(chunks[1].length).toBe(16);
    expect(chunks[2].length).toBe(3);
  });

  it("a file smaller than one chunkSize produces exactly one short chunk", () => {
    const buf = new Uint8Array(5).map((_, i) => i + 1).buffer;
    const chunks = splitFileIntoChunks(buf, 16);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(5);
  });

  it("an empty file produces zero chunks", () => {
    const buf = new ArrayBuffer(0);
    const chunks = splitFileIntoChunks(buf, 16);
    expect(chunks.length).toBe(0);
  });

  it("throws on an invalid chunkSize", () => {
    const buf = new Uint8Array(10).buffer;
    expect(() => splitFileIntoChunks(buf, 0)).toThrow();
    expect(() => splitFileIntoChunks(buf, -1)).toThrow();
    expect(() => splitFileIntoChunks(buf, 1.5)).toThrow();
  });

  it("chunk contents match the source bytes at the correct offsets", () => {
    const buf = new Uint8Array(35).map((_, i) => i).buffer;
    const chunks = splitFileIntoChunks(buf, 16);
    expect(Array.from(chunks[0])).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(Array.from(chunks[1])).toEqual(Array.from({ length: 16 }, (_, i) => 16 + i));
    expect(Array.from(chunks[2])).toEqual([32, 33, 34]);
  });
});

describe("chunkToBase64 / base64ToChunk", () => {
  it("round-trips arbitrary binary data byte-for-byte, including 0x00 and full byte range", () => {
    const bytes = new Uint8Array(256).map((_, i) => i); // covers every byte value 0..255
    const b64 = chunkToBase64(bytes);
    const back = base64ToChunk(b64);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it("round-trips a chunk that is all zero bytes", () => {
    const bytes = new Uint8Array(16); // all 0x00
    const b64 = chunkToBase64(bytes);
    const back = base64ToChunk(b64);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it("round-trips a chunk that is all 0xff bytes", () => {
    const bytes = new Uint8Array(16).fill(0xff);
    const b64 = chunkToBase64(bytes);
    const back = base64ToChunk(b64);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it("round-trips random binary data across many trials", () => {
    for (let trial = 0; trial < 20; trial++) {
      const bytes = new Uint8Array(200);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
      const b64 = chunkToBase64(bytes);
      const back = base64ToChunk(b64);
      expect(Array.from(back)).toEqual(Array.from(bytes));
    }
  });
});

describe("computeFileHash", () => {
  it("is deterministic for the same input", async () => {
    const buf = bytesFrom([1, 2, 3, 4, 5]);
    const h1 = await computeFileHash(buf);
    const h2 = await computeFileHash(buf.slice(0));
    expect(h1).toBe(h2);
  });

  it("differs for different inputs", async () => {
    const h1 = await computeFileHash(bytesFrom([1, 2, 3]));
    const h2 = await computeFileHash(bytesFrom([1, 2, 4]));
    expect(h1).not.toBe(h2);
  });

  it("matches a known SHA-256 test vector for the empty string", async () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const hash = await computeFileHash(new ArrayBuffer(0));
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches a known SHA-256 test vector for the ASCII string 'abc'", async () => {
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const bytes = new TextEncoder().encode("abc");
    const hash = await computeFileHash(bytes.buffer);
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

// Section D0 (specs/reviews/spirit-evaluation-triage.md): the SENDING side
// used to call file.arrayBuffer() -- the whole file in memory at once --
// before hashing or chunking could even start. computeFileHashStreaming +
// readFileChunk/countFileChunks let the sender hash and chunk a File
// without ever holding more than one chunk (or one streaming-hash internal
// buffer) in memory at a time, regardless of file size.
describe("computeFileHashStreaming", () => {
  it("matches computeFileHash's result for the same content (cross-validates the two hashing paths the sender vs. receiver now use)", async () => {
    const bytes = new Uint8Array(5000).map((_, i) => i % 256);
    const viaBuffer = await computeFileHash(bytes.buffer);
    const viaStream = await computeFileHashStreaming(new Blob([bytes]));
    expect(viaStream).toBe(viaBuffer);
  });

  it("matches a known SHA-256 test vector for the empty string", async () => {
    const hash = await computeFileHashStreaming(new Blob([]));
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("matches a known SHA-256 test vector for the ASCII string 'abc'", async () => {
    const hash = await computeFileHashStreaming(new Blob(["abc"]));
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("streams a file larger than any single internal chunk correctly (multi-read-loop path)", async () => {
    // Blob.stream()'s default internal read size varies by engine but is
    // typically far under a megabyte -- this forces at least a few loop
    // iterations in computeFileHashStreaming's reader.read() loop.
    const bytes = new Uint8Array(2_000_000).map((_, i) => i % 256);
    const viaBuffer = await computeFileHash(bytes.buffer);
    const viaStream = await computeFileHashStreaming(new Blob([bytes]));
    expect(viaStream).toBe(viaBuffer);
  });
});

describe("countFileChunks", () => {
  it("matches splitFileIntoChunks's chunk count for an exact multiple", () => {
    expect(countFileChunks(32, 16)).toBe(2);
  });

  it("matches splitFileIntoChunks's chunk count when the last chunk is short", () => {
    expect(countFileChunks(35, 16)).toBe(3);
  });

  it("a zero-byte file has zero chunks", () => {
    expect(countFileChunks(0, 16)).toBe(0);
  });

  it("a file smaller than one chunkSize has exactly one chunk", () => {
    expect(countFileChunks(5, 16)).toBe(1);
  });
});

describe("readFileChunk", () => {
  it("reads the same bytes at each index as splitFileIntoChunks would have produced", async () => {
    const bytes = new Uint8Array(35).map((_, i) => i);
    const blob = new Blob([bytes]);
    const chunk0 = await readFileChunk(blob, 0, 16);
    const chunk1 = await readFileChunk(blob, 1, 16);
    const chunk2 = await readFileChunk(blob, 2, 16);
    expect(Array.from(chunk0)).toEqual(Array.from({ length: 16 }, (_, i) => i));
    expect(Array.from(chunk1)).toEqual(Array.from({ length: 16 }, (_, i) => 16 + i));
    expect(Array.from(chunk2)).toEqual([32, 33, 34]);
  });
});

describe("createFileAssembler", () => {
  it("isComplete is false until every index has arrived", () => {
    const assembler = createFileAssembler(3);
    expect(assembler.isComplete()).toBe(false);
    assembler.addChunk(0, new Uint8Array([1]));
    expect(assembler.isComplete()).toBe(false);
    assembler.addChunk(1, new Uint8Array([2]));
    expect(assembler.isComplete()).toBe(false);
    assembler.addChunk(2, new Uint8Array([3]));
    expect(assembler.isComplete()).toBe(true);
  });

  it("reports missing indices correctly at a partial state", () => {
    const assembler = createFileAssembler(5);
    assembler.addChunk(1, new Uint8Array([1]));
    assembler.addChunk(3, new Uint8Array([1]));
    expect(assembler.missingIndices()).toEqual([0, 2, 4]);
  });

  it("accepts chunks in reverse order and assembles correctly", () => {
    const assembler = createFileAssembler(3);
    assembler.addChunk(2, new Uint8Array([3]));
    assembler.addChunk(1, new Uint8Array([2]));
    assembler.addChunk(0, new Uint8Array([1]));
    expect(assembler.isComplete()).toBe(true);
    const result = new Uint8Array(assembler.assemble());
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });

  it("accepts chunks in shuffled order and assembles correctly", () => {
    const assembler = createFileAssembler(5);
    const order = [3, 0, 4, 1, 2];
    for (const idx of order) assembler.addChunk(idx, new Uint8Array([idx + 10]));
    expect(assembler.isComplete()).toBe(true);
    const result = new Uint8Array(assembler.assemble());
    expect(Array.from(result)).toEqual([10, 11, 12, 13, 14]);
  });

  it("a duplicate addChunk for an already-received index does not break assemble (first-write-wins)", () => {
    const assembler = createFileAssembler(2);
    assembler.addChunk(0, new Uint8Array([1, 1]));
    assembler.addChunk(1, new Uint8Array([2, 2]));
    assembler.addChunk(0, new Uint8Array([9, 9])); // duplicate, should be ignored per documented policy
    expect(assembler.isComplete()).toBe(true);
    const result = new Uint8Array(assembler.assemble());
    expect(Array.from(result)).toEqual([1, 1, 2, 2]);
  });

  it("assemble throws (not silently returns partial data) if called before isComplete", () => {
    const assembler = createFileAssembler(2);
    assembler.addChunk(0, new Uint8Array([1]));
    expect(() => assembler.assemble()).toThrow();
  });

  it("throws on an invalid totalChunks", () => {
    expect(() => createFileAssembler(-1)).toThrow();
    expect(() => createFileAssembler(1.5)).toThrow();
  });

  it("throws when addChunk is called with an out-of-range index", () => {
    const assembler = createFileAssembler(2);
    expect(() => assembler.addChunk(-1, new Uint8Array([1]))).toThrow();
    expect(() => assembler.addChunk(2, new Uint8Array([1]))).toThrow();
  });

  it("accepts an ArrayBuffer (not just Uint8Array) as chunk bytes in addChunk", () => {
    const assembler = createFileAssembler(1);
    assembler.addChunk(0, new Uint8Array([7, 8]).buffer);
    const result = new Uint8Array(assembler.assemble());
    expect(Array.from(result)).toEqual([7, 8]);
  });

  it("handles zero total chunks as already complete with an empty assembled result", () => {
    const assembler = createFileAssembler(0);
    expect(assembler.isComplete()).toBe(true);
    expect(assembler.missingIndices()).toEqual([]);
    const result = new Uint8Array(assembler.assemble());
    expect(result.length).toBe(0);
  });
});

describe("full round-trip: split -> base64 -> reassemble -> hash", () => {
  it("byte-for-byte identical after a full multi-chunk round-trip at the spec's 16KB chunk size", async () => {
    const CHUNK_SIZE = 16 * 1024;
    const totalSize = CHUNK_SIZE * 50 + 12345; // ~800KB, dozens of chunks, non-multiple last chunk
    const original = new Uint8Array(totalSize);
    for (let i = 0; i < original.length; i++) original[i] = (i * 7 + 3) % 256;

    const chunks = splitFileIntoChunks(original.buffer, CHUNK_SIZE);
    expect(chunks.length).toBe(51);

    const assembler = createFileAssembler(chunks.length);
    // shuffle arrival order deterministically (reverse) to prove index-based reassembly
    for (let i = chunks.length - 1; i >= 0; i--) {
      const b64 = chunkToBase64(chunks[i]);
      const back = base64ToChunk(b64);
      assembler.addChunk(i, back);
    }
    expect(assembler.isComplete()).toBe(true);
    const reassembled = new Uint8Array(assembler.assemble());
    expect(reassembled.length).toBe(original.length);
    expect(Array.from(reassembled)).toEqual(Array.from(original));

    const originalHash = await computeFileHash(original.buffer);
    const reassembledHash = await computeFileHash(reassembled.buffer);
    expect(originalHash).toBe(reassembledHash);
  });
});
