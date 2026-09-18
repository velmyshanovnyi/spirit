// Section A5/L3 (specs/phase5/lazy-loading.md): the 58KB qrcode vendor is
// only needed when a recovery share is displayed as a QR code, so it is
// imported lazily at first use (cached promise) instead of riding along on
// every startup. This makes qrSvgMarkup async.
let qrcodeModulePromise = null;
function loadQrcode() {
  if (!qrcodeModulePromise) {
    // A failed import must not poison the cache forever (exec-review note):
    // drop it so the next call retries the fetch.
    qrcodeModulePromise = import("./vendor/qrcode.esm.js").catch((err) => {
      qrcodeModulePromise = null;
      throw err;
    });
  }
  return qrcodeModulePromise;
}

/**
 * Renders `text` as a self-contained inline SVG QR code string.
 * typeNumber 0 lets the library auto-pick the smallest QR version that
 * fits the data; "M" error-correction matches the library's own default.
 */
export async function qrSvgMarkup(text, { cellSize = 4, margin = 2 } = {}) {
  const { default: qrcode } = await loadQrcode();
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag(cellSize, margin);
}
