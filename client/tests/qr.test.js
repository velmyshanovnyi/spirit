// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { qrSvgMarkup } from "../js/qr.js";

describe("qrSvgMarkup", () => {
  it("renders a self-contained inline SVG for a given text payload", () => {
    const svg = qrSvgMarkup("spirit-share:1.2.3.abc123XYZ");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
  });

  it("produces different output for different input text (not a static placeholder)", () => {
    const a = qrSvgMarkup("spirit-share:1.2.3.aaaa");
    const b = qrSvgMarkup("spirit-share:9.9.9.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz");
    expect(a).not.toBe(b);
  });

  it("is deterministic for the same input", () => {
    const first = qrSvgMarkup("spirit-share:1.2.3.deterministic");
    const second = qrSvgMarkup("spirit-share:1.2.3.deterministic");
    expect(first).toBe(second);
  });
});
