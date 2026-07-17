---
spec: ui/ephemeral-spirit-mode
section: F6-followup
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/index.html
  - client/js/app.js
  - client/tests/app.test.js
---

Bug report (2026-07-17, screenshot): after Section F6 landed, a user on the conversation lobby (nobody joined yet) found that clicking "Надіслати" and pressing Enter both silently did nothing, with no visible explanation. Root cause: `#connection-status` (targeted by every `setStatus(...)` call site) was relocated to the "conversation" screen as part of F6, but Enter had never sent messages at all (button-click-only, pre-existing gap noticed while investigating).

Fix: relocated `#connection-status` into the conversation screen's markup (pure id-target fix, no JS logic change needed since every call site already goes through `el("connection-status")`); added `sendChatMessage()` extracted from the button handler, reused by a new `keydown` listener on `#message-input` (Enter without Shift sends).

Three findings, all required fixes before commit:

1. **CONFIRMED regression** — the `btn-initiate`/`btn-join` guard (`if (!state.senderKey) setStatus(t("status.createAccountFirst"))`) fires BEFORE navigation, while the user is still on the un-gated "room" screen — but `#connection-status` now lives only on the gated "conversation" screen, making this specific message invisible to a fresh visitor with no identity. Fixed by mirroring `setStatus()` to a new `#room-status` element.
2. **CONFIRMED** — the new Enter-to-send `keydown` listener had no `event.isComposing`/keyCode-229 guard, so an IME candidate-commit Enter (CJK/other composed input) would send partial, still-in-progress text. Fixed.
3. **CONFIRMED test gap** — a test titled "...Shift+Enter... is left alone" actually dispatched `key: "a"`, never testing Shift+Enter at all. The core send/no-send behavior WAS genuinely tested (real KeyboardEvent dispatch, real assertions), just this one test's title didn't match its body. Fixed by renaming + adding a genuine Shift+Enter test.

Convergence: not reached, iteration 2 required after fixes.
