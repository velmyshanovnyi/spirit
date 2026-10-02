---
spec: specs/phase5/deploy-freshness.md
section: F2 — navigations fetched by URL (F1 bug)
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/sw.js
  - client/tests/sw.test.js
  - specs/phase5/deploy-freshness.md
---

# Verdict: PASS_WITH_NOTES → 1 finding, FIXED (see iter2)

## Finding 1 (fixed)
`client/sw.js` navigate branch — `return [request.url, { cache: "no-cache", credentials: "same-origin" }];`
A URL fetch defaults to redirect "follow"; a navigation's own redirect mode is
"manual", so `respondWith()` rejects a followed-redirect response → browser
error page for any redirected navigation (`/dir` → `/dir/`, `/index.html` → `/`).
The `.catch` fallback does not help (the fetch resolves; the failure is in
respondWith). Verified by author: the quote matches; kibr really answers
`/js` with 301 → `/js/`. **Fix:** `redirect: "manual"` (opaqueredirect, the
browser follows it itself); test expectation + spec updated.

## Other checks (all PASS)
- Credentials "same-origin" correct; dropping the navigate Request loses
  nothing (GET-only via shouldForceRevalidate; browser-managed headers).
- Offline fallback unchanged; URL fetch adds no non-network rejection.
- Non-navigate branch byte-identical to F1.
- Tests pin shapes (branch swap / dropped credentials fail).
- Spec F2 and corrected «Рішення» note match code.
- Only consumer of sw.js exports is sw.test.js.

Tests: sw.test.js 19/19.
