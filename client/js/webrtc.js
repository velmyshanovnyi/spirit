const DATA_CHANNEL_LABEL = "spirit-chat-stream";

// Section P1(a), specs/phase5/security-hardening.md: pure/testable builder for
// the RTCConfiguration used at every peer-connection-construction call site.
// When forceTurnRelay is off (default), the returned object omits
// iceTransportPolicy entirely -- NOT "all" -- so existing behavior for every
// user who never touches the new toggle is byte-for-byte unchanged.
// Section B3 (specs/reviews/spirit-evaluation-triage.md): turn: URIs have
// no userinfo component -- there was previously no way to configure a real
// TURN server's long-term credentials at all, so "force TURN relay" always
// broke every connection (no TURN candidates could ever be gathered).
// turnUrl/turnUsername/turnCredential add a SECOND iceServers entry
// alongside the STUN one, only when a TURN URL is actually given.
export function buildRtcConfig(stunUrl, { forceTurnRelay = false, turnUrl = "", turnUsername = "", turnCredential = "" } = {}) {
  const config = { iceServers: [{ urls: stunUrl }] };
  if (turnUrl) {
    config.iceServers.push({ urls: turnUrl, username: turnUsername, credential: turnCredential });
  }
  if (forceTurnRelay) config.iceTransportPolicy = "relay";
  return config;
}

function wireChannel(channel, { onChannelOpen, onMessage, onChannelClose }) {
  channel.onopen = () => onChannelOpen?.(channel);
  channel.onmessage = (event) => onMessage?.(event.data);
  channel.onclose = () => onChannelClose?.();
}

export function startAsInitiator({
  rtcConfig,
  onLocalOfferReady,
  onChannelOpen,
  onMessage,
  onChannelClose,
  onConnectionStateChange,
  onError,
  onRemoteTrack,
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection
} = {}) {
  const pc = new RTCPeerConnectionImpl(rtcConfig);
  const channel = pc.createDataChannel(DATA_CHANNEL_LABEL);
  wireChannel(channel, { onChannelOpen, onMessage, onChannelClose });

  // Wired at pc-creation time, not lazily when THIS side starts a call --
  // the peer may add media tracks first (Section V1, specs/ui/video-call.md).
  pc.ontrack = (event) => onRemoteTrack?.(event.streams[0]);

  // Section B4 (specs/reviews/spirit-evaluation-triage.md): connectionState
  // is the aggregate ICE+DTLS summary ("new"/"connecting"/"connected"/
  // "disconnected"/"failed"/"closed") -- the client previously had ZERO
  // listeners for this or iceConnectionState anywhere, so a peer that
  // vanished without a clean DataChannel close (network drop, tab closed,
  // NAT rebind) left the UI showing "connected" forever.
  pc.onconnectionstatechange = () => onConnectionStateChange?.(pc.connectionState);

  pc.onicecandidate = (event) => {
    if (event.candidate === null) {
      onLocalOfferReady?.(pc.localDescription);
    }
  };

  (async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
    } catch (err) {
      onError?.(err);
    }
  })();

  return pc;
}

export function startAsJoiner({
  rtcConfig,
  offerSdp,
  onLocalAnswerReady,
  onChannelOpen,
  onMessage,
  onChannelClose,
  onConnectionStateChange,
  onError,
  onRemoteTrack,
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection
} = {}) {
  const pc = new RTCPeerConnectionImpl(rtcConfig);

  pc.ondatachannel = (event) => {
    wireChannel(event.channel, { onChannelOpen, onMessage, onChannelClose });
  };

  pc.ontrack = (event) => onRemoteTrack?.(event.streams[0]);

  // Section B4: same rationale as startAsInitiator above.
  pc.onconnectionstatechange = () => onConnectionStateChange?.(pc.connectionState);

  pc.onicecandidate = (event) => {
    if (event.candidate === null) {
      onLocalAnswerReady?.(pc.localDescription);
    }
  };

  (async () => {
    try {
      await pc.setRemoteDescription(offerSdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
    } catch (err) {
      onError?.(err);
    }
  })();

  return pc;
}

// Called by the caller (Section 5 UI wiring) once the joiner's SDP answer
// comes back via the signaling server, to complete the initiator's handshake.
export function applyRemoteAnswer(pc, answerSdp) {
  return pc.setRemoteDescription(answerSdp);
}

// Video call (Section V1, specs/ui/video-call.md): adding media tracks to
// an already-connected peer connection requires a NEW offer/answer round,
// but -- unlike the initial handshake -- it travels over the already-open,
// already-encrypted data channel (app.js), not the signaling server, and
// doesn't wait for ICE gathering: extra tracks on an established connection
// reuse the same network path, no new candidates are typically needed.

export function addLocalMediaTracks(pc, stream) {
  for (const track of stream.getTracks()) {
    pc.addTrack(track, stream);
  }
}

export async function createRenegotiationOffer(pc) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  return offer;
}

export async function createRenegotiationAnswer(pc, offerSdp) {
  await pc.setRemoteDescription(offerSdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  return answer;
}

export function applyRenegotiationAnswer(pc, answerSdp) {
  return pc.setRemoteDescription(answerSdp);
}
