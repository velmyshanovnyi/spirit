---
spec: ui/chat-first-redesign
section: H5
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/app.js
  - client/js/session.js
  - client/tests/app.test.js
---

One finding, fix required before commit:

**CONFIRMED — unguarded `getRememberedProfileId()` in the new H5 auto-start branch.** `session.js`'s `getRememberedProfileId()` called `localStorage.getItem()` unguarded (only `JSON.parse` was wrapped in try/catch). This is called from a production-only code path (`initApp`'s zero-click auto-start, gated by `autoStartChat = options === undefined`, which is only true for the real `index.html` call site) -- a throwing `localStorage` (private-mode/blocked site data) would propagate out of `initApp` and crash the whole app's boot, the exact hazard already guarded against elsewhere in this codebase (theme.js, i18n.js, the H1 welcome-modal code). Never exercised by any existing test since every test passes an explicit options object. Fixed at the shared utility level in `session.js` (protects every caller, not just this one).

Non-defects confirmed during this pass:
- Blast-radius claim fully verified: `initApp` is referenced only in `index.html`, `app.js`, `app.test.js`; fresh grep confirmed 0 bare `initApp(document)` calls (no second argument) among 142 call sites in app.test.js, vs. exactly 1 bare call in `index.html` -- the signature change (`autoStartChat` defaulting true only when no options object is passed at all) is 100% backward-compatible.
- Stored-but-not-remembered profile scenario: genuinely just a UX inconvenience (extra step to log in via H3's "Увійти"), not a data-safety issue -- the H5 IIFE never touches IndexedDB.
- F4 (invite link) / H5 (fresh visit) mutual exclusion via if/else-if: `cameFromInviteLink` is a stable, synchronously-computed boolean, never re-evaluated -- no window for both IIFEs to run concurrently.
- Device-linking / portable-login flows unconditionally overwrite `state.identityKeyPair`/`senderKey`, so a pre-set ephemeral identity from H5 is simply discarded when the user actually logs in/links a device -- not hijacked.
- Re-entrancy: `quickChatButton.disabled = true` runs synchronously before any event-loop turn; `withBusyButton` guards with `if (button.disabled) return` -- no click can slip into the in-flight window.

Convergence: not reached, iteration 2 required after the fix.
