---
spec: specs/phase5/app-decomposition.md
section: R9 — chat sending → chatSend.js
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/chatSend.js
  - client/js/app.js
  - client/tests/chatSend.test.js
  - specs/phase5/app-decomposition.md
---

# Verdict: PASS — 0 findings (1 test suggestion, applied)

1. **Verbatim move** — 111 removed lines vs module body as a normalized
   multiset: only the header comment, 3 imports, the `initChatSend` wrapper,
   the `return {...}` and the pruned `encodeRatchetPayload,` import line differ.
2. **TDZ / ordering** — init at app.js:3290; injected consts defined above
   (setDynamicText 591, setStatus 595, appendChat 718, appendGroupChat 788,
   setVideoStatus 1886); clearPendingBadge (779) / nextSendMessageKey (2712)
   hoisted. Uses of the returned consts: flush 2555/2800/2847 (callbacks),
   sendGroupMessage 3356, sendChatMessage 3358/3377 (handlers) — none
   synchronous before the init line.
3. **Import pruning** — `encodeRatchetPayload` 0 uses; ratchetChain import not
   empty; `appendMessage`/`encryptMessage` still used.
4. **Shared state** — module never reassigns `state`.
5. **Tests** — queue→flush asserts exact payload `R2:7:ENC(…)`, drain, status
   hidden; group test excludes the other-group peer. Suggestion applied: the
   "dead" peer now has a real channel but no session key and is asserted
   not-called (proves the key check, not a swallowed TypeError).
6. **Spec** — Enter-in-group-mode note describes pre-existing behaviour
   (handler untouched); recorded in backlog as a one-line fix candidate.

Tests: chatSend + app 417/417. Author full suite: 64 files, 1078/1078.

## Author's live verification (2026-10-02; app.js 169636 B, chatSend.js 6565 B byte-identical on both hosts)
- **kolomedi**: `chatSend.js` in Resource Timing; message sent via btn-send
  with no peer → bubble with pending badge, `chat-send-status` localized
  queue text, connection status «немає активного з'єднання», input cleared.
- **kibr**: same via Enter after «Вийти» (new room). No console errors.
