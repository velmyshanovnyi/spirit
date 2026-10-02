---
spec: specs/phase5/core-dispatch.md
section: C1 — handleChatMessage → CONTROL_HANDLERS table
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/app.js
  - client/tests/app.test.js
  - specs/phase5/core-dispatch.md
---

# Verdict: PASS — 0 findings

1. **Verbatim** — `git diff -U0` removed vs added lines as whitespace-stripped
   multisets: only structural lines differ (old literal Set, 15 `if` lines ↔
   `let` declaration, dispatch line, 15 signatures, table, Set assignment,
   test hook). Every body line incl. trailing `return;` survived; branch
   comments landed on the matching function (FT2 above onFileOffer, RF10 →
   onSafetyDisplayMode, GC4 → onMeshRelay, S2 → onRecoveryShareAnnounce…).
2. **`let` Set** — only three references (declaration, `.has` inside
   handleChatMessage, assignment); no other reader.
3. **TDZ** — handleChatMessage runs only as a message callback
   (`onDecryptedMessage` default in wireChannelCallbacks) after initApp;
   `win` (1698) precedes the hook (2411).
4. **Unknown type** — `control` is set only if the Set has the type; the
   table literal has no inherited-looking own keys → handler always exists;
   unknown types take the unchanged plain-text path.
5. **Tests** — drift guard lists the 16 types explicitly (non-vacuous);
   unknown-type test asserts the raw JSON in #chat-log (pre-change behaviour).
6. **Spec ↔ code** — 16 keys, mesh pair → one handler, 15 functions, derived Set.

Non-blocking: a stale "line ~309 above" comment in onWebrtcCallOffer predates
this change (moved verbatim).

Tests: app.test.js 417/417. Author full suite: 64 files, 1082/1082.

## Author's live verification (2026-10-03; app.js byte-identical on both hosts)
kolomedi + kibr: fresh app.js, `window.__spiritControlHandlers` has 16 keys,
all functions; sending a message with no peer still queues (plain path intact);
no console errors.
