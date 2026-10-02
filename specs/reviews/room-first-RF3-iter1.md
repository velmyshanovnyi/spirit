---
spec: specs/ui/room-first.md
section: RF3 — invite card on the stage replaces the welcome modal
iter: 1
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/index.html
  - client/css/style.css
  - client/js/app.js
  - client/js/i18n.js
  - client/js/locales/*.js
  - client/tests/app.test.js
  - specs/ui/room-first.md
---

# Verdict: PASS — 0 findings (1 optional nit, fixed)

1. **Visibility** — card shown only for `isInviteOwner && !channel` with
   room/token present; joiner never sets the flag; `handleConnectionTornDown`
   nulls the channel before re-render and does not clear the flag → owner's
   card returns, joiner's never. Group-tagged invites: hidden, consistent
   with `#invite-bar`.
2. **Stale link** — none: both hooks return early on the stale-connection
   guard before `renderInviteCard`; every render re-reads `#room-id`/`#invite-token`.
3. **Welcome removal** — no leftover `#welcome-modal` / `btn-welcome-confirm`
   / `welcome.*` / `spirit.welcomeSeen` writes; `cameFromInviteLink` still
   used (postIdentityRoute etc.); `.modal-overlay` CSS untouched.
   Nit: two comments in serverConfigUI.js referenced welcomeSeen — reworded.
4. **i18n** — parity green; no `data-i18n="welcome.*"` left.
5. **Tests** — `onChannelClose` maps to `handleConnectionTornDown`; the copy
   test's `#invite-link-display` proxy is valid (same `copyInviteLink`).
6. **Spec ↔ code** — matches ("remove with a comment" option taken).

Tests: app + i18n 421/421. Author full suite: 1067/1068 — one PoW
wall-clock flake under load (12/12 in isolation; second occurrence today,
see backlog note).

## Author's live verification (2026-10-02; 26 files deployed byte-identical)
- **kolomedi** (fresh H5 visit): no welcome modal; card visible on the
  stage with «Поки що ви тут самі», full invite link (room+token), copy
  button writes the same link `copyInviteLink` does. Screenshot: stage →
  card → controls → chat.
- **kibr** (saved account): card hidden while no invite exists; «Вийти»
  → new room → card shown with the new link. No console errors.
