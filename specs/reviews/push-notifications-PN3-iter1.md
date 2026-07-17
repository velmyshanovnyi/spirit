---
spec: phase5/push-notifications
section: PN3
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/sw.js
  - client/tests/sw.test.js
  - client/index.html
---

Two findings, both required fixes before commit:

**1. PLAUSIBLE (highest severity) — Service Worker scope mismatch.** `navigator.serviceWorker.register("./js/sw.js")` gave the registration a default scope of `/js/`, but the app runs at origin root `/`. The SW would therefore never *control* the main tab. Per the Clients API spec, `WindowClient.navigate()` rejects on any client the SW doesn't control -- so the "focus the existing tab" path would reject in a real browser, breaking the notification-click flow. Fixed by moving the SW file to `client/sw.js` (site root) and registering it as `./sw.js`, giving it the default root scope.

**2. CONFIRMED -- unguarded `await client.navigate()`.** No try/catch around the await, so a rejected `navigate()` (from the scope issue above, or a cross-origin/destroyed client) threw before `client.focus()` and before the `openWindow` fallback -- the notification click would silently do nothing. Fixed by wrapping `navigate()` in try/catch, falling through to `focus()` regardless of whether navigation succeeded.

Non-defects confirmed during this pass:
- `buildJoinUrl`'s `/?room=X&token=Y#/room` output is byte-for-byte what Section F4's existing `URLSearchParams` parser in app.js expects -- same param names, both sides use `encodeURIComponent`, hash ignored.
- No injection risk from attacker-supplied push payloads (any Spirit client can VAPID-sign a push per the already-approved PN2 design) -- app.js assigns decoded room/token straight into input `.value` fields, no eval/HTML/URL-context injection surface; `encodeURIComponent` is sufficient.
- The root-relative `/` assumption in `buildJoinUrl` is a new (vs. `copyInviteLink`'s `location.pathname`-preserving approach) but consistent assumption given actual deployment (spirit.kolo.media/spirit.kibr.com.ua are domain-root) -- reinforced, not weakened, by the scope fix.
- The untested `/* c8 ignore */` runtime glue correctly handles a no-body push (`event.data ? ... : null`) and wraps `.json()` parsing in try/catch.
- Eager SW registration (no `install`/`activate`/`fetch` handlers) triggers no permission prompt and implies no caching behavior -- correct and intentional.

Convergence: not reached, iteration 2 required after fixes.
