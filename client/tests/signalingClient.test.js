import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createInvite,
  createOffer,
  getOffer,
  submitAnswer,
  checkAnswer,
  pollForAnswer,
  fetchProof,
  SignalingError
} from "../js/signalingClient.js";

const BASE_URL = "https://node.example/index.php";

function mockFetchOnce(status, body) {
  global.fetch = vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  });
}

beforeEach(() => {
  global.fetch = vi.fn();
});

describe("createInvite", () => {
  it("posts action=create_invite and returns { roomId, inviteToken }", async () => {
    mockFetchOnce(200, { status: "success", room_id: "abc123", invite_token: "tok456" });

    const result = await createInvite(BASE_URL, "senderKey1");

    expect(global.fetch).toHaveBeenCalledWith(
      BASE_URL,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: JSON.stringify({ action: "create_invite", sender_key: "senderKey1" })
      })
    );
    expect(result).toEqual({ roomId: "abc123", inviteToken: "tok456" });
  });
});

describe("createOffer", () => {
  it("posts the full offer payload per the protocol", async () => {
    mockFetchOnce(200, { status: "success" });

    await createOffer(BASE_URL, {
      senderKey: "sk",
      roomId: "room1",
      inviteToken: "tok1",
      sdpData: "sdp-blob",
      ecdhPubkey: "ecdh-pub"
    });

    expect(global.fetch).toHaveBeenCalledWith(
      BASE_URL,
      expect.objectContaining({
        body: JSON.stringify({
          action: "create_offer",
          sender_key: "sk",
          room_id: "room1",
          invite_token: "tok1",
          sdp_data: "sdp-blob",
          ecdh_pubkey: "ecdh-pub"
        })
      })
    );
  });
});

describe("fetchProof", () => {
  it("posts action=fetch_proof and returns { body, contentType }", async () => {
    mockFetchOnce(200, { status: "success", body: "<html>proof page</html>", content_type: "text/html" });

    const result = await fetchProof(BASE_URL, { senderKey: "sk", targetUrl: "https://t.me/x/1?embed=1" });

    expect(global.fetch).toHaveBeenCalledWith(
      BASE_URL,
      expect.objectContaining({
        body: JSON.stringify({ action: "fetch_proof", sender_key: "sk", target_url: "https://t.me/x/1?embed=1" })
      })
    );
    expect(result).toEqual({ body: "<html>proof page</html>", contentType: "text/html" });
  });

  it("throws a SignalingError when the node has the proxy disabled", async () => {
    mockFetchOnce(403, { error: "fetch_proof is disabled on this node" });

    await expect(fetchProof(BASE_URL, { senderKey: "sk", targetUrl: "https://example.com/" })).rejects.toBeInstanceOf(
      SignalingError
    );
  });
});

describe("getOffer", () => {
  it("returns { offer, ecdhPubkey } from the response", async () => {
    mockFetchOnce(200, { status: "success", offer: "sdp-offer", ecdh_pubkey: "peer-pub" });

    const result = await getOffer(BASE_URL, { senderKey: "sk", roomId: "room1", inviteToken: "tok1" });

    expect(result).toEqual({ offer: "sdp-offer", ecdhPubkey: "peer-pub" });
  });
});

describe("submitAnswer", () => {
  it("posts the answer payload per the protocol", async () => {
    mockFetchOnce(200, { status: "success" });

    await submitAnswer(BASE_URL, {
      senderKey: "sk",
      roomId: "room1",
      inviteToken: "tok1",
      sdpData: "sdp-answer",
      ecdhPubkey: "my-pub"
    });

    expect(global.fetch).toHaveBeenCalledWith(
      BASE_URL,
      expect.objectContaining({
        body: JSON.stringify({
          action: "submit_answer",
          sender_key: "sk",
          room_id: "room1",
          invite_token: "tok1",
          sdp_data: "sdp-answer",
          ecdh_pubkey: "my-pub"
        })
      })
    );
  });
});

describe("checkAnswer", () => {
  it("returns { answer, ecdhPubkey } which may be null", async () => {
    mockFetchOnce(200, { status: "success", answer: null, ecdh_pubkey: null });

    const result = await checkAnswer(BASE_URL, { senderKey: "sk", roomId: "room1" });

    expect(result).toEqual({ answer: null, ecdhPubkey: null });
  });
});

describe("error handling", () => {
  it("throws a SignalingError (not a raw network exception) when fetch rejects", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new TypeError("network down"));

    await expect(createInvite(BASE_URL, "sk")).rejects.toBeInstanceOf(SignalingError);
  });

  it("throws a SignalingError carrying the HTTP status and server error message on non-2xx", async () => {
    mockFetchOnce(403, { error: "Access Denied: invite token invalid" });

    const err = await createOffer(BASE_URL, {
      senderKey: "sk",
      roomId: "room1",
      inviteToken: "bad",
      sdpData: "x",
      ecdhPubkey: "y"
    }).catch((e) => e);

    expect(err).toBeInstanceOf(SignalingError);
    expect(err.status).toBe(403);
    expect(err.message).toMatch(/invite token invalid/);
  });

  it("degrades gracefully when a non-2xx response body isn't valid JSON", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("Unexpected token in JSON");
      }
    });

    const err = await createInvite(BASE_URL, "sk").catch((e) => e);

    expect(err).toBeInstanceOf(SignalingError);
    expect(err.status).toBe(500);
    expect(err.message).toMatch(/500/);
  });
});

describe("pollForAnswer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops polling as soon as a non-null answer arrives", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "success", answer: null, ecdh_pubkey: null }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "success", answer: null, ecdh_pubkey: null }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "success", answer: "sdp-answer", ecdh_pubkey: "peer-pub" }) });

    const resultPromise = pollForAnswer(BASE_URL, { senderKey: "sk", roomId: "room1" }, { intervalMs: 1000 });

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const result = await resultPromise;
    expect(result).toEqual({ answer: "sdp-answer", ecdhPubkey: "peer-pub" });

    const callCountAtResolution = global.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch.mock.calls.length).toBe(callCountAtResolution);
  });

  it("rejects once and schedules no further timer when checkAnswer errors mid-poll", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "success", answer: null, ecdh_pubkey: null }) })
      .mockRejectedValueOnce(new TypeError("network dropped"));

    const resultPromise = pollForAnswer(BASE_URL, { senderKey: "sk", roomId: "room1" }, { intervalMs: 1000 });
    const outcome = resultPromise.then(
      () => ({ rejected: false }),
      (err) => ({ rejected: true, err })
    );

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);

    const { rejected, err } = await outcome;
    expect(rejected).toBe(true);
    expect(err).toBeInstanceOf(SignalingError);

    const callCountAtRejection = global.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch.mock.calls.length).toBe(callCountAtRejection);
  });

  it("does not double-settle when aborted while a checkAnswer request is still in flight", async () => {
    let resolveInFlightFetch;
    global.fetch = vi.fn().mockReturnValueOnce(
      new Promise((resolve) => {
        resolveInFlightFetch = resolve;
      })
    );

    const controller = new AbortController();
    const resultPromise = pollForAnswer(
      BASE_URL,
      { senderKey: "sk", roomId: "room1" },
      { intervalMs: 1000, signal: controller.signal }
    );
    const outcome = resultPromise.then(
      () => ({ rejected: false }),
      (err) => ({ rejected: true, err })
    );

    await vi.advanceTimersByTimeAsync(1000); // enters tick(), fetch() called and left pending
    controller.abort(); // aborts while checkAnswer's fetch is still unresolved
    resolveInFlightFetch({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", answer: "late-answer", ecdh_pubkey: "peer-pub" })
    });
    await vi.advanceTimersByTimeAsync(0);

    const { rejected } = await outcome;
    expect(rejected).toBe(true); // abort wins; the late in-flight answer must not resolve the promise

    const callCountAfterAbort = global.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch.mock.calls.length).toBe(callCountAfterAbort); // no further polling scheduled
  });

  it("stops polling and rejects when the given AbortSignal is aborted", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", answer: null, ecdh_pubkey: null })
    });

    const controller = new AbortController();
    const resultPromise = pollForAnswer(
      BASE_URL,
      { senderKey: "sk", roomId: "room1" },
      { intervalMs: 1000, signal: controller.signal }
    );
    // Attach a handler immediately (as any real caller should) so an abort's
    // synchronous rejection is never observed as transiently unhandled.
    const outcome = resultPromise.then(
      () => ({ rejected: false }),
      (err) => ({ rejected: true, err })
    );

    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);

    const { rejected, err } = await outcome;
    expect(rejected).toBe(true);
    expect(err).toBeInstanceOf(Error);

    const callCountAtAbort = global.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch.mock.calls.length).toBe(callCountAtAbort);
  });
});
