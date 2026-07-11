import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../js/signalingClient.js", () => ({
  fetchProof: vi.fn()
}));

import { fetchProof as fetchProofViaNode } from "../js/signalingClient.js";
import { fetchProofPageText } from "../js/fetchProof.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchProofPageText", () => {
  it("returns the page text from a direct fetch when it succeeds (CORS-open target)", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "direct page text" });

    const text = await fetchProofPageText("https://node.example/index.php", "sk", "https://example.com/me");

    expect(global.fetch).toHaveBeenCalledWith("https://example.com/me");
    expect(fetchProofViaNode).not.toHaveBeenCalled();
    expect(text).toBe("direct page text");
  });

  it("falls back to the fetch_proof node proxy when the direct fetch throws (CORS/network error)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    fetchProofViaNode.mockResolvedValue({ body: "proxied page text", contentType: "text/html" });

    const text = await fetchProofPageText("https://node.example/index.php", "sk", "https://t.me/x/1?embed=1");

    expect(fetchProofViaNode).toHaveBeenCalledWith("https://node.example/index.php", {
      senderKey: "sk",
      targetUrl: "https://t.me/x/1?embed=1"
    });
    expect(text).toBe("proxied page text");
  });

  it("falls back to the proxy when the direct fetch resolves but is not ok", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "" });
    fetchProofViaNode.mockResolvedValue({ body: "proxied page text", contentType: "text/html" });

    const text = await fetchProofPageText("https://node.example/index.php", "sk", "https://example.com/me");

    expect(fetchProofViaNode).toHaveBeenCalled();
    expect(text).toBe("proxied page text");
  });

  it("skips the direct fetch entirely for a non-http(s) URL, going straight to the (server-validated) proxy", async () => {
    // Exec review: contact-controlled proof URLs are untrusted input --
    // don't let the client emit a request for file:/javascript:/etc.
    // schemes at all; let the node's own scheme allowlist be the single
    // source of truth instead of duplicating it here loosely.
    global.fetch = vi.fn();
    fetchProofViaNode.mockResolvedValue({ body: "proxied page text", contentType: "text/html" });

    const text = await fetchProofPageText("https://node.example/index.php", "sk", "file:///etc/passwd");

    expect(global.fetch).not.toHaveBeenCalled();
    expect(fetchProofViaNode).toHaveBeenCalledWith("https://node.example/index.php", {
      senderKey: "sk",
      targetUrl: "file:///etc/passwd"
    });
    expect(text).toBe("proxied page text");
  });

  it("throws a clear error when BOTH the direct fetch and the proxy fail", async () => {
    global.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    fetchProofViaNode.mockRejectedValue(new Error("fetch_proof is disabled on this node"));

    await expect(fetchProofPageText("https://node.example/index.php", "sk", "https://example.com/me")).rejects.toThrow(
      /fetch_proof is disabled on this node/
    );
  });
});
