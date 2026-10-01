// @vitest-environment jsdom
// Section R6 (specs/phase5/app-decomposition.md, backlog A4): own-proofs +
// Google verification extracted out of app.js. Behavioral coverage stays
// in app.test.js -- this pins the module boundary.
import { describe, it, expect, vi } from "vitest";
import { initIdentityVerificationUI, ownProofSetKey } from "../js/identityVerificationUI.js";

vi.mock("../js/db.js", () => ({
  get: vi.fn(async (_store, key) =>
    key === "proofSet:fp-1" ? { proofs: [{ url: "https://example.com/me", label: "example.com", added_at: 1 }] } : null
  ),
  put: vi.fn()
}));

function boot(state) {
  document.body.innerHTML = `
    <div id="proofs-status"></div>
    <pre id="proof-block-display"></pre>
    <div id="own-proofs-list"></div>
    <div id="google-verify-status"></div>`;
  return initIdentityVerificationUI({
    doc: document,
    el: (id) => document.getElementById(id),
    t: (key) => key,
    state,
    withBusyButton: () => {},
    checkContactProofs: async () => {}
  });
}

describe("identityVerificationUI module boundary (Section R6)", () => {
  it("exports ownProofSetKey and returns the two functions app.js consumes", () => {
    expect(ownProofSetKey("abc")).toBe("proofSet:abc");
    const api = boot({ senderKey: "fp-1" });
    expect(typeof api.resetOwnProofsState).toBe("function");
    expect(typeof api.renderOwnProofsList).toBe("function");
  });

  it("renderOwnProofsList renders the stored proof set with a revoke button per proof", async () => {
    const api = boot({ senderKey: "fp-1" });
    await api.renderOwnProofsList();
    const list = document.getElementById("own-proofs-list");
    expect(list.children.length).toBe(1);
    expect(list.textContent).toContain("https://example.com/me");
    expect(list.querySelector("button").textContent).toBe("btn.revokeProof");
    api.resetOwnProofsState();
    expect(list.innerHTML).toBe("");
  });
});
