---
spec: specs/ui/room-first.md
section: RF2 — room controls (mic / camera / leave), owner auto-call
iter: 3
agent: Opus subagent (Task), independent of author
files-reviewed:
  - client/js/app.js
  - client/tests/app.test.js
  - specs/ui/room-first.md
---

# Verdict: PASS — 0 new findings (delta of the two iter2 fixes; converged at the cap)

- (a) No duplicate `addTrack` on the same pc: the A3 path always assigns a
  fresh `state.pc = startAsInitiator(...)` after `resetActiveConnection()`
  deleted the old entry; the test asserts `addLocalMediaTracks(pc2)`.
- (b) The reset runs synchronously after `resetActiveConnection()` /
  `state.isInviteOwner = true` and before `makeIdentityAnnouncer()` /
  `startInitiatorSession(...)`, so no verification for the new session can
  precede it.
- (c) The new test genuinely exercises A3 (second `btn-initiate` with the
  first verified call live, no logout/leave) and fails without the reset.
- (d) The guard reads the plain `state.activeConnectionId` field
  synchronously before the await and compares after.

Tests: app.test.js 408/408. Author full suite: 63 files, 1069/1069 (one
earlier PoW wall-clock flake under load passed in isolation, 12/12).

## Author's live verification (2026-10-02)
- **kolomedi** (desktop + 375 px): `#room-controls` under the stage with
  three 60 px round buttons (mic / camera / red leave), `btn-start-call` and
  `#header-call-controls` gone, mic/camera enabled before any connection,
  leave title localized; **«Вийти з кімнати»** → new room id
  (`bfab` → `e182`), identity kept (`pub-key-display` unchanged), invite bar
  shown again. Screenshot matches mockup C (stage + silhouette + status +
  controls + chat).
- **kibr**: same build byte-identical; leave → new room verified after the
  final (iter3) app.js deploy (see commit message / chat log).
- Media/call itself cannot be exercised in the browser pane (camera denied);
  the auto-call ordering, retry and A3 paths are covered by the new unit
  tests. Real two-browser call check remains the user's (same as A12).
