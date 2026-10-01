// Section R6 (specs/phase5/app-decomposition.md, backlog A4): identity
// verification -- the user's OWN proof set (generate a proof block, add a
// published proof after sanity-checking the live page, revoke, periodic
// re-check of contacts' proofs) and Google OIDC verification -- extracted
// verbatim out of app.js's initApp() closure, continuing the G1/R1-R5
// dependency-injection pattern. `state` is the same mutable object app.js
// holds. `checkContactProofs` arrives as a lazy thunk: it is a const created
// later in initApp than this module is initialized (contactsUI), and is
// only ever invoked from a click or the interval, after initApp completed.
// app.js consumes resetOwnProofsState and renderOwnProofsList.
import { get, put } from "./db.js";
import { addProofToSet, revokeProofFromSet } from "./proofSet.js";
import { createProofBlock, parseProofBlock, verifyProofBlock } from "./proofs.js";
import { fetchProofPageText } from "./fetchProof.js";
import { promptGoogleSignIn, verifyGoogleIdToken } from "./googleOAuth.js";
import { formatSpiritId } from "./spiritId.js";
import { getSetting } from "./settingsRegistry.js";

export const ownProofSetKey = (profileId) => `proofSet:${profileId}`;

export function initIdentityVerificationUI({ doc, el, t, state, withBusyButton, checkContactProofs }) {
  const setGoogleStatus = (text) => {
    el("google-verify-status").textContent = text;
  };

  const setProofsStatus = (text) => {
    el("proofs-status").textContent = text;
  };
  // Kept only for this session (not persisted): re-parsed to get the exact
  // identity wire this block was signed for, so "Додати" can sanity-check
  // the fetched publication against OUR OWN block without needing to
  // re-export the (possibly non-extractable) identity public key.
  let lastGeneratedProofBlockText = null;
  // Cached in memory rather than re-read from storage on every render --
  // both because it avoids a round-trip and because it's simply the
  // in-flight value this tab is editing (mirrors ownDeviceList's own
  // get()-on-demand pattern, but this one changes multiple times per
  // session via add/revoke, so a cache avoids a stale-read race between a
  // just-completed put() and an immediately following get()).
  let ownProofSetCache = undefined; // undefined = not loaded yet; null = loaded, empty

  /**
   * Called whenever a DIFFERENT identity becomes active in this tab
   * (quick-chat, unlock, create-profile, device-join) -- without this, an
   * earlier profile's cached proof set / just-generated block would leak
   * into the newly-active profile's UI and, worse, get persisted under the
   * new profile's storage key (exec review finding, Section E).
   */
  function resetOwnProofsState() {
    lastGeneratedProofBlockText = null;
    ownProofSetCache = undefined;
    if (el("proof-block-display")) el("proof-block-display").textContent = "";
    if (el("own-proofs-list")) el("own-proofs-list").innerHTML = "";
  }

  async function loadOwnProofSet() {
    if (ownProofSetCache === undefined) {
      ownProofSetCache = (await get("profile", ownProofSetKey(state.senderKey))) ?? null;
    }
    return ownProofSetCache;
  }

  async function renderOwnProofsList() {
    const list = el("own-proofs-list");
    if (!list) return;
    list.innerHTML = "";
    const ownSet = await loadOwnProofSet();
    for (const proof of ownSet?.proofs ?? []) {
      const row = doc.createElement("div");
      row.className = "list-row";
      row.textContent = `${proof.label}: ${proof.url} `;
      const revokeBtn = doc.createElement("button");
      revokeBtn.type = "button";
      revokeBtn.textContent = t("btn.revokeProof");
      revokeBtn.addEventListener("click", async () => {
        ownProofSetCache = await revokeProofFromSet(state.identityKeyPair.privateKey, ownProofSetCache, proof.url);
        await put("profile", ownProofSetKey(state.senderKey), ownProofSetCache);
        await renderOwnProofsList();
      });
      row.appendChild(revokeBtn);
      list.appendChild(row);
    }
  }

  withBusyButton(el("btn-generate-proof"), async () => {
    const block = await createProofBlock(
      state.identityKeyPair.privateKey,
      state.identityKeyPair.publicKey,
      formatSpiritId(state.senderKey)
    );
    lastGeneratedProofBlockText = block;
    el("proof-block-display").textContent = block;
  });

  withBusyButton(el("btn-add-proof"), async () => {
    const url = el("proof-url-input").value.trim();
    if (!url) {
      setProofsStatus(t("proofs.needUrl"));
      return;
    }
    if (!lastGeneratedProofBlockText) {
      setProofsStatus(t("proofs.needGenerateFirst"));
      return;
    }
    try {
      const ownWire = parseProofBlock(lastGeneratedProofBlockText)?.identity;
      const text = await fetchProofPageText(el("server-url").value, state.senderKey, url);
      const parsed = parseProofBlock(text);
      if (!(await verifyProofBlock(parsed, ownWire))) {
        setProofsStatus(t("proofs.sanityCheckFailed"));
        return;
      }
      const label = new URL(url).hostname;
      const current = await loadOwnProofSet();
      ownProofSetCache = await addProofToSet(state.identityKeyPair.privateKey, current, { url, label, added_at: Date.now() });
      await put("profile", ownProofSetKey(state.senderKey), ownProofSetCache);
      el("proof-url-input").value = "";
      setProofsStatus("");
      await renderOwnProofsList();
    } catch (err) {
      setProofsStatus(t("status.error", { msg: err.message }));
    }
  });

  withBusyButton(el("btn-check-proofs-now"), async () => {
    el("proofs-check-status").textContent = "";
    await checkContactProofs();
  });

  // Periodic re-check (Section 18 decision: a real setInterval while the
  // tab is open, not just on-screen-open) -- deduplicated the same way as
  // the router's/app's own hashchange listeners, so re-initializing (tests,
  // HMR) never stacks a second interval ticking in the background.
  if (doc.defaultView.__spiritProofRecheckInterval) {
    doc.defaultView.clearInterval(doc.defaultView.__spiritProofRecheckInterval);
  }
  doc.defaultView.__spiritProofRecheckInterval = doc.defaultView.setInterval(() => {
    checkContactProofs().catch(() => {});
  }, getSetting("proofRecheckIntervalMs"));

  // Section C1 (specs/reviews/spirit-evaluation-triage.md): the Google GSI
  // script used to load unconditionally on every page visit, regardless of
  // whether the user ever touches Google verification -- a third-party
  // request Google sees on every single load. Lazily injected here, on the
  // FIRST click of "Підтвердити через Google" only, and cached (module-scope
  // promise, not per-call) so a second click doesn't inject a second
  // <script> tag or re-fetch.
  let googleGsiLoadPromise = null;
  function ensureGoogleGsiLoaded() {
    if (doc.defaultView.google?.accounts?.id) return Promise.resolve();
    if (googleGsiLoadPromise) return googleGsiLoadPromise;
    googleGsiLoadPromise = new Promise((resolve, reject) => {
      const script = doc.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => {
        googleGsiLoadPromise = null; // allow retry on the next click
        reject(new Error("Failed to load the Google Sign-In script"));
      };
      doc.head.appendChild(script);
    });
    return googleGsiLoadPromise;
  }

  withBusyButton(el("btn-google-verify"), async () => {
    if (!state.senderKey) {
      setGoogleStatus(t("status.createAccountFirst"));
      return;
    }
    const clientId = el("google-client-id").value;
    if (!clientId) {
      setGoogleStatus(t("google.needClientId"));
      return;
    }
    // Snapshotted once so the nonce used to start the Google prompt and the
    // nonce checked at verification time are provably the same value, even
    // if the user re-generates an account (changing state.senderKey) while
    // the popup is open -- matches the pattern already used in btn-initiate.
    const senderKey = state.senderKey;
    try {
      await ensureGoogleGsiLoaded();
      // The identity fingerprint doubles as the OIDC nonce, cryptographically
      // binding the returned ID token to this specific identity key
      // (docs/oauth-verification.md).
      const idToken = await promptGoogleSignIn({ clientId, nonce: senderKey });
      const claims = await verifyGoogleIdToken(idToken, { expectedNonce: senderKey, expectedAudience: clientId });
      setGoogleStatus(t("google.verified", { email: claims.email }));
    } catch (err) {
      setGoogleStatus(t("status.error", { msg: err.message }));
    }
  });

  return { resetOwnProofsState, renderOwnProofsList };
}
