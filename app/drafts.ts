// Keeps what Ari typed, said or photographed on the phone until it is saved. Phones often reload the page
// when the camera app opens or the browser is backgrounded, which would otherwise lose it.

export type Draft = {
  mode: "mic" | "text" | "ask" | "photo";
  text: string;
  photo: { name: string; dataUrl: string } | null;
  savedAt: number;
};
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "catnr-draft-v1";
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** `saved` tells the caller what survived, so the UI can say so if the photo didn't fit. */
export type SaveResult = "saved" | "text-only" | "failed" | "cleared";

export function createDraftStore(storage: StorageLike | null = defaultStorage(), now: () => number = Date.now) {
  return {
    load(): Draft | null {
      try {
        const raw = storage?.getItem(KEY);
        if (!raw) return null;
        const d = JSON.parse(raw) as Draft;
        if (!d || typeof d.text !== "string" || now() - d.savedAt > MAX_AGE_MS) {
          storage?.removeItem(KEY);
          return null;
        }
        if (!d.text.trim() && !d.photo) return null;
        return { mode: d.mode, text: d.text, photo: d.photo?.dataUrl ? d.photo : null, savedAt: d.savedAt };
      } catch {
        return null;
      }
    },
    save(draft: Omit<Draft, "savedAt">): SaveResult {
      if (!storage) return "failed";
      if (!draft.text.trim() && !draft.photo) {
        try {
          storage.removeItem(KEY);
        } catch {
          /* nothing to clean */
        }
        return "cleared";
      }
      const full: Draft = { ...draft, savedAt: now() };
      try {
        storage.setItem(KEY, JSON.stringify(full));
        return "saved";
      } catch {
        /* quota: keep the words even if the photo won't fit */
      }
      try {
        storage.setItem(KEY, JSON.stringify({ ...full, photo: null }));
        return draft.photo ? "text-only" : "saved";
      } catch {
        return "failed";
      }
    },
    clear() {
      try {
        storage?.removeItem(KEY);
      } catch {
        /* nothing to clean */
      }
    },
  };
}
