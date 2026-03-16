import { describe, expect, it, beforeEach } from "vitest";

import {
  loadBookmarks,
  saveBookmarks,
  createBookmark,
  removeBookmark,
  MAX_BOOKMARKS,
  STORAGE_KEY,
  type Bookmark
} from "./bookmarks";

/** Minimal localStorage stub backed by a plain object. */
function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null
  };
}

describe("bookmarks", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createStorageStub();
  });

  describe("loadBookmarks", () => {
    it("returns [] when storage is empty", () => {
      expect(loadBookmarks(storage)).toEqual([]);
    });

    it("returns [] when storage contains invalid JSON", () => {
      storage.setItem(STORAGE_KEY, "not-json{{{");
      expect(loadBookmarks(storage)).toEqual([]);
    });

    it("returns [] when storage contains a non-array", () => {
      storage.setItem(STORAGE_KEY, JSON.stringify({ foo: "bar" }));
      expect(loadBookmarks(storage)).toEqual([]);
    });

    it("returns [] when storage contains null", () => {
      storage.setItem(STORAGE_KEY, "null");
      expect(loadBookmarks(storage)).toEqual([]);
    });

    it("caps at MAX_BOOKMARKS, keeping only the first entries", () => {
      const bookmarks: Bookmark[] = Array.from({ length: 30 }, (_, i) =>
        createBookmark(`Place ${i}`, { lng: i, lat: i, zoom: 10, pitch: 0, bearing: 0 })
      );
      storage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
      const loaded = loadBookmarks(storage);
      expect(loaded).toHaveLength(MAX_BOOKMARKS);
      expect(loaded[0].label).toBe("Place 0");
      expect(loaded[MAX_BOOKMARKS - 1].label).toBe(`Place ${MAX_BOOKMARKS - 1}`);
    });
  });

  describe("saveBookmarks", () => {
    it("persists bookmarks to storage", () => {
      const bm = createBookmark("Test", { lng: 1, lat: 2, zoom: 3, pitch: 4, bearing: 5 });
      saveBookmarks([bm], storage);
      const raw = storage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual([bm]);
    });
  });

  describe("round-trip", () => {
    it("saveBookmarks + loadBookmarks round-trips correctly", () => {
      const bookmarks = [
        createBookmark("Alpha", { lng: -3.19, lat: 55.95, zoom: 14.8, pitch: 68, bearing: -20 }),
        createBookmark("Beta", { lng: 139.76, lat: 35.68, zoom: 15.6, pitch: 70, bearing: 36 })
      ];
      saveBookmarks(bookmarks, storage);
      const loaded = loadBookmarks(storage);
      expect(loaded).toEqual(bookmarks);
    });
  });

  describe("createBookmark", () => {
    it("generates a valid bookmark with auto-caption from coords", () => {
      const camera = { lng: -3.1883, lat: 55.9533, zoom: 14.8, pitch: 68, bearing: -20 };
      const bm = createBookmark("Edinburgh", camera);

      expect(bm.label).toBe("Edinburgh");
      expect(bm.caption).toBe("55.95, -3.19");
      expect(bm.lng).toBe(-3.1883);
      expect(bm.lat).toBe(55.9533);
      expect(bm.zoom).toBe(14.8);
      expect(bm.pitch).toBe(68);
      expect(bm.bearing).toBe(-20);
      expect(bm.id).toBeTruthy();
      // UUID format
      expect(bm.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it("formats negative lat/lng correctly in caption", () => {
      const camera = { lng: -122.33, lat: -33.87, zoom: 10, pitch: 0, bearing: 0 };
      const bm = createBookmark("Somewhere South", camera);
      expect(bm.caption).toBe("-33.87, -122.33");
    });

    it("formats zero coords with 2 decimal places in caption", () => {
      const camera = { lng: 0, lat: 0, zoom: 1, pitch: 0, bearing: 0 };
      const bm = createBookmark("Null Island", camera);
      expect(bm.caption).toBe("0.00, 0.00");
    });

    it("generates unique IDs for different bookmarks", () => {
      const camera = { lng: 0, lat: 0, zoom: 1, pitch: 0, bearing: 0 };
      const a = createBookmark("A", camera);
      const b = createBookmark("B", camera);
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("removeBookmark", () => {
    it("removes the correct entry by id", () => {
      const camera = { lng: 0, lat: 0, zoom: 1, pitch: 0, bearing: 0 };
      const a = createBookmark("A", camera);
      const b = createBookmark("B", camera);
      const c = createBookmark("C", camera);

      const result = removeBookmark([a, b, c], b.id);
      expect(result).toHaveLength(2);
      expect(result.map((bm) => bm.label)).toEqual(["A", "C"]);
    });

    it("returns the same array when id is not found", () => {
      const camera = { lng: 0, lat: 0, zoom: 1, pitch: 0, bearing: 0 };
      const a = createBookmark("A", camera);
      const result = removeBookmark([a], "nonexistent-id");
      expect(result).toEqual([a]);
    });

    it("returns empty array when removing the only bookmark", () => {
      const camera = { lng: 0, lat: 0, zoom: 1, pitch: 0, bearing: 0 };
      const a = createBookmark("A", camera);
      const result = removeBookmark([a], a.id);
      expect(result).toEqual([]);
    });
  });

  describe("MAX_BOOKMARKS", () => {
    it("is 24", () => {
      expect(MAX_BOOKMARKS).toBe(24);
    });
  });
});
