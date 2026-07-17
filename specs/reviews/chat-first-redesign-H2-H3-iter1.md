---
spec: ui/chat-first-redesign
section: H2-H3
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/index.html
  - client/js/app.js
  - client/css/style.css
  - client/js/i18n.js
  - client/tests/app.test.js
---

Two findings, both required fixes before commit:

**1. CONFIRMED — duplicate `renderGuestQuickActions()` calls.** A mechanical multi-target text replacement (pairing `renderGuestQuickActions();` with every `resetOwnProofsState();` call site) double-applied at 4 of 7 sites instead of missing them, due to indentation-sensitive matching being run twice. Harmless at runtime (the function only sets `bar.hidden`, idempotent) but dead/duplicate code. Fixed by removing the extra call at each site and normalizing indentation.

**2. PLAUSIBLE — logout left `state.localTracksAddedToPeer`/`isInviteOwner`/`peerIdentityPublicKey` unreset.** A post-logout fresh session could inherit the stale `localTracksAddedToPeer=true` flag, silently skipping `addLocalMediaTracks()` on the NEW peer connection's first call. Self-heals in the common path (channel.close() fires onChannelClose which resets it) but not guaranteed if logout races the async close. Fixed by explicitly resetting these three fields in the `btn-logout` handler.

Non-defects confirmed during this pass:
- `.modal-overlay`/`z-index:100` vs `.settings-wrap .app-nav`/`z-index:101`: no real competing scenario exists today (only one modal, dismissed before other UI use).
- `#guest-quick-actions`'s `hidden` attribute removal from the raw markup (relying on JS init call instead): no synchronous auto-restore-session path exists that could cause a flash for an already-logged-in user.
- `btn-quick-create`/`btn-quick-login`'s reuse of `link-switch-to-create`/`link-switch-to-login` via `.click()`: those handlers only toggle `hidden` flags with no focus/bubbling side effects, so the synthetic click fully replicates a manual one.
- Logout's synchronous `state.channel.close()`/`state.pc.close()` doesn't crash any pending async webrtc.js callback (all null-guarded or wrapped in try/catch->setStatus).
- All 7 `resetOwnProofsState()` call sites correctly identified, none missing/dead-branched (only the duplication defect above).

Convergence: not reached, iteration 2 required after fixes.
