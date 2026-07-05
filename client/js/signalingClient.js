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

export async function createInvite(baseUrl, senderKey) {
  const data = await apiRequest(baseUrl, { action: "create_invite", sender_key: senderKey });
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
