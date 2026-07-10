import { describe, it, expect, vi, beforeEach } from "vitest";
import { adminLogin, getAdminConfig, AdminAuthError } from "../js/adminAuth.js";

const BASE_URL = "http://node.example/index.php";

beforeEach(() => {
  global.fetch = vi.fn();
});

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("adminLogin", () => {
  it("posts the password and returns { token, expiresAt } on success", async () => {
    global.fetch.mockResolvedValue(jsonResponse(200, { status: "success", token: "abc.def", expires_at: 12345 }));

    const result = await adminLogin(BASE_URL, "correct horse");

    expect(global.fetch).toHaveBeenCalledWith(
      BASE_URL,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "admin_login", password: "correct horse" })
      })
    );
    expect(result).toEqual({ token: "abc.def", expiresAt: 12345 });
  });

  it("throws AdminAuthError on a wrong password (401), without leaking which check failed", async () => {
    global.fetch.mockResolvedValue(jsonResponse(401, { error: "Invalid or expired admin credentials" }));

    await expect(adminLogin(BASE_URL, "wrong")).rejects.toThrow(AdminAuthError);
    await expect(adminLogin(BASE_URL, "wrong")).rejects.toThrow(/invalid or expired/i);
  });

  it("throws AdminAuthError when the admin feature is disabled on the node (403)", async () => {
    global.fetch.mockResolvedValue(jsonResponse(403, { error: "Admin access is disabled on this node" }));

    await expect(adminLogin(BASE_URL, "anything")).rejects.toThrow(/disabled/i);
  });
});

describe("getAdminConfig", () => {
  it("posts the token and returns the config object on success", async () => {
    const config = { session_ttl_seconds: 300, max_sessions: 1000 };
    global.fetch.mockResolvedValue(jsonResponse(200, { status: "success", config }));

    const result = await getAdminConfig(BASE_URL, "abc.def");

    expect(global.fetch).toHaveBeenCalledWith(
      BASE_URL,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "admin_get_config", token: "abc.def" })
      })
    );
    expect(result).toEqual(config);
  });

  it("throws AdminAuthError on an invalid/expired token (401)", async () => {
    global.fetch.mockResolvedValue(jsonResponse(401, { error: "Invalid or expired admin credentials" }));

    await expect(getAdminConfig(BASE_URL, "stale-token")).rejects.toThrow(AdminAuthError);
  });
});
