// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { qrSvgMarkup } from "../js/qr.js";

describe("qrSvgMarkup", () => {
  it("renders a self-contained inline SVG for a given text payload", async () => {
    const svg = await qrSvgMarkup("spirit-share:1.2.3.abc123XYZ");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
  });

  it("produces different output for different input text (not a static placeholder)", async () => {
    const a = await qrSvgMarkup("spirit-share:1.2.3.aaaa");
    const b = await qrSvgMarkup("spirit-share:9.9.9.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");
    expect(a).not.toBe(b);
  });

  it("is deterministic for the same input", async () => {
    const first = await qrSvgMarkup("spirit-share:1.2.3.deterministic");
    const second = await qrSvgMarkup("spirit-share:1.2.3.deterministic");
    expect(first).toBe(second);
  });
});

describe("Section L3 (specs/phase5/lazy-loading.md): lazy qrcode vendor", () => {
  it("qrSvgMarkup now returns a Promise resolving to an inline SVG string", async () => {
    const result = qrSvgMarkup("lazy-check");
    expect(typeof result.then).toBe("function");
    const svg = await result;
    expect(svg).toContain("<svg");
  });
});
