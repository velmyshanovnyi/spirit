import { get, put, remove, listKeys } from "./db.js";

/**
 * Group membership registry (specs/phase4/group-chats.md, Section GC1):
 * a mesh-architecture group is just a named set of contact fingerprints --
 * no shared group key, no server-side state. Keyed by a randomly generated
 * groupId (same entropy/format as connectionId/randomFileId in app.js:
 * 16 random bytes, hex-encoded).
 */
function randomGroupId() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createGroup({ name, memberFingerprints, now = Date.now() }) {
  const groupId = randomGroupId();
  const group = { groupId, name, memberFingerprints, createdAt: now };
  await put("groups", groupId, group);
  return group;
}

export async function getGroup(groupId) {
  return get("groups", groupId);
}

export async function listGroups() {
  const keys = await listKeys("groups");
  return Promise.all(keys.map((key) => get("groups", key)));
}

/**
 * Replaces the group's member list (GC2: adding a new participant runs its
 * own 1:1 handshakes, then calls this to persist the updated roster). Same
 * orphan-record guard as contacts.js's updateContactDeviceList -- a member
 * list only makes sense for an already-created group.
 */
export async function updateGroupMembers(groupId, memberFingerprints) {
  const existing = await get("groups", groupId);
  if (!existing) {
    throw new Error(`Unknown group: ${groupId}`);
  }
  await put("groups", groupId, { ...existing, memberFingerprints });
}

export async function deleteGroup(groupId) {
  await remove("groups", groupId);
}
