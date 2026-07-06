import { describe, it, expect, beforeEach } from "vitest";
import { IDBFactory, IDBTransaction } from "fake-indexeddb";
import { openDatabase, put, get, remove, listKeys } from "../js/db.js";

beforeEach(() => {
  // Fresh, empty IndexedDB per test -- fake-indexeddb persists state on the
  // global otherwise, which would leak records between tests.
  global.indexedDB = new IDBFactory();
});

describe("openDatabase", () => {
  it("creates the profile, contacts, and messages object stores", async () => {
    const db = await openDatabase();
    expect(Array.from(db.objectStoreNames)).toEqual(
      expect.arrayContaining(["profile", "contacts", "messages"])
    );
    db.close();
  });
});

describe("put / get", () => {
  it("round-trips an arbitrary value", async () => {
    await put("profile", "identity", { encrypted: "blob-bytes-here" });
    const value = await get("profile", "identity");
    expect(value).toEqual({ encrypted: "blob-bytes-here" });
  });

  it("returns undefined for a key that was never stored", async () => {
    const value = await get("profile", "does-not-exist");
    expect(value).toBeUndefined();
  });

  it("rejects instead of hanging when the object store does not exist", async () => {
    await expect(get("no-such-store", "key")).rejects.toThrow();
  });

  it("rejects (does not resolve a stale value) if the transaction aborts after the read request already succeeded", async () => {
    await put("profile", "key1", { v: 1 });

    // Monkey-patch the exact call chain get() makes
    // (db.transaction(...).objectStore(storeName).get(key)) so that, once
    // the underlying request genuinely succeeds, we force the enclosing
    // transaction to abort -- reproducing the race a request-onsuccess-only
    // resolution would get wrong (it would resolve the now-invalid value
    // instead of rejecting).
    const originalObjectStore = IDBTransaction.prototype.objectStore;
    IDBTransaction.prototype.objectStore = function (...args) {
      const tx = this;
      const store = originalObjectStore.apply(tx, args);
      const originalGet = store.get.bind(store);
      store.get = (key) => {
        const request = originalGet(key);
        request.addEventListener("success", () => {
          tx.abort();
        });
        return request;
      };
      return store;
    };

    try {
      await expect(get("profile", "key1")).rejects.toThrow();
    } finally {
      IDBTransaction.prototype.objectStore = originalObjectStore;
    }
  });

  it("overwrites an existing value for the same key", async () => {
    await put("contacts", "alice", { name: "Alice v1" });
    await put("contacts", "alice", { name: "Alice v2" });
    const value = await get("contacts", "alice");
    expect(value).toEqual({ name: "Alice v2" });
  });
});

describe("remove", () => {
  it("deletes a stored record", async () => {
    await put("messages", "msg1", { text: "hi" });
    await remove("messages", "msg1");
    const value = await get("messages", "msg1");
    expect(value).toBeUndefined();
  });

  it("is a no-op when the key doesn't exist", async () => {
    await expect(remove("messages", "never-existed")).resolves.not.toThrow();
  });
});

describe("listKeys", () => {
  it("returns all keys stored in a given object store", async () => {
    await put("contacts", "alice", { name: "Alice" });
    await put("contacts", "bob", { name: "Bob" });

    const keys = await listKeys("contacts");

    expect(keys.sort()).toEqual(["alice", "bob"]);
  });

  it("returns an empty array for a store with nothing in it", async () => {
    const keys = await listKeys("messages");
    expect(keys).toEqual([]);
  });

  it("rejects (does not resolve a stale key list) if the transaction aborts after the read request already succeeded", async () => {
    await put("contacts", "alice", { name: "Alice" });

    const originalObjectStore = IDBTransaction.prototype.objectStore;
    IDBTransaction.prototype.objectStore = function (...args) {
      const tx = this;
      const store = originalObjectStore.apply(tx, args);
      const originalGetAllKeys = store.getAllKeys.bind(store);
      store.getAllKeys = () => {
        const request = originalGetAllKeys();
        request.addEventListener("success", () => {
          tx.abort();
        });
        return request;
      };
      return store;
    };

    try {
      await expect(listKeys("contacts")).rejects.toThrow();
    } finally {
      IDBTransaction.prototype.objectStore = originalObjectStore;
    }
  });
});
