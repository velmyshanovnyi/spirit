---
spec: phase4/group-chats
section: GC1
iter: 1
agent: opus-subagent (general-purpose)
files-reviewed:
  - client/js/groups.js
  - client/js/contacts.js
  - client/js/db.js
  - client/tests/groups.test.js
  - client/tests/historyStore.test.js
  - specs/phase4/group-chats.md
---

Focus: correctness/consistency of the new `client/js/groups.js` CRUD module (group membership
storage) and the `client/js/db.js` `groups` store / `DB_VERSION` bump (2 -> 3). No UI or
connection-orchestration code is in scope (GC2/GC3).

Four checks performed, all passed, zero findings:

1. **contacts.js convention mirroring** — `getGroup` delegates to `get("groups", ...)`, which
   returns `undefined` for an unknown key, exactly like `getContact`. `updateGroupMembers`
   implements the identical orphan-record guard as `updateContactDeviceList` /
   `updateContactProofSet` / `updateContactPushSubscription`: re-fetch, throw
   `Unknown group: ...` if absent, else spread-merge. Test at `groups.test.js` confirms the
   throw with `/unknown group/i`.

2. **groupId entropy** — `randomGroupId` in `groups.js` is byte-for-byte identical in pattern
   to `randomConnectionId` and `randomFileId` in `app.js`: `crypto.getRandomValues(new
   Uint8Array(16))`, hex-encoded via `padStart(2, "0")`. 128 bits, same standard as the rest
   of the codebase's random IDs.

3. **DB_VERSION bump idempotency** — `db.js` bumps `DB_VERSION` 2 -> 3 and appends `"groups"`
   to `STORE_NAMES`. `onupgradeneeded` iterates `STORE_NAMES` guarding each with
   `if (!db.objectStoreNames.contains(storeName))` -- the same loop-based guard that already
   protected the earlier `trustedShares` addition (Section S2). Existing v1/v2 databases skip
   already-present stores and only create `groups`. No throw, no data loss on upgrade.

4. **Other correctness** — `createGroup` returns the stored record including generated
   `groupId`/`createdAt`; `now = Date.now()` default matches `contacts.js`'s injectable-clock
   style. `listGroups` mirrors `listContacts` (`listKeys` + `Promise.all(get)`). `deleteGroup`
   uses `remove`, confirmed by test that a second `getGroup` returns `undefined`. The
   `historyStore.js` group-namespace tests confirm `contactId` is treated as an opaque string
   key with no special handling needed, matching the spec's Impl note that `historyStore.js`
   required zero code changes -- including a same-string-format collision case (`GROUP_ID =
   CONTACT_A`) that does not mix group and 1:1 histories.

**Outcome**: 0 findings. Converged on iteration 1, no fixes required.

Full suite: 653/653 passing (642 pre-existing + 8 `groups.test.js` + 3 new `historyStore.test.js`
group-namespace tests).
