import { fetchProof as fetchProofViaNode } from "./signalingClient.js";

/**
 * Section D (specs/phase2c/identity-verification.md): direct fetch first
 * (works for CORS-open targets like a personal site or a raw GitHub gist),
 * falling back to the signaling node's fetch_proof proxy when the direct
 * attempt fails for ANY reason (network error, thrown CORS rejection, or a
 * non-ok HTTP response) -- Telegram embeds always need the proxy path
 * (docs/identity-verification.md: no Access-Control-Allow-Origin header).
 */
/**
 * A proof URL comes entirely from an untrusted contact's proof set --
 * never let the client itself emit a request for a scheme like
 * file:/javascript:. The node's own fetch_proof already enforces an
 * http(s)-only + private-IP-blocked allowlist server-side (SignalingController.php);
 * this is just refusing to try a strange scheme directly first (exec review finding).
 */
function isFetchableDirectly(url) {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export async function fetchProofPageText(baseUrl, senderKey, url) {
  if (isFetchableDirectly(url)) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.text();
      }
    } catch {
      // Direct fetch failed outright (network/CORS) -- fall through to proxy.
    }
  }

  const { body } = await fetchProofViaNode(baseUrl, { senderKey, targetUrl: url });
  return body;
}
