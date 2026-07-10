/**
 * Client for the read-only admin panel (specs/ui/server-admin-panel.md).
 * The server returns identical error text for a wrong password and for an
 * invalid/expired token by design -- this client doesn't try to distinguish
 * them either, just surfaces the message as-is.
 */
export class AdminAuthError extends Error {
  constructor(message, { status = null } = {}) {
    super(message);
    this.name = "AdminAuthError";
    this.status = status;
  }
}

async function post(baseUrl, body) {
  let response;
  try {
    response = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (networkError) {
    throw new AdminAuthError(`Admin request failed: ${networkError.message}`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data.status && data.status !== "success")) {
    throw new AdminAuthError(data.error || `Admin request failed with status ${response.status}`, {
      status: response.status
    });
  }
  return data;
}

export async function adminLogin(baseUrl, password) {
  const data = await post(baseUrl, { action: "admin_login", password });
  return { token: data.token, expiresAt: data.expires_at };
}

export async function getAdminConfig(baseUrl, token) {
  const data = await post(baseUrl, { action: "admin_get_config", token });
  return data.config;
}
