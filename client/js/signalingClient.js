import { buildPowChallenge, solvePow } from "./pow.js";

// Section SR2 (specs/phase5/sybil-resistance.md): must exactly match
// server/config.php's POW_WINDOW_SECONDS / POW_DIFFICULTY_BITS constants --
// there's no shared-constants file across JS/PHP in this project, so these
// are hardcoded on both sides with a cross-referencing comment. A mismatch
// here would make every legitimate client's PoW fail server-side
// verification (wrong time-window bucketing) or solve at the wrong
// (too easy/too hard) difficulty.
export const POW_WINDOW_SECONDS = 30;
// Recalibrated from the spec's original recommendation of 20 (2026-07-18,
// live browser measurement): batched solvePow (client/js/pow.js) still
// took 30+ seconds at 20 bits in real live-verification testing --
// per-call crypto.subtle.digest dispatch overhead dominates far more than
// assumed, and batching only partially hides it. Measured live: 14 bits
// ~1.3s, 16 bits ~1.1s (high variance, both order-of-seconds not
// sub-second). 16 bits (~2^16 ~= 65K expected attempts) is the chosen
// trade-off -- 16x less attacker cost than 20 bits, but a real
// create_invite click actually completes reliably instead of hanging.
export const POW_DIFFICULTY_BITS = 16;

export class SignalingError extends Error {
  constructor(message, { status = null, cause } = {}) {
    super(message);
    this.name = "SignalingError";
    this.status = status;
    if (cause) this.cause = cause;
  }
}

async function apiRequest(baseUrl, body, { signal } = {}) {
  let response;
  try {
    response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
  } catch (networkError) {
    throw new SignalingError(`Signaling request failed: ${networkError.message}`, {
      cause: networkError
    });
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || (data.status && data.status !== "success")) {
    throw new SignalingError(data.error || `Signaling request failed with status ${response.status}`, {
      status: response.status
    });
  }

  return data;
}

/**
 * Section SR2: solves a PoW (specs/phase5/sybil-resistance.md's Sybil-
 * resistance design) BEFORE POSTing create_invite -- this is what makes
 * mass room creation from a botnet of fresh identity keys expensive per
 * key, on top of RateLimiter.php's per-IP throttle. onPowStart, if given, is
 * invoked synchronously right before the (potentially slow, up to ~1s or
 * more on weak devices) solving loop starts, so callers can show UI status.
 */
export async function createInvite(baseUrl, senderKey, { onPowStart } = {}) {
  const powTimestamp = Date.now() / 1000;
  const timeWindow = Math.floor(powTimestamp / POW_WINDOW_SECONDS);
  const challenge = buildPowChallenge(timeWindow, senderKey);

  onPowStart?.();
  const powNonce = await solvePow(challenge, POW_DIFFICULTY_BITS);

  const data = await apiRequest(baseUrl, {
    action: "create_invite",
    sender_key: senderKey,
    pow_timestamp: powTimestamp,
    pow_nonce: powNonce
  });
  return { roomId: data.room_id, inviteToken: data.invite_token };
}

export async function createOffer(baseUrl, { senderKey, roomId, inviteToken, sdpData, ecdhPubkey }) {
  await apiRequest(baseUrl, {
    action: "create_offer",
    sender_key: senderKey,
    room_id: roomId,
    invite_token: inviteToken,
    sdp_data: sdpData,
    ecdh_pubkey: ecdhPubkey
  });
}

export async function getOffer(baseUrl, { senderKey, roomId, inviteToken }) {
  const data = await apiRequest(baseUrl, {
    action: "get_offer",
    sender_key: senderKey,
    room_id: roomId,
    invite_token: inviteToken
  });
  return { offer: data.offer, ecdhPubkey: data.ecdh_pubkey };
}

export async function submitAnswer(baseUrl, { senderKey, roomId, inviteToken, sdpData, ecdhPubkey }) {
  await apiRequest(baseUrl, {
    action: "submit_answer",
    sender_key: senderKey,
    room_id: roomId,
    invite_token: inviteToken,
    sdp_data: sdpData,
    ecdh_pubkey: ecdhPubkey
  });
}

/**
 * Section D (specs/phase2c/identity-verification.md): fetches a proof
 * page's content through the signaling node's `fetch_proof` proxy -- the
 * fallback for CORS-closed targets (e.g. Telegram). The node itself is
 * SSRF-hardened (server/library/SignalingController.php); this client just
 * maps the wire shape.
 */
export async function fetchProof(baseUrl, { senderKey, targetUrl }) {
  const data = await apiRequest(baseUrl, { action: "fetch_proof", sender_key: senderKey, target_url: targetUrl });
  return { body: data.body, contentType: data.content_type };
}

export async function checkAnswer(baseUrl, { senderKey, roomId }, { signal } = {}) {
  const data = await apiRequest(
    baseUrl,
    { action: "check_answer", sender_key: senderKey, room_id: roomId },
    { signal }
  );
  return { answer: data.answer ?? null, ecdhPubkey: data.ecdh_pubkey ?? null };
}

export function pollForAnswer(baseUrl, { senderKey, roomId }, { intervalMs = 3000, signal } = {}) {
  return new Promise((resolve, reject) => {
    let timeoutId;

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(new SignalingError("Polling aborted"));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const tick = async () => {
      try {
        const result = await checkAnswer(baseUrl, { senderKey, roomId }, { signal });
        if (signal?.aborted) return; // already rejected via onAbort
        if (result.answer) {
          signal?.removeEventListener("abort", onAbort);
          resolve(result);
          return;
        }
      } catch (err) {
        if (signal?.aborted) return;
        signal?.removeEventListener("abort", onAbort);
        reject(err);
        return;
      }
      timeoutId = setTimeout(tick, intervalMs);
    };

    timeoutId = setTimeout(tick, intervalMs);
  });
}
