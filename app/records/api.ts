import { describeFailure } from "../feedback";
// Client helpers for the manual record endpoints (/api/manage/*). None of these call the AI.
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number; pages: number; hasMore: boolean };
export type Params = Record<string, string | number | boolean | null | undefined>;

export class ApiError extends Error { constructor(message: string, public status: number, public outcome?: string) { super(message); } }

export const toQuery = (params: Params) => {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "" && value !== false) q.set(key, String(value));
  return q.toString();
};

const TIMEOUT_MS = 30000;
const WHAT: Record<string, string> = { cats: "cats", colonies: "colonies", people: "people", transactions: "money entries", events: "history", photos: "photos", reports: "the report", duplicates: "possible duplicates", merges: "that merge", account: "your account details", export: "your download options", import: "the import options" };

/** Runs fetch with a time limit and maps every way it can go wrong to a plain-language ApiError. */
async function request<T>(resource: string, init: RequestInit, kind: "read" | "write", action: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/manage/${resource}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const f = describeFailure({ action, kind, network: true, timedOut: e instanceof DOMException && e.name === "TimeoutError" });
    throw new ApiError(f.message, 0, f.saved === "unknown" ? "uncertain" : "network");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const f = describeFailure({ action, kind, status: response.status, outcome: data?.outcome, message: data?.message, unreadable: data === null && response.ok });
    throw new ApiError(f.message, response.status, data?.outcome);
  }
  return data as T;
}

export function getJson<T>(resource: string, params: Params = {}): Promise<T> {
  const query = toQuery(params);
  return request<T>(`${resource}${query ? `?${query}` : ""}`, { headers: { accept: "application/json" } }, "read", `load ${WHAT[resource] ?? "that"}`);
}

/** POST a change. `requestKey` makes a retry after a lost connection safe (the server replays the first result). */
export function send<T = { message: string; id?: string }>(resource: string, body: Record<string, unknown>, requestKey: string, method: "POST" | "PATCH" = "POST"): Promise<T> {
  return request<T>(resource, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, requestKey }) }, "write", "save that");
}

export const newKey = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
export const photoUrl = (id: string) => `/api/manage/photos?image=${encodeURIComponent(id)}`;

/** Shrinks a chosen photo to at most 1280px and returns a JPEG data URL (the server accepts up to ~1.3 MB). */
export function resizeToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("I couldn’t read that photo. Choose it again."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("I couldn’t read that photo. Choose it again."));
      image.onload = () => {
        const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        if (!context) { reject(new Error("I couldn’t read that photo. Choose it again.")); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
