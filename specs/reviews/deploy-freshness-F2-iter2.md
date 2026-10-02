---
spec: specs/phase5/deploy-freshness.md
section: F2 — navigations fetched by URL (F1 bug)
iter: 2
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/sw.js
  - client/tests/sw.test.js
  - specs/phase5/deploy-freshness.md
---

# Verdict: PASS — 0 findings (delta: `redirect: "manual"`)

1. respondWith() accepts an opaqueredirect only for a request whose redirect
   mode is "manual" (a navigation's own mode); Chrome follows it as a fresh
   navigation, which re-enters the handler without looping.
2. No change for 200 responses (`redirect` only matters for 3xx).
3. Offline fallback unchanged; the fallback passes the original navigate
   Request without init, so no TypeError.
4. 304 is not a redirect status (and the HTTP cache resolves a conditional
   304 into a 200 before fetch sees it); fragment loss in `request.url` is
   irrelevant (never sent).

Tests: sw.test.js 19/19. Author full suite: 63 files, 1062/1062.

## Author's live verification (2026-10-02)
- **Bug reproduced before the fix** (both hosts, fresh tab): navigation had
  `deliveryType "cache"`, `encodedBodySize 53123` (previous commit's
  index.html) with `workerStart > 0`, while `fetch("/")` through the same SW
  was fresh.
- **After deploying sw.js** (6884 B → 7161 B after iter2, byte-identical on
  both): kibr fresh tab navigation → `deliveryType ""`, `encodedBodySize 53901`
  (current). kolomedi, tab opened BEFORE the deploy, `location.reload()` →
  `deliveryType ""`, fresh index; app.js/profileUI.js/i18n.js all via SW
  with current sizes (the "i18n.js memory-cache" residual from the F2 spec
  did not reproduce — it was the same bug's shadow).
- **Redirect (iter1 finding)**: kibr `/js` → server 301 `/js/` → browser
  followed it and rendered the server's own 403 directory page; no console
  errors, no SW error page.
