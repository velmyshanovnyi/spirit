import qrcode from "./vendor/qrcode.esm.js";

/**
 * Renders `text` as a self-contained inline SVG QR code string.
 * typeNumber 0 lets the library auto-pick the smallest QR version that
 * fits the data; "M" error-correction matches the library's own default.
 */
export function qrSvgMarkup(text, { cellSize = 4, margin = 2 } = {}) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag(cellSize, margin);
}
