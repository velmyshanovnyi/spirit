// Section C5 (specs/phase5/core-dispatch.md, backlog A4): the call/media
// domain -- local camera/mic preview, adding tracks to the peer connection,
// the owner's auto-call and the mic/camera toggles (room-first RF2), the
// webrtc-call-offer/answer control handlers -- extracted verbatim out of
// app.js's initApp() closure, plus stopLocalMedia(): the media half of the
// teardown that app.js's logout/leave and connection-torn-down paths used
// to duplicate line for line. `state` is the same mutable object app.js
// holds (localStream, localMediaPreviewPromise/TimeoutId,
// localTracksAddedToPeer, callOfferSent, pc, channel, sessionKey, …).
import {
  addLocalMediaTracks,
  createRenegotiationOffer,
  createRenegotiationAnswer,
  applyRenegotiationAnswer
} from "./webrtc.js";
import { encryptMessage } from "./e2ee.js";

export function initCallUI({ doc, el, t, state }) {
  const setVideoStatus = (text) => {
    el("video-status").textContent = text;
  };

  // Reflects real on/off state on the icon call-controls (.active, styled in
  // style.css) rather than leaving them looking identical whether camera/mic
  // are live or not -- a plain :hover/:focus ring isn't enough to tell.
  // camera/mic reflect their own track.enabled (room-first RF2: there is no
  // separate "call" button any more).
  function updateCallButtonStates() {
    const hasStream = !!state.localStream;
    const tracks = hasStream ? state.localStream.getTracks() : [];
    const videoEnabled = tracks.some((track) => track.kind === "video" && track.enabled);
    const audioEnabled = tracks.some((track) => track.kind === "audio" && track.enabled);
    // Room-first RF2: the toggles are real toggle buttons (aria-pressed).
    el("btn-toggle-camera")?.classList.toggle("active", videoEnabled);
    el("btn-toggle-camera")?.setAttribute("aria-pressed", String(videoEnabled));
    el("btn-toggle-mic")?.classList.toggle("active", audioEnabled);
    el("btn-toggle-mic")?.setAttribute("aria-pressed", String(audioEnabled));
  }

  // Section F6 (instant conversation lobby, 2026-07-17): local camera/mic
  // preview only -- no peer connection involved, so this is safe to call the
  // moment the conversation screen opens, before any peer has joined. Errors
  // (permission denied, no camera) are reported via video-status but never
  // block the chat itself.
  async function previewLocalMedia() {
    if (state.localStream) return state.localStream;
    if (state.localMediaPreviewPromise) return state.localMediaPreviewPromise;
    state.localMediaPreviewPromise = (async () => {
      try {
        const stream = await doc.defaultView.navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        state.localStream = stream;
        el("video-local").srcObject = stream;
        el("btn-toggle-camera").disabled = false;
        el("btn-toggle-mic").disabled = false;
        updateCallButtonStates();
        return stream;
      } catch (err) {
        setVideoStatus(t("status.error", { msg: err.message }));
        return null;
      } finally {
        state.localMediaPreviewPromise = null;
      }
    })();
    return state.localMediaPreviewPromise;
  }

  // Auto-accept (Section V2, specs/ui/video-call.md): actually PUSHING our
  // camera+mic to the peer, once a chat channel exists to renegotiate over.
  // Reuses whatever previewLocalMedia() already acquired rather than
  // prompting getUserMedia a second time, and only ever adds tracks to the
  // peer connection once (a second startCall() must not duplicate tracks on
  // the same pc).
  async function acquireLocalStream() {
    const stream = await previewLocalMedia();
    if (stream && !state.localTracksAddedToPeer) {
      addLocalMediaTracks(state.pc, stream);
      state.localTracksAddedToPeer = true;
    }
    return stream;
  }

  async function onWebrtcCallOffer(control) {
    // Same trust gate as plain chat text (line ~309 above): don't turn on
    // the camera/mic for a peer whose identity hasn't been verified yet.
    if (!state.peerFingerprint) {
      setVideoStatus(t("status.incomingRejected"));
      return;
    }
    try {
      await acquireLocalStream();
      const answer = await createRenegotiationAnswer(state.pc, control.sdp);
      state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify({ type: "webrtc-call-answer", sdp: answer })));
    } catch (err) {
      setVideoStatus(t("status.error", { msg: err.message }));
    }
    return;
  }

  async function onWebrtcCallAnswer(control) {
    await applyRenegotiationAnswer(state.pc, control.sdp);
    return;
  }

  // Room-first RF2 (specs/ui/room-first.md): the former btn-start-call body
  // -- adds the local tracks to the peer connection and sends the
  // renegotiation offer. Called by onChannelOpen (owner with a preview
  // stream) and by the first mic/camera tap once a channel is open.
  async function startCall() {
    // sessionKey guard (exec review iter1): a channel can be open before the
    // key is derived; encrypting with an undefined key would throw and the
    // call would look dead. callOfferSent (not localTracksAddedToPeer) gates
    // re-entry so a FAILED offer stays retryable from the next tap.
    if (!state.channel || !state.pc || !state.sessionKey || state.callOfferSent) return;
    state.callOfferSent = true;
    try {
      await acquireLocalStream();
      const offer = await createRenegotiationOffer(state.pc);
      state.channel.send(await encryptMessage(state.sessionKey, JSON.stringify({ type: "webrtc-call-offer", sdp: offer })));
      updateCallButtonStates();
    } catch (err) {
      state.callOfferSent = false;
      setVideoStatus(t("status.error", { msg: err.message }));
    }
  }

  // Room-first RF2 (exec review iter1): the invite owner's automatic offer.
  // Triggered from the identity-announce handler once the PEER is verified
  // -- which proves both session keys exist and the peer processed the
  // channel in order -- and only after our OWN announce went out (the
  // announcer's in-flight promise), so the peer never sees an offer before
  // our announce and rejects it for lack of a peerFingerprint.
  async function autoStartOwnerCall() {
    // Stale-write guard (exec review RF2 iter2): if the room was switched
    // while the announce was in flight, don't offer on the NEW connection
    // (its peer isn't verified yet and would reject the offer).
    const connectionIdAtStart = state.activeConnectionId;
    try {
      await state.ownAnnouncePromise;
    } catch {
      // the announce path reports its own failure; still try the offer
    }
    if (state.activeConnectionId !== connectionIdAtStart) return;
    await startCall();
  }

  // Room-first RF2: one handler for both toggles. No stream yet -> acquire
  // media with ONLY the tapped kind enabled (the other stays muted until
  // its own tap); stream present -> flip that kind. Either way, if a
  // channel is open and the tracks were never added, this tap also starts
  // the call.
  async function onMediaToggle(kind) {
    if (!state.localStream) {
      const stream = await previewLocalMedia();
      if (!stream) return;
      for (const track of stream.getTracks()) track.enabled = track.kind === kind;
    } else {
      for (const track of state.localStream.getTracks()) {
        if (track.kind === kind) track.enabled = !track.enabled;
      }
    }
    updateCallButtonStates();
    // Only offer to a VERIFIED peer (the peer rejects offers before it has a
    // peerFingerprint). Before verification the owner's auto-call covers it;
    // a joiner that tapped early offers on its next tap.
    if (state.channel && state.pc && state.peerFingerprint && !state.callOfferSent) await startCall();
  }
  el("btn-toggle-camera").addEventListener("click", () => {
    void onMediaToggle("video");
  });
  el("btn-toggle-mic").addEventListener("click", () => {
    void onMediaToggle("audio");
  });

  // Section C5: shared media teardown (was duplicated in app.js's
  // teardownMediaAndConnection and handleConnectionTornDown).
  function stopLocalMedia() {
    if (state.localMediaPreviewTimeoutId) {
      clearTimeout(state.localMediaPreviewTimeoutId);
      state.localMediaPreviewTimeoutId = null;
    }
    if (state.localStream) {
      for (const track of state.localStream.getTracks()) track.stop();
    }
    state.localStream = null;
    state.localTracksAddedToPeer = false;
    state.callOfferSent = false;
    updateCallButtonStates();
    el("video-remote").hidden = true;
    el("video-remote").srcObject = null;
  }

  const callControlHandlers = {
    "webrtc-call-offer": onWebrtcCallOffer,
    "webrtc-call-answer": onWebrtcCallAnswer
  };
  return { callControlHandlers, previewLocalMedia, acquireLocalStream, updateCallButtonStates, stopLocalMedia, setVideoStatus, autoStartOwnerCall };
}
