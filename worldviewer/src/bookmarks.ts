export type Bookmark = {
  id: string;
  label: string;
  caption: string;
  lng: number;
  lat: number;
  zoom: number;
  pitch: number;
  bearing: number;
};

export const STORAGE_KEY = "worldviewer-bookmarks";
export const MAX_BOOKMARKS = 24;

/** Fail-closed shape guard: localStorage is user/version-writable, so validate
 * each element before trusting it as a Bookmark (one bad entry must not crash
 * rendering or feed NaN into the camera). */
export function isBookmark(value: unknown): value is Bookmark {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.label === "string" &&
    typeof v.caption === "string" &&
    Number.isFinite(v.lng) &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.zoom) &&
    Number.isFinite(v.pitch) &&
    Number.isFinite(v.bearing)
  );
}

/** Load bookmarks from localStorage. Returns [] on parse failure or when empty. */
export function loadBookmarks(storage: Storage = localStorage): Bookmark[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter before slicing so corrupt entries don't consume the cap.
    return parsed.filter(isBookmark).slice(0, MAX_BOOKMARKS);
  } catch {
    return [];
  }
}

/** Save bookmarks array to localStorage. */
export function saveBookmarks(bookmarks: Bookmark[], storage: Storage = localStorage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
}

/** Create a Bookmark from the current camera state and a user-supplied name. */
export function createBookmark(
  label: string,
  camera: { lng: number; lat: number; zoom: number; pitch: number; bearing: number }
): Bookmark {
  return {
    id: crypto.randomUUID(),
    label,
    caption: `${camera.lat.toFixed(2)}, ${camera.lng.toFixed(2)}`,
    lng: camera.lng,
    lat: camera.lat,
    zoom: camera.zoom,
    pitch: camera.pitch,
    bearing: camera.bearing
  };
}

/** Remove a bookmark by id. Returns the updated array. */
export function removeBookmark(bookmarks: Bookmark[], id: string): Bookmark[] {
  return bookmarks.filter((bm) => bm.id !== id);
}
