import { getSetting } from "./settingsRegistry.js";
import {
  computeFileHashStreaming,
  countFileChunks,
  createFileAssembler,
  chunkToBase64,
  base64ToChunk,
  computeFileHash,
  readFileChunk
} from "./fileTransfer.js";
import { encryptMessage } from "./e2ee.js";

function randomFileId() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Section G1 (specs/reviews/spirit-evaluation-triage.md): fifth and last
 * module extracted out of app.js's initApp() closure -- the three UI entry
 * points for file transfer (#file-input's change handler that starts a
 * SEND, #btn-file-accept, #btn-file-reject). Like deviceLinkingUI.js, this
 * reads AND writes `state` (state.outgoingFileTransfers/
 * state.pendingFileOffers/state.incomingFileTransfers), so `state` is
 * passed in by reference, not destructured.
 *
 * Section C2 (specs/phase5/core-dispatch.md): since the dispatcher table
 * (C1) the RECEIVING side moved here too -- renderFileTransferStatus, the
 * offer banner, the download row, the chunk-streaming loop (Section D0)
 * and the four control handlers (file-offer/accept/reject/chunk), all
 * verbatim from app.js. The handlers are returned as `fileControlHandlers`
 * for app.js's CONTROL_HANDLERS table; the identity gate
 * (`state.peerFingerprint`) stays inside each handler.
 */
export function initFileTransferUI({ doc, el, t, state, setDynamicText, noteIncomingForDrawer }) {
  // Section FT2 (specs/phase4/file-transfer.md), architectural decisions:
  // raw-byte chunks (base64'd into JSON control messages, consistent with
  // the existing "everything is JSON text" control pattern), a bufferedAmount
  // backpressure threshold (avoids overflowing the WebRTC SCTP send buffer
  // on large files), and a soft UI size warning (no hard limit -- the whole
  // file is held in RAM for the duration of a transfer, by deliberate
  // zero-database design) -- all three now user-tunable (Section RF13 Stage
  // 2, client/js/settingsRegistry.js: fileChunkSize,
  // bufferedAmountHighThresholdBytes, fileSizeWarningBytes), defaults
  // unchanged from the original hardcoded 16KB/1MB/100MB.
  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Renders/updates a one-line status row for a given transfer inside the
  // file-transfers list, creating it on first use. Returns the row element
  // so callers (e.g. the download-ready path) can append richer content
  // (a download link) beyond plain text.
  function renderFileTransferStatus(fileId, text) {
    const container = el("file-transfers");
    if (!container) return null;
    let row = doc.getElementById(`file-transfer-${fileId}`);
    if (!row) {
      row = doc.createElement("div");
      row.id = `file-transfer-${fileId}`;
      row.className = "file-transfer-row";
      container.appendChild(row);
    }
    row.textContent = text;
    return row;
  }

  function renderFileOfferBanner(offer) {
    const banner = el("file-offer-banner");
    if (!banner) return;
    setDynamicText(el("file-offer-text"), t("fileTransfer.offer", { name: offer.name, size: formatFileSize(offer.size) }));
    banner.hidden = false;
    banner.dataset.fileId = offer.fileId;
    noteIncomingForDrawer();
  }

  // Called once the last chunk of an accepted transfer has been verified
  // against its announced SHA-256 -- exposes the reassembled bytes as a
  // downloadable link. NEVER called on a hash mismatch (see onFileChunk
  // below): a corrupted/incomplete file must never
  // reach this function, so there is no code path here that could offer an
  // unverified Blob as if it were a completed, trustworthy download.
  function renderFileTransferDownload(fileId, name, mimeType, buffer) {
    const row = renderFileTransferStatus(fileId, t("fileTransfer.complete", { name }));
    if (!row) return;
    const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = doc.createElement("a");
    link.href = url;
    link.download = name;
    link.textContent = t("fileTransfer.downloadLink");
    row.appendChild(link);
  }

  // Backpressure (spec Section, "Архітектурні рішення" #3): before sending
  // each chunk, checked against channel.bufferedAmount; if over threshold,
  // waits for the channel's bufferedamountlow event rather than firing all
  // chunks synchronously, which could overflow the WebRTC send buffer and
  // tear down the connection on large files.
  function waitForBufferedAmountLow(channel) {
    return new Promise((resolve) => {
      channel.onbufferedamountlow = () => {
        channel.onbufferedamountlow = null;
        resolve();
      };
    });
  }

  // Streams the chunks of an already-accepted outgoing transfer. Only ever
  // invoked from onFileAccept below (the "file-accept" control handler) -- NOT
  // from the file-picker handler -- so no chunk is ever sent before the
  // peer has explicitly accepted the offer.
  async function sendFileChunks(fileId) {
    const transfer = state.outgoingFileTransfers[fileId];
    if (!transfer || !state.channel || !state.sessionKey) return;
    const channel = state.channel;
    const bufferedAmountHighThreshold = getSetting("bufferedAmountHighThresholdBytes");
    channel.bufferedAmountLowThreshold = bufferedAmountHighThreshold;
    for (let index = transfer.sentCount; index < transfer.totalChunks; index++) {
      // The transfer can vanish mid-flight (peer session reset) -- stop
      // rather than keep pushing chunks nobody will ever assemble.
      if (!state.outgoingFileTransfers[fileId] || state.channel !== channel) return;
      if (channel.bufferedAmount > bufferedAmountHighThreshold) {
        await waitForBufferedAmountLow(channel);
      }
      // Section D0: read this ONE chunk directly off disk via the File
      // object rather than indexing into a whole-file array held in
      // memory since selection time.
      const chunkBytes = await readFileChunk(transfer.file, index, transfer.chunkSize);
      const data = chunkToBase64(chunkBytes);
      channel.send(await encryptMessage(state.sessionKey, JSON.stringify({ type: "file-chunk", fileId, index, data })));
      transfer.sentCount = index + 1;
      renderFileTransferStatus(
        fileId,
        t("fileTransfer.progressSending", { name: transfer.name, sent: transfer.sentCount, total: transfer.totalChunks })
      );
    }
    delete state.outgoingFileTransfers[fileId];
  }

  // Section FT2 (specs/phase4/file-transfer.md): selecting a file only ever
  // computes its hash/chunks and sends a file-offer -- chunks are NEVER
  // sent here. Actual chunk streaming happens exclusively in
  // sendFileChunks() (below), which is only reachable from the
  // "file-accept" branch of handleChatMessage, once the peer has
  // explicitly accepted.
  const fileInput = el("file-input");
  if (fileInput) {
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file || !state.channel || !state.sessionKey || !state.peerFingerprint) return;
      // Section D0 (specs/reviews/spirit-evaluation-triage.md): the whole
      // file used to be read into memory here (file.arrayBuffer()) before
      // hashing or chunking could even start -- constant-memory streaming
      // hash instead; chunks themselves are read on demand in
      // sendFileChunks() (below) via readFileChunk(), never pre-split
      // into a held-in-memory array.
      const sha256 = await computeFileHashStreaming(file);
      const chunkSize = getSetting("fileChunkSize");
      const totalChunks = countFileChunks(file.size, chunkSize);
      const fileId = randomFileId();
      state.outgoingFileTransfers[fileId] = {
        file,
        chunkSize,
        totalChunks,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        sentCount: 0
      };
      state.channel.send(
        await encryptMessage(
          state.sessionKey,
          JSON.stringify({
            type: "file-offer",
            fileId,
            name: file.name,
            size: file.size,
            mimeType: file.type,
            sha256,
            totalChunks
          })
        )
      );
      const statusText =
        file.size > getSetting("fileSizeWarningBytes")
          ? t("fileTransfer.sizeWarning", { name: file.name })
          : t("fileTransfer.progressSending", { name: file.name, sent: 0, total: totalChunks });
      renderFileTransferStatus(fileId, statusText);
    });
  }

  const btnFileAccept = el("btn-file-accept");
  if (btnFileAccept) {
    btnFileAccept.addEventListener("click", async () => {
      const banner = el("file-offer-banner");
      const fileId = banner && banner.dataset.fileId;
      const offer = fileId && state.pendingFileOffers[fileId];
      if (!offer || !state.channel || !state.sessionKey) return;
      delete state.pendingFileOffers[fileId];
      banner.hidden = true;
      state.incomingFileTransfers[fileId] = {
        assembler: createFileAssembler(offer.totalChunks),
        name: offer.name,
        mimeType: offer.mimeType,
        sha256: offer.sha256,
        totalChunks: offer.totalChunks
      };
      renderFileTransferStatus(
        fileId,
        t("fileTransfer.progressReceiving", { name: offer.name, received: 0, total: offer.totalChunks })
      );
      state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify({ type: "file-accept", fileId })));
    });
  }

  const btnFileReject = el("btn-file-reject");
  if (btnFileReject) {
    btnFileReject.addEventListener("click", async () => {
      const banner = el("file-offer-banner");
      const fileId = banner && banner.dataset.fileId;
      const offer = fileId && state.pendingFileOffers[fileId];
      if (!offer || !state.channel || !state.sessionKey) return;
      delete state.pendingFileOffers[fileId];
      banner.hidden = true;
      state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify({ type: "file-reject", fileId })));
    });
  }

  // Section FT2 (specs/phase4/file-transfer.md): same trust gate as plain
  // chat text -- an unverified peer must not be able to push file offers
  // or consume this side's attention/bandwidth before proving identity.
  async function onFileOffer(control) {
    if (!state.peerFingerprint) return;
    state.pendingFileOffers[control.fileId] = control;
    renderFileOfferBanner(control);
    return;
  }

  async function onFileAccept(control) {
    if (!state.peerFingerprint) return;
    // Ignore accepts for a fileId this side never offered (or already
    // finished/rejected) -- defensive against stale/duplicate/spoofed
    // control messages, mirrors how the other branches above silently
    // drop unexpected input rather than throwing.
    if (!state.outgoingFileTransfers[control.fileId]) return;
    void sendFileChunks(control.fileId);
    return;
  }

  async function onFileReject(control) {
    if (!state.peerFingerprint) return;
    const transfer = state.outgoingFileTransfers[control.fileId];
    if (!transfer) return;
    delete state.outgoingFileTransfers[control.fileId];
    renderFileTransferStatus(control.fileId, t("fileTransfer.rejected", { name: transfer.name }));
    return;
  }

  async function onFileChunk(control) {
    if (!state.peerFingerprint) return;
    // Only accepted for a fileId THIS side genuinely has an active
    // assembler for -- a peer sending a file-chunk for a fileId that was
    // never offered/accepted (or reusing another transfer's fileId to
    // inject chunks into an in-progress assembly) is silently dropped.
    const transfer = state.incomingFileTransfers[control.fileId];
    if (!transfer) return;
    let bytes;
    try {
      bytes = base64ToChunk(control.data);
      transfer.assembler.addChunk(control.index, bytes);
    } catch {
      return; // malformed base64 or out-of-range index -- drop, not throw
    }
    const received = transfer.totalChunks - transfer.assembler.missingIndices().length;
    renderFileTransferStatus(
      control.fileId,
      t("fileTransfer.progressReceiving", { name: transfer.name, received, total: transfer.totalChunks })
    );
    if (transfer.assembler.isComplete()) {
      const buffer = transfer.assembler.assemble();
      const hash = await computeFileHash(buffer);
      if (hash === transfer.sha256) {
        renderFileTransferDownload(control.fileId, transfer.name, transfer.mimeType, buffer);
      } else {
        // Explicit failure per spec: a hash mismatch must NEVER offer a
        // download link for the corrupted/incomplete result.
        renderFileTransferStatus(control.fileId, t("fileTransfer.hashMismatch", { name: transfer.name }));
      }
      delete state.incomingFileTransfers[control.fileId];
    }
    return;
  }

  const fileControlHandlers = {
    "file-offer": onFileOffer,
    "file-accept": onFileAccept,
    "file-reject": onFileReject,
    "file-chunk": onFileChunk
  };
  return { fileControlHandlers, renderFileTransferStatus };
}
