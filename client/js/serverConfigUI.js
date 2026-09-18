// Section R3 (specs/phase5/app-decomposition.md, backlog A4): the Server
// screen's config domain extracted verbatim out of app.js's initApp()
// closure, continuing the G1/R1/R2 dependency-injection pattern: the
// read-only admin panel, the STUN/TURN preset fill-ins, and the
// device-local signaling-node registry (localStorage). Fully
// self-contained: nothing is returned, `state` is not needed, and the
// initial renderSignalingNodesList() call runs inside init at the same
// point in initApp's sequence as before the extraction.
import { adminLogin, getAdminConfig } from "./adminAuth.js";
import { computeTurnRestCredential } from "./turnCredentials.js";

// Order controls display order in the read-only admin panel.
const ADMIN_CONFIG_FIELDS = [
  "session_ttl_seconds",
  "max_sessions",
  "global_access",
  "allowed_origins",
  "request_window_seconds",
  "max_requests_per_window",
  "room_creation_window_seconds",
  "max_room_creations_per_window",
  "enable_proof_proxy",
  "fetch_proof_timeout_seconds",
  "fetch_proof_max_bytes"
];

export function initServerConfigUI({ doc, el, t, withBusyButton }) {
  const setAdminStatus = (text) => {
    el("admin-status").textContent = text;
  };

  function renderAdminConfig(config) {
    const list = el("admin-config-list");
    list.innerHTML = "";
    for (const field of ADMIN_CONFIG_FIELDS) {
      if (!(field in config)) continue;
      const row = doc.createElement("div");
      row.className = "list-row";
      const value = Array.isArray(config[field]) ? config[field].join(", ") : String(config[field]);
      row.textContent = `${t(`admin.field.${field}`)}: ${value}`;
      list.appendChild(row);
    }
    list.hidden = false;
  }

  // Section C8 (specs/reviews/spirit-evaluation-triage.md): STUN preset
  // dropdown -- #stun-url stays the single value currentRtcConfig() reads,
  // this is purely a fill-in convenience. Selecting a known preset fills
  // stun-url; selecting "custom" leaves it untouched. Typing directly into
  // stun-url flips the dropdown to whichever preset matches (or "custom"
  // if none does), so the two controls never visibly disagree.
  const STUN_PRESETS = {
    google: "stun:stun.l.google.com:19302",
    cloudflare: "stun:stun.cloudflare.com:3478",
    mozilla: "stun:stun.services.mozilla.com:3478"
  };
  el("stun-preset")?.addEventListener("change", () => {
    const preset = el("stun-preset").value;
    if (preset !== "custom" && STUN_PRESETS[preset]) {
      el("stun-url").value = STUN_PRESETS[preset];
    }
  });
  el("stun-url")?.addEventListener("input", () => {
    const stunPresetEl = el("stun-preset");
    if (!stunPresetEl) return;
    const match = Object.entries(STUN_PRESETS).find(([, url]) => url === el("stun-url").value);
    stunPresetEl.value = match ? match[0] : "custom";
  });

  // User request (2026-08-08): a free, no-signup TURN preset -- same
  // fill-in-convenience spirit as STUN_PRESETS above, but with one real
  // difference: forceTurnRelay's own hint already says a real TURN server
  // (login+password) is required for it to do anything at all, and most
  // users have neither, so this closes that gap with one click.
  //
  // UNLIKE a STUN preset, the credential is TIME-LIMITED (Metered's
  // shared-secret "TURN REST API" scheme, client/js/turnCredentials.js) --
  // there is no fixed string to fill in once, it must be computed fresh on
  // selection. Consequently there is no reverse "does turn-url happen to
  // match a known preset" sync on manual edits (unlike stun-url above) --
  // any manual edit to any of the three TURN fields just flips to "custom",
  // since a freshly-typed value can never coincidentally equal a live HMAC.
  const TURN_PRESETS = {
    "metered-openrelay": {
      // Port 443 (not 80): the vendor's own docs highlight 443 specifically
      // for bypassing restrictive/corporate firewalls that only allow
      // HTTPS-shaped traffic; ?transport=tcp on top of that covers networks
      // that additionally block UDP outright. buildRtcConfig's turn-url
      // field only holds one URI, so this is the single most broadly-
      // compatible choice rather than the bare default.
      url: "turn:staticauth.openrelay.metered.ca:443?transport=tcp",
      // Published by Metered specifically for this no-signup use (their own
      // documented example use case: embedding directly in an app like
      // Nextcloud Talk, as opposed to their per-account API-key endpoint,
      // which requires signup and is NOT reproduced here). Not a secret
      // Spirit is leaking -- it's the vendor's own public, shared value.
      sharedSecret: "openrelayprojectsecret"
    }
  };
  el("turn-preset")?.addEventListener("change", async () => {
    const preset = el("turn-preset").value;
    const def = TURN_PRESETS[preset];
    if (!def) return; // "custom" (or any future unrecognized value): leave the three fields untouched
    el("turn-url").value = def.url;
    const { username, credential } = await computeTurnRestCredential(def.sharedSecret);
    el("turn-username").value = username;
    el("turn-credential").value = credential;
  });
  for (const turnFieldId of ["turn-url", "turn-username", "turn-credential"]) {
    el(turnFieldId)?.addEventListener("input", () => {
      const turnPresetEl = el("turn-preset");
      if (turnPresetEl) turnPresetEl.value = "custom";
    });
  }

  // Section: multi-node signaling/TURN UI (specs/phase4/multi-node-ui.md).
  // localStorage, not the "profile" IndexedDB store -- this is a
  // browser/device-level setting (which signaling node this machine talks
  // to), independent of which Spirit account is currently active, same
  // storage tier as spirit.theme/spirit.locale. Guarded try/catch on every
  // access matches the pattern already used for spirit.welcomeSeen above:
  // storage can throw (private-mode/blocked site data) or hold malformed
  // JSON (e.g. hand-edited or corrupted by another script) -- either case
  // must fail open to an empty list, never take down the whole Server
  // screen's init.
  const SIGNALING_NODES_KEY = "spirit.signalingNodes";

  function loadSignalingNodes() {
    try {
      const raw = doc.defaultView.localStorage.getItem(SIGNALING_NODES_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveSignalingNodes(nodes) {
    try {
      doc.defaultView.localStorage.setItem(SIGNALING_NODES_KEY, JSON.stringify(nodes));
    } catch {
      // Storage unavailable -- the in-memory list still rendered for this
      // page view, but it won't persist across reloads. Acceptable
      // degraded UX, matches spirit.welcomeSeen's fail-open policy.
    }
  }

  function randomSignalingNodeId() {
    return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function renderSignalingNodesList() {
    const list = el("signaling-nodes-list");
    const empty = el("signaling-nodes-empty");
    if (!list) return;
    const nodes = loadSignalingNodes();
    list.innerHTML = "";
    if (empty) empty.hidden = nodes.length > 0;
    for (const node of nodes) {
      const row = doc.createElement("div");
      row.className = "list-row";

      const selectButton = doc.createElement("button");
      selectButton.type = "button";
      selectButton.dataset.signalingNodeSelect = node.id;
      // Defensive against a hand-edited/foreign localStorage array element
      // missing expected string fields (loadSignalingNodes only validates
      // that the top level is an array, not each element's shape) -- falls
      // back to "" rather than throwing and breaking the whole Server
      // screen, matching the fail-open intent of the storage guards above.
      const url = typeof node.serverUrl === "string" ? node.serverUrl : "";
      const shortUrl = url.length > 40 ? `${url.slice(0, 37)}...` : url;
      selectButton.textContent = `${node.name ?? ""} (${shortUrl})`;
      row.appendChild(selectButton);

      const deleteButton = doc.createElement("button");
      deleteButton.type = "button";
      deleteButton.dataset.signalingNodeDelete = node.id;
      deleteButton.textContent = t("btn.deleteSignalingNode");
      row.appendChild(deleteButton);

      list.appendChild(row);
    }
  }
  renderSignalingNodesList();

  if (el("btn-save-signaling-node")) el("btn-save-signaling-node").addEventListener("click", () => {
    const name = el("signaling-node-name").value.trim();
    if (!name) return;
    const nodes = loadSignalingNodes();
    nodes.push({
      id: randomSignalingNodeId(),
      name,
      serverUrl: el("server-url").value,
      stunUrl: el("stun-url").value,
      // Section B3: saved alongside the rest of this preset for convenience
      // (same "manual apply, no auto-reconnect" philosophy as the other
      // fields) -- note this means a TURN password ends up in plaintext
      // localStorage, same trust tier as everything else this feature
      // already persists there (device-local convenience, not a vault).
      turnUrl: el("turn-url").value,
      turnUsername: el("turn-username").value,
      turnCredential: el("turn-credential").value,
      // Exec review finding 2 (specs/reviews/turn-preset-iter1.md): a preset
      // like "metered-openrelay" produces a credential that EXPIRES
      // (turnCredentials.js's HMAC embeds a TTL) -- recording WHICH preset
      // was active lets the select-node handler below regenerate a fresh
      // one instead of silently restoring a possibly-stale value. "custom"
      // (or an older saved node with no turnPreset field at all, from
      // before this existed) means "just restore the raw fields verbatim",
      // unchanged from the original behavior.
      turnPreset: el("turn-preset")?.value ?? "custom",
      forceTurnRelay: el("force-turn-relay").checked
    });
    saveSignalingNodes(nodes);
    el("signaling-node-name").value = "";
    renderSignalingNodesList();
  });

  el("signaling-nodes-list")?.addEventListener("click", async (event) => {
    const selectButton = event.target.closest("[data-signaling-node-select]");
    if (selectButton) {
      const node = loadSignalingNodes().find((n) => n.id === selectButton.dataset.signalingNodeSelect);
      if (node) {
        // Purely fills the fields -- matches the existing manual-apply
        // philosophy of server-url/stun-url/force-turn-relay (spec design
        // note): no auto-reconnect of any in-progress session.
        el("server-url").value = node.serverUrl;
        el("stun-url").value = node.stunUrl;
        el("force-turn-relay").checked = !!node.forceTurnRelay;
        // Exec review finding 2: a preset-backed node's saved credential
        // may have expired since it was saved -- regenerate a fresh one
        // rather than restoring the stale value (a TURN server rejecting
        // an expired HMAC surfaces only as a generic ICE-gathering
        // timeout, indistinguishable from "the relay is just down").
        // "custom", or any older saved node with no turnPreset field at
        // all (from before this existed), falls through to the original
        // verbatim-restore behavior.
        const def = TURN_PRESETS[node.turnPreset];
        if (el("turn-preset")) el("turn-preset").value = def ? node.turnPreset : "custom";
        if (def) {
          el("turn-url").value = def.url;
          const { username, credential } = await computeTurnRestCredential(def.sharedSecret);
          el("turn-username").value = username;
          el("turn-credential").value = credential;
        } else {
          el("turn-url").value = node.turnUrl ?? "";
          el("turn-username").value = node.turnUsername ?? "";
          el("turn-credential").value = node.turnCredential ?? "";
        }
      }
      return;
    }
    const deleteButton = event.target.closest("[data-signaling-node-delete]");
    if (deleteButton) {
      const nodes = loadSignalingNodes().filter((n) => n.id !== deleteButton.dataset.signalingNodeDelete);
      saveSignalingNodes(nodes);
      renderSignalingNodesList();
    }
  });

  withBusyButton(el("btn-admin-login"), async () => {
    const password = el("admin-password").value;
    if (!password) {
      setAdminStatus(t("admin.needPassword"));
      return;
    }
    try {
      const { token } = await adminLogin(el("server-url").value, password);
      el("admin-password").value = "";
      const config = await getAdminConfig(el("server-url").value, token);
      el("admin-login-form").hidden = true;
      setAdminStatus("");
      renderAdminConfig(config);
    } catch (err) {
      setAdminStatus(err.message);
    }
  });
}
