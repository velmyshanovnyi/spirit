import { describe, it, expect, vi } from "vitest";
import {
  startAsInitiator,
  startAsJoiner,
  applyRemoteAnswer,
  addLocalMediaTracks,
  createRenegotiationOffer,
  createRenegotiationAnswer,
  applyRenegotiationAnswer
} from "../js/webrtc.js";

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeFakeChannel() {
  return { onopen: null, onmessage: null, onclose: null, send: vi.fn() };
}

class FakeRTCPeerConnection {
  constructor(config) {
    FakeRTCPeerConnection.instances.push(this);
    this.config = config;
    this.localDescription = null;
    this.remoteDescription = null;
    this.onicecandidate = null;
    this.ondatachannel = null;
    this.createDataChannel = vi.fn(() => {
      this._createdChannel = makeFakeChannel();
      return this._createdChannel;
    });
    this.createOffer = vi.fn(async () => ({ type: "offer", sdp: "OFFER_SDP" }));
    this.createAnswer = vi.fn(async () => ({ type: "answer", sdp: "ANSWER_SDP" }));
    this.setLocalDescription = vi.fn(async (desc) => {
      this.localDescription = desc;
    });
    this.setRemoteDescription = vi.fn(async (desc) => {
      this.remoteDescription = desc;
    });
    this.addTrack = vi.fn();
    this.ontrack = null;
  }
}
FakeRTCPeerConnection.instances = [];

function makeFakeTrack(kind) {
  return { kind, enabled: true };
}

function makeFakeStream(tracks) {
  return { getTracks: () => tracks };
}

describe("startAsInitiator", () => {
  it("creates a peer connection, a data channel, and an offer, in order", async () => {
    FakeRTCPeerConnection.instances = [];
    const rtcConfig = { iceServers: [{ urls: "stun:example.org" }] };

    startAsInitiator({ rtcConfig, RTCPeerConnectionImpl: FakeRTCPeerConnection });
    await flushMicrotasks();

    const pc = FakeRTCPeerConnection.instances[0];
    expect(pc.config).toBe(rtcConfig);
    expect(pc.createDataChannel).toHaveBeenCalledWith("spirit-chat-stream");
    expect(pc.createOffer).toHaveBeenCalled();
    expect(pc.setLocalDescription).toHaveBeenCalledWith({ type: "offer", sdp: "OFFER_SDP" });
  });

  it("calls onLocalOfferReady only once ICE gathering completes (candidate === null)", async () => {
    FakeRTCPeerConnection.instances = [];
    const onLocalOfferReady = vi.fn();

    startAsInitiator({ RTCPeerConnectionImpl: FakeRTCPeerConnection, onLocalOfferReady });
    await flushMicrotasks();
    const pc = FakeRTCPeerConnection.instances[0];

    pc.onicecandidate({ candidate: { candidate: "some-candidate" } });
    expect(onLocalOfferReady).not.toHaveBeenCalled();

    pc.onicecandidate({ candidate: null });
    expect(onLocalOfferReady).toHaveBeenCalledWith(pc.localDescription);
  });

  it("wires the created data channel's open/message/close events to the given callbacks", async () => {
    FakeRTCPeerConnection.instances = [];
    const onChannelOpen = vi.fn();
    const onMessage = vi.fn();
    const onChannelClose = vi.fn();

    startAsInitiator({ RTCPeerConnectionImpl: FakeRTCPeerConnection, onChannelOpen, onMessage, onChannelClose });
    await flushMicrotasks();
    const pc = FakeRTCPeerConnection.instances[0];
    const channel = pc._createdChannel;

    channel.onopen();
    expect(onChannelOpen).toHaveBeenCalledWith(channel);

    channel.onmessage({ data: "encrypted-payload" });
    expect(onMessage).toHaveBeenCalledWith("encrypted-payload");

    channel.onclose();
    expect(onChannelClose).toHaveBeenCalled();
  });

  it("reports failures instead of leaving a silent unhandled rejection", async () => {
    FakeRTCPeerConnection.instances = [];
    const onError = vi.fn();
    const boom = new Error("createOffer failed");

    class FailingPC extends FakeRTCPeerConnection {
      constructor(config) {
        super(config);
        this.createOffer = vi.fn(async () => {
          throw boom;
        });
      }
    }

    startAsInitiator({ RTCPeerConnectionImpl: FailingPC, onError });
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith(boom);
  });
});

describe("onRemoteTrack (registered at pc creation, both initiator and joiner)", () => {
  it("startAsInitiator wires pc.ontrack to the given callback", async () => {
    FakeRTCPeerConnection.instances = [];
    const onRemoteTrack = vi.fn();

    startAsInitiator({ RTCPeerConnectionImpl: FakeRTCPeerConnection, onRemoteTrack });
    await flushMicrotasks();
    const pc = FakeRTCPeerConnection.instances[0];

    const remoteStream = makeFakeStream([makeFakeTrack("video")]);
    pc.ontrack({ streams: [remoteStream] });

    expect(onRemoteTrack).toHaveBeenCalledWith(remoteStream);
  });

  it("startAsJoiner wires pc.ontrack to the given callback", async () => {
    FakeRTCPeerConnection.instances = [];
    const onRemoteTrack = vi.fn();

    startAsJoiner({
      offerSdp: { type: "offer", sdp: "OFFER_SDP" },
      RTCPeerConnectionImpl: FakeRTCPeerConnection,
      onRemoteTrack
    });
    await flushMicrotasks();
    const pc = FakeRTCPeerConnection.instances[0];

    const remoteStream = makeFakeStream([makeFakeTrack("audio")]);
    pc.ontrack({ streams: [remoteStream] });

    expect(onRemoteTrack).toHaveBeenCalledWith(remoteStream);
  });

  it("a track arriving before any call-related action is still delivered (receiver never clicked anything)", async () => {
    // Regression guard: ontrack must be wired at pc-creation time, not
    // lazily when the local user starts a call -- the OTHER side can
    // initiate media first.
    FakeRTCPeerConnection.instances = [];
    const onRemoteTrack = vi.fn();
    startAsInitiator({ RTCPeerConnectionImpl: FakeRTCPeerConnection, onRemoteTrack });
    await flushMicrotasks();
    const pc = FakeRTCPeerConnection.instances[0];

    // No addLocalMediaTracks/createRenegotiationOffer call happened on this
    // side at all -- yet an incoming track must still reach the callback.
    const remoteStream = makeFakeStream([makeFakeTrack("video")]);
    pc.ontrack({ streams: [remoteStream] });

    expect(onRemoteTrack).toHaveBeenCalledWith(remoteStream);
  });
});

describe("addLocalMediaTracks", () => {
  it("adds every track of the stream to the peer connection", () => {
    const pc = new FakeRTCPeerConnection({});
    const videoTrack = makeFakeTrack("video");
    const audioTrack = makeFakeTrack("audio");
    const stream = makeFakeStream([videoTrack, audioTrack]);

    addLocalMediaTracks(pc, stream);

    expect(pc.addTrack).toHaveBeenCalledWith(videoTrack, stream);
    expect(pc.addTrack).toHaveBeenCalledWith(audioTrack, stream);
    expect(pc.addTrack).toHaveBeenCalledTimes(2);
  });
});

describe("createRenegotiationOffer", () => {
  it("creates and sets a local offer, and returns it WITHOUT waiting for ICE gathering", async () => {
    const pc = new FakeRTCPeerConnection({});
    // If this waited for ICE like the initial handshake, it would hang
    // forever here since nothing ever calls pc.onicecandidate.

    const offer = await createRenegotiationOffer(pc);

    expect(pc.createOffer).toHaveBeenCalled();
    expect(pc.setLocalDescription).toHaveBeenCalledWith({ type: "offer", sdp: "OFFER_SDP" });
    expect(offer).toEqual({ type: "offer", sdp: "OFFER_SDP" });
  });
});

describe("createRenegotiationAnswer", () => {
  it("applies the remote offer, creates and sets a local answer, and returns it", async () => {
    const pc = new FakeRTCPeerConnection({});
    const offerSdp = { type: "offer", sdp: "RENEGOTIATE_OFFER_SDP" };

    const answer = await createRenegotiationAnswer(pc, offerSdp);

    expect(pc.setRemoteDescription).toHaveBeenCalledWith(offerSdp);
    expect(pc.createAnswer).toHaveBeenCalled();
    expect(pc.setLocalDescription).toHaveBeenCalledWith({ type: "answer", sdp: "ANSWER_SDP" });
    expect(answer).toEqual({ type: "answer", sdp: "ANSWER_SDP" });
  });
});

describe("applyRenegotiationAnswer", () => {
  it("sets the remote description from the renegotiation answer", async () => {
    const pc = new FakeRTCPeerConnection({});
    const answerSdp = { type: "answer", sdp: "RENEGOTIATE_ANSWER_SDP" };

    await applyRenegotiationAnswer(pc, answerSdp);

    expect(pc.setRemoteDescription).toHaveBeenCalledWith(answerSdp);
  });
});

describe("applyRemoteAnswer", () => {
  it("completes the initiator's handshake by setting the remote answer", async () => {
    FakeRTCPeerConnection.instances = [];
    startAsInitiator({ RTCPeerConnectionImpl: FakeRTCPeerConnection });
    await flushMicrotasks();
    const pc = FakeRTCPeerConnection.instances[0];

    const answerSdp = { type: "answer", sdp: "ANSWER_SDP" };
    await applyRemoteAnswer(pc, answerSdp);

    expect(pc.setRemoteDescription).toHaveBeenCalledWith(answerSdp);
    expect(pc.remoteDescription).toBe(answerSdp);
  });
});

describe("startAsJoiner", () => {
  it("sets the remote offer, creates an answer, and sets it as local description, in order", async () => {
    FakeRTCPeerConnection.instances = [];
    const offerSdp = { type: "offer", sdp: "OFFER_SDP" };

    startAsJoiner({ offerSdp, RTCPeerConnectionImpl: FakeRTCPeerConnection });
    await flushMicrotasks();

    const pc = FakeRTCPeerConnection.instances[0];
    expect(pc.setRemoteDescription).toHaveBeenCalledWith(offerSdp);
    expect(pc.createAnswer).toHaveBeenCalled();
    expect(pc.setLocalDescription).toHaveBeenCalledWith({ type: "answer", sdp: "ANSWER_SDP" });
  });

  it("calls onLocalAnswerReady only once ICE gathering completes (candidate === null)", async () => {
    FakeRTCPeerConnection.instances = [];
    const onLocalAnswerReady = vi.fn();

    startAsJoiner({
      offerSdp: { type: "offer", sdp: "OFFER_SDP" },
      RTCPeerConnectionImpl: FakeRTCPeerConnection,
      onLocalAnswerReady
    });
    await flushMicrotasks();
    const pc = FakeRTCPeerConnection.instances[0];

    pc.onicecandidate({ candidate: { candidate: "some-candidate" } });
    expect(onLocalAnswerReady).not.toHaveBeenCalled();

    pc.onicecandidate({ candidate: null });
    expect(onLocalAnswerReady).toHaveBeenCalledWith(pc.localDescription);
  });

  it("wires an incoming data channel's open/message/close events to the given callbacks", async () => {
    FakeRTCPeerConnection.instances = [];
    const onChannelOpen = vi.fn();
    const onMessage = vi.fn();
    const onChannelClose = vi.fn();

    startAsJoiner({
      offerSdp: { type: "offer", sdp: "OFFER_SDP" },
      RTCPeerConnectionImpl: FakeRTCPeerConnection,
      onChannelOpen,
      onMessage,
      onChannelClose
    });
    await flushMicrotasks();
    const pc = FakeRTCPeerConnection.instances[0];

    const incomingChannel = makeFakeChannel();
    pc.ondatachannel({ channel: incomingChannel });

    incomingChannel.onopen();
    expect(onChannelOpen).toHaveBeenCalledWith(incomingChannel);

    incomingChannel.onmessage({ data: "encrypted-payload" });
    expect(onMessage).toHaveBeenCalledWith("encrypted-payload");

    incomingChannel.onclose();
    expect(onChannelClose).toHaveBeenCalled();
  });

  it("reports failures instead of leaving a silent unhandled rejection (e.g. malformed remote SDP)", async () => {
    FakeRTCPeerConnection.instances = [];
    const onError = vi.fn();
    const boom = new Error("setRemoteDescription failed: malformed SDP");

    class FailingPC extends FakeRTCPeerConnection {
      constructor(config) {
        super(config);
        this.setRemoteDescription = vi.fn(async () => {
          throw boom;
        });
      }
    }

    startAsJoiner({
      offerSdp: { type: "offer", sdp: "not-really-sdp" },
      RTCPeerConnectionImpl: FailingPC,
      onError
    });
    await flushMicrotasks();

    expect(onError).toHaveBeenCalledWith(boom);
  });
});
