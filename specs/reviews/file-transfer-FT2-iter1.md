---
spec: phase4/file-transfer
section: FT2
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/app.js
  - client/index.html
  - client/js/i18n.js
  - client/tests/app.test.js
---

Zero blocking findings. Reviewer verified against 8 scrutiny points requested:

1. **No-chunks-before-accept: enforced in code, not test coincidence.** The file-picker `change` handler only sends `file-offer`; `sendFileChunks` is reachable exclusively from the `file-accept` branch of `handleChatMessage`.
2. **Backpressure is genuine.** `sendFileChunks` checks `channel.bufferedAmount > BUFFERED_AMOUNT_HIGH_THRESHOLD` before each chunk and awaits the real `bufferedamountlow` callback via `waitForBufferedAmountLow`.
3. **Hash-mismatch path unreachable-to-download.** `renderFileTransferDownload` is only called inside the `hash === transfer.sha256` branch; the `else` shows an explicit error and deletes the assembler entry. `assemble()` also throws if incomplete.
4. **Unverified-peer gate present on all four new control types.** `file-offer`/`file-accept`/`file-reject`/`file-chunk` branches each open with `if (!state.peerFingerprint) return;`, matching the existing plain-chat-text gate.
5. **No fileId spoofing/injection.** `file-chunk` requires `state.incomingFileTransfers[control.fileId]` to already exist, which only the Accept button creates -- an offer alone never creates an assembler, and a peer cannot inject chunks into a transfer it never had accepted.
6. **No egregious memory waste** beyond what the already-accepted "no hard size limit" design implies -- chunks are split once, `assemble()` does a single linear copy.
7. **State-reset correctness confirmed.** All four `hideSafetyNumberHint()` call sites (session teardown/start) are paired with `state.peerFingerprint = null` and never fire mid-transfer in an established session. **No XSS**: peer-supplied file names only ever reach `textContent`/`link.download`, never `innerHTML`. The `file-chunk` branch wraps `base64ToChunk`/`addChunk` in try/catch and drops malformed input rather than throwing.
8. **Multiple simultaneous incoming offers** -- confirmed real but non-blocking limitation (N1 below).

Two non-blocking observations, both narrow edge cases, dismissed for this section without further code changes (documented here and in the spec instead, per the dismissibility rule -- concrete reasoning + reviewer evidence):

- **N1**: `client/js/app.js`, `renderFileOfferBanner` (`banner.dataset.fileId = offer.fileId;`) -- a second incoming `file-offer` arriving before the first is accepted/rejected overwrites the single banner's `dataset.fileId`; the first offer remains in `pendingFileOffers` but becomes unreachable from the UI until session reset. Only affects the multi-simultaneous-incoming-offer case, not the primary one-at-a-time flow this section targets.
- **N2**: `client/js/app.js`, `sendFileChunks`/`waitForBufferedAmountLow` (`channel.onbufferedamountlow = () => {`) -- if two accepted OUTGOING transfers both hit backpressure concurrently, the second overwrites the first's handler, and only the second transfer's wait resolves when the event fires; the first stalls. Requires two overlapping large outgoing transfers saturating the same channel simultaneously -- narrow, does not affect the common single-transfer path.

Convergence: reached on iteration 1, no re-review needed. Both non-blocking findings are recorded as known limitations of this first cut (single-offer-at-a-time UI, single in-flight backpressure wait per channel) rather than fixed, since fixing either would require a multi-offer queue / per-transfer backpressure tracking that's out of scope for this section's "get the exchange working end-to-end" goal -- left as a documented follow-up if concurrent multi-file transfer becomes a real use case.
