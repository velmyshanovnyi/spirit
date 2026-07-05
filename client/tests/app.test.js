// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../js/identity.js", () => ({
  generateIdentityKeyPair: vi.fn(),
  generateEcdhKeyPair: vi.fn(),
  fingerprint: vi.fn(),
  exportEcdhPublicKeyForWire: vi.fn().mockResolvedValue("ECDH_PUB_WIRE"),
  importEcdhPublicKeyFromWire: vi.fn().mockResolvedValue({ __tag: "restored-peer-ecdh-pub" })
}));
vi.mock("../js/webrtc.js", () => ({
  startAsInitiator: vi.fn(),
  startAsJoiner: vi.fn(),
  applyRemoteAnswer: vi.fn()
}));
vi.mock("../js/signalingClient.js", () => ({
  createInvite: vi.fn(),
  createOffer: vi.fn(),
  getOffer: vi.fn(),
  submitAnswer: vi.fn(),
  pollForAnswer: vi.fn()
}));
vi.mock("../js/e2ee.js", () => ({
  deriveSessionKey: vi.fn(),
  encryptMessage: vi.fn(),
  decryptMessage: vi.fn()
}));
vi.mock("../js/googleOAuth.js", () => ({
  promptGoogleSignIn: vi.fn(),
  verifyGoogleIdToken: vi.fn()
}));

import { generateIdentityKeyPair, generateEcdhKeyPair, fingerprint } from "../js/identity.js";
import { startAsInitiator, startAsJoiner, applyRemoteAnswer } from "../js/webrtc.js";
import { createInvite, createOffer, getOffer, submitAnswer, pollForAnswer } from "../js/signalingClient.js";
import { encryptMessage, deriveSessionKey } from "../js/e2ee.js";
import { promptGoogleSignIn, verifyGoogleIdToken } from "../js/googleOAuth.js";
import { initApp } from "../js/app.js";

const HTML = `
  <button id="btn-generate" type="button">Створити акаунт</button>
  <div>Ваш ID: <span id="pub-key-display">не згенеровано</span></div>
  <input id="google-client-id" type="text" value="test-client-id">
  <button id="btn-google-verify" type="button">Підтвердити через Google</button>
  <div id="google-verify-status"></div>
  <input id="server-url" type="text" value="http://node.example/index.php">
  <input id="stun-url" type="text" value="stun:stun.example:19302">
  <input id="room-id" type="text">
  <input id="invite-token" type="text">
  <button id="btn-initiate" type="button">Ініціювати чат</button>
  <button id="btn-join" type="button">Приєднатися до чату</button>
  <div id="connection-status">не з'єднано</div>
  <div id="chat-log"></div>
  <input id="message-input" type="text">
  <button id="btn-send" type="button">Надіслати</button>
`;

function fakePublicKey(tag) {
  return { __tag: tag };
}

function fakeChannel() {
  return { onopen: null, onmessage: null, onclose: null, send: vi.fn() };
}

beforeEach(() => {
  document.body.innerHTML = HTML;
  vi.clearAllMocks();
});

describe("btn-generate", () => {
  it("generates an identity key pair and displays its fingerprint", async () => {
    const keyPair = { privateKey: {}, publicKey: fakePublicKey("identity-pub") };
    generateIdentityKeyPair.mockResolvedValue(keyPair);
    fingerprint.mockResolvedValue("deadbeef");

    initApp(document);
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => {
      expect(document.getElementById("pub-key-display").textContent).toBe("deadbeef");
    });

    expect(generateIdentityKeyPair).toHaveBeenCalled();
    expect(fingerprint).toHaveBeenCalledWith(keyPair.publicKey);
  });
});

describe("btn-google-verify", () => {
  it("refuses to start Google verification before an account exists", async () => {
    initApp(document);
    document.getElementById("btn-google-verify").click();
    await vi.waitFor(() =>
      expect(document.getElementById("google-verify-status").textContent).toMatch(/спочатку створіть акаунт/)
    );
    expect(promptGoogleSignIn).not.toHaveBeenCalled();
  });

  it("uses the identity fingerprint as the nonce and shows the verified email on success", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    promptGoogleSignIn.mockResolvedValue("FAKE_ID_TOKEN");
    verifyGoogleIdToken.mockResolvedValue({ sub: "123", email: "user@gmail.com", emailVerified: true });

    initApp(document);
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("sender-fp"));

    document.getElementById("btn-google-verify").click();
    await vi.waitFor(() =>
      expect(document.getElementById("google-verify-status").textContent).toMatch(/user@gmail\.com/)
    );

    expect(promptGoogleSignIn).toHaveBeenCalledWith({ clientId: "test-client-id", nonce: "sender-fp" });
    expect(verifyGoogleIdToken).toHaveBeenCalledWith("FAKE_ID_TOKEN", {
      expectedNonce: "sender-fp",
      expectedAudience: "test-client-id"
    });
  });

  it("surfaces a verification failure as a status message instead of an unhandled rejection", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    promptGoogleSignIn.mockResolvedValue("FAKE_ID_TOKEN");
    verifyGoogleIdToken.mockRejectedValue(new Error("Nonce mismatch: token was not issued for this identity key"));

    initApp(document);
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("sender-fp"));

    document.getElementById("btn-google-verify").click();
    await vi.waitFor(() =>
      expect(document.getElementById("google-verify-status").textContent).toMatch(/Nonce mismatch/)
    );
  });

  it("requires a Google Client ID to be filled in", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");

    initApp(document);
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("sender-fp"));
    document.getElementById("google-client-id").value = "";

    document.getElementById("btn-google-verify").click();
    await vi.waitFor(() =>
      expect(document.getElementById("google-verify-status").textContent).toMatch(/Client ID/)
    );
    expect(promptGoogleSignIn).not.toHaveBeenCalled();
  });
});

describe("btn-initiate", () => {
  it("refuses to start a handshake before an account exists, instead of sending sender_key=null", async () => {
    initApp(document);
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/спочатку створіть акаунт/)
    );
    expect(createInvite).not.toHaveBeenCalled();
  });

  it("surfaces a signaling failure as a status message instead of an unhandled rejection", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockRejectedValue(new Error("Access Denied: Public key not in white-list"));

    initApp(document);
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("sender-fp"));

    document.getElementById("btn-initiate").click();
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/Access Denied/)
    );
  });

  it("ignores a second click while a handshake is already in flight (re-entrancy guard)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });

    let resolveCreateInvite;
    createInvite.mockReturnValue(
      new Promise((resolve) => {
        resolveCreateInvite = resolve;
      })
    );

    initApp(document);
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("sender-fp"));

    const initiateButton = document.getElementById("btn-initiate");
    initiateButton.click(); // first click: createInvite is now pending
    await vi.waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));
    expect(initiateButton.disabled).toBe(true);

    initiateButton.click(); // second click while still in flight must be ignored
    expect(createInvite).toHaveBeenCalledTimes(1);

    resolveCreateInvite({ roomId: "room1", inviteToken: "tok1" });
    await vi.waitFor(() => expect(initiateButton.disabled).toBe(false));
  });

  it("creates an invite, starts as initiator, and submits the offer once ICE gathering completes", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({ answer: null, ecdhPubkey: null }); // no joiner yet in this test

    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document);
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("sender-fp"));

    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(createInvite).toHaveBeenCalled());
    expect(createInvite).toHaveBeenCalledWith("http://node.example/index.php", "sender-fp");

    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());
    expect(document.getElementById("room-id").value).toBe("room1");

    const offerSdp = { type: "offer", sdp: "OFFER_SDP" };
    await capturedOnLocalOfferReady(offerSdp);

    expect(createOffer).toHaveBeenCalledWith("http://node.example/index.php", {
      senderKey: "sender-fp",
      roomId: "room1",
      inviteToken: "tok1",
      sdpData: JSON.stringify(offerSdp),
      ecdhPubkey: "ECDH_PUB_WIRE"
    });
  });

  it("applies the remote answer via webrtc.applyRemoteAnswer once pollForAnswer resolves", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({ answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });

    const fakePc = { __fakePc: true };
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return fakePc;
    });

    initApp(document);
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });
    await vi.waitFor(() => expect(applyRemoteAnswer).toHaveBeenCalled());

    expect(applyRemoteAnswer).toHaveBeenCalledWith(fakePc, { type: "answer", sdp: "ANSWER_SDP" });
  });

  it("surfaces a rejection from inside the detached onLocalOfferReady callback as a status (inner error boundary)", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockRejectedValue(new Error("room expired"));

    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document);
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    // This callback runs detached from btn-initiate's own click handler (fired later
    // by webrtc.js's internal ICE-gathering logic), so only the inner try/catch --
    // not withBusyButton's outer one -- can be the thing that catches this rejection.
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/room expired/)
    );
  });

  it("disarms the ICE timeout when onError fires, so a stale timeout can't overwrite the real error", async () => {
    vi.useFakeTimers();
    try {
      generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
      fingerprint.mockResolvedValue("sender-fp");
      generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
      createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });

      let capturedOnError;
      startAsInitiator.mockImplementation((opts) => {
        capturedOnError = opts.onError;
        return { __fakePc: true }; // onLocalOfferReady deliberately never invoked in this test
      });

      initApp(document, { iceTimeoutMs: 5000 });
      document.getElementById("btn-generate").click();
      await vi.advanceTimersByTimeAsync(0);
      document.getElementById("btn-initiate").click();
      await vi.advanceTimersByTimeAsync(0);

      capturedOnError(new Error("createOffer failed inside webrtc.js"));
      expect(document.getElementById("connection-status").textContent).toMatch(/createOffer failed inside webrtc.js/);

      // If the ICE timeout weren't disarmed by onError, this advance would overwrite
      // the real error above with the generic ICE-gathering timeout message.
      await vi.advanceTimersByTimeAsync(5000);
      expect(document.getElementById("connection-status").textContent).toMatch(/createOffer failed inside webrtc.js/);
      expect(document.getElementById("connection-status").textContent).not.toMatch(/тайм-аут/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("btn-join", () => {
  it("refuses to join before an account exists, instead of sending sender_key=null", async () => {
    initApp(document);
    document.getElementById("btn-join").click();
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/спочатку створіть акаунт/)
    );
    expect(getOffer).not.toHaveBeenCalled();
  });

  it("fetches the offer, starts as joiner, and submits the answer once ICE gathering completes", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    getOffer.mockResolvedValue({ offer: JSON.stringify({ type: "offer", sdp: "OFFER_SDP" }), ecdhPubkey: "peer-ecdh-b64" });
    submitAnswer.mockResolvedValue(undefined);

    let capturedOnLocalAnswerReady;
    startAsJoiner.mockImplementation((opts) => {
      capturedOnLocalAnswerReady = opts.onLocalAnswerReady;
      return { __fakePc: true };
    });

    initApp(document);
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("sender-fp"));
    document.getElementById("room-id").value = "room1";
    document.getElementById("invite-token").value = "tok1";

    document.getElementById("btn-join").click();
    await vi.waitFor(() => expect(getOffer).toHaveBeenCalled());
    expect(getOffer).toHaveBeenCalledWith("http://node.example/index.php", {
      senderKey: "sender-fp",
      roomId: "room1",
      inviteToken: "tok1"
    });

    await vi.waitFor(() => expect(startAsJoiner).toHaveBeenCalled());
    expect(startAsJoiner.mock.calls[0][0].offerSdp).toEqual({ type: "offer", sdp: "OFFER_SDP" });

    const answerSdp = { type: "answer", sdp: "ANSWER_SDP" };
    await capturedOnLocalAnswerReady(answerSdp);

    expect(submitAnswer).toHaveBeenCalledWith("http://node.example/index.php", {
      senderKey: "sender-fp",
      roomId: "room1",
      inviteToken: "tok1",
      sdpData: JSON.stringify(answerSdp),
      ecdhPubkey: "ECDH_PUB_WIRE"
    });
  });
});

describe("btn-send", () => {
  it("refuses to send before a session key exists, instead of throwing", async () => {
    initApp(document);
    document.getElementById("message-input").value = "привіт";
    document.getElementById("btn-send").click();
    await vi.waitFor(() =>
      expect(document.getElementById("connection-status").textContent).toMatch(/немає активного з'єднання/)
    );
    expect(encryptMessage).not.toHaveBeenCalled();
  });

  it("encrypts the message before sending it on the data channel; never sends raw plaintext", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({
      answer: JSON.stringify({ type: "answer", sdp: "ANSWER_SDP" }),
      ecdhPubkey: "peer-ecdh-b64"
    });
    encryptMessage.mockResolvedValue("ENCRYPTED_PAYLOAD");
    deriveSessionKey.mockResolvedValue({ __tag: "session-key" });

    const channel = fakeChannel();
    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document);
    document.getElementById("btn-generate").click();
    await vi.waitFor(() => expect(document.getElementById("pub-key-display").textContent).toBe("sender-fp"));
    document.getElementById("btn-initiate").click();
    await vi.waitFor(() => expect(startAsInitiator).toHaveBeenCalled());

    // Simulate the data channel opening, as webrtc.js would report via onChannelOpen.
    const { onChannelOpen } = startAsInitiator.mock.calls[0][0];
    onChannelOpen(channel);
    // Complete the handshake so a session key actually exists, matching real usage.
    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });

    document.getElementById("message-input").value = "привіт";
    document.getElementById("btn-send").click();
    await vi.waitFor(() => expect(channel.send).toHaveBeenCalled());

    expect(encryptMessage).toHaveBeenCalledWith({ __tag: "session-key" }, "привіт");
    expect(channel.send).toHaveBeenCalledWith("ENCRYPTED_PAYLOAD");
    expect(channel.send).not.toHaveBeenCalledWith("привіт");
  });
});

describe("ICE gathering timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a connection-failed status if ICE gathering never completes in time", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    startAsInitiator.mockImplementation(() => ({ __fakePc: true })); // onLocalOfferReady never called

    initApp(document, { iceTimeoutMs: 5000 });
    document.getElementById("btn-generate").click();
    await vi.advanceTimersByTimeAsync(0);
    document.getElementById("btn-initiate").click();
    await vi.advanceTimersByTimeAsync(0);

    expect(document.getElementById("connection-status").textContent).not.toMatch(/не вдалося/);

    await vi.advanceTimersByTimeAsync(5000);

    expect(document.getElementById("connection-status").textContent).toMatch(/не вдалося зібрати ICE-кандидати/);
  });

  it("does not show the failure status if ICE gathering completes before the timeout", async () => {
    generateIdentityKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("identity-pub") });
    fingerprint.mockResolvedValue("sender-fp");
    generateEcdhKeyPair.mockResolvedValue({ privateKey: {}, publicKey: fakePublicKey("ecdh-pub") });
    createInvite.mockResolvedValue({ roomId: "room1", inviteToken: "tok1" });
    createOffer.mockResolvedValue(undefined);
    pollForAnswer.mockResolvedValue({ answer: null, ecdhPubkey: null });

    let capturedOnLocalOfferReady;
    startAsInitiator.mockImplementation((opts) => {
      capturedOnLocalOfferReady = opts.onLocalOfferReady;
      return { __fakePc: true };
    });

    initApp(document, { iceTimeoutMs: 5000 });
    document.getElementById("btn-generate").click();
    await vi.advanceTimersByTimeAsync(0);
    document.getElementById("btn-initiate").click();
    await vi.advanceTimersByTimeAsync(0);

    await capturedOnLocalOfferReady({ type: "offer", sdp: "OFFER_SDP" });
    await vi.advanceTimersByTimeAsync(5000);

    expect(document.getElementById("connection-status").textContent).not.toMatch(/не вдалося/);
  });
});
