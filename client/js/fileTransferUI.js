import { getSetting } from "./settingsRegistry.js";
import { computeFileHashStreaming, countFileChunks, createFileAssembler } from "./fileTransfer.js";
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
 * renderFileTransferStatus stays in app.js and is passed in rather than
 * moved: it's also called from handleChatMessage's file-chunk/file-offer
 * control-message branches (the RECEIVING side of the protocol), which is
 * core chat-message-handling logic shared with plain text messages and
 * mesh relay -- out of scope for this extraction, too risky to touch here.
 * sendFileChunks (the actual chunk-streaming loop, Section D0) is likewise
 * only reachable from handleChatMessage's "file-accept" branch and stays
 * there untouched.
 */
export function initFileTransferUI({ doc, el, t, state, renderFileTransferStatus }) {
  // Section FT2 (specs/phase4/file-transfer.md): selecting a file only ever
  // computes its hash/chunks and sends a file-offer -- chunks are NEVER
  // sent here. Actual chunk streaming happens exclusively in
  // sendFileChunks() (app.js), which is only reachable from the
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
      // sendFileChunks() (app.js) via readFileChunk(), never pre-split
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
}
