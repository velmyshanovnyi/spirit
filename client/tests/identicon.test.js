// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildIdenticonSvg } from "../js/identicon.js";

describe("buildIdenticonSvg", () => {
  it("is deterministic -- same hash produces the same SVG string every call", () => {
    const hash = "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef";
    expect(buildIdenticonSvg(hash)).toBe(buildIdenticonSvg(hash));
  });

  it("produces different output for different hashes (not a constant fallback)", () => {
    const hashA = "0".repeat(64);
    const hashB = "f".repeat(64);
    expect(buildIdenticonSvg(hashA)).not.toBe(buildIdenticonSvg(hashB));
  });

  it("returns a well-formed SVG string with a 100x100 viewBox and currentColor fill", () => {
    const svg = buildIdenticonSvg("abcdef0123456789abcdef0123456789");
    expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 100 100"[^>]*fill="currentColor"[^>]*>[\s\S]*<\/svg>$/);
  });

  it("parses as valid XML via DOMParser without a parser error", () => {
    const svg = buildIdenticonSvg("deadbeef");
    const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("svg")).not.toBeNull();
  });

  it("does not throw for a hash shorter than 25 hex characters (modular wraparound indexing)", () => {
    expect(() => buildIdenticonSvg("a")).not.toThrow();
    expect(() => buildIdenticonSvg("ab12")).not.toThrow();
    const svg = buildIdenticonSvg("f");
    expect(svg).toMatch(/^<svg/);
  });
});
