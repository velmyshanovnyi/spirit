import { describe, it, expect } from "vitest";
import { bytesToBase64, base64ToBytes } from "../js/codec.js";

describe("bytesToBase64 / base64ToBytes", () => {
  it("round-trips arbitrary bytes", () => {
    const original = new Uint8Array([0, 1, 2, 253, 254, 255, 42]);
    expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
  });

  it("round-trips an empty array", () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it("handles buffers far larger than the JS call-argument spread limit", () => {
    const large = new Uint8Array(300_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(large))).toEqual(large);
  });

  it("handles a buffer length that's an exact multiple of the chunk size", () => {
    const exact = new Uint8Array(0x8000 * 2).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(exact))).toEqual(exact);
  });
});
