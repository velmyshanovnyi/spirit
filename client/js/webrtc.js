const DATA_CHANNEL_LABEL = "spirit-chat-stream";

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
  onError,
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection
} = {}) {
  const pc = new RTCPeerConnectionImpl(rtcConfig);
  const channel = pc.createDataChannel(DATA_CHANNEL_LABEL);
  wireChannel(channel, { onChannelOpen, onMessage, onChannelClose });

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
  onError,
  RTCPeerConnectionImpl = globalThis.RTCPeerConnection
} = {}) {
  const pc = new RTCPeerConnectionImpl(rtcConfig);

  pc.ondatachannel = (event) => {
    wireChannel(event.channel, { onChannelOpen, onMessage, onChannelClose });
  };

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
