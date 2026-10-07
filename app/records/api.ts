// Client helpers for the manual record endpoints (/api/manage/*). None of these call the AI.
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number; pages: number; hasMore: boolean };
export type Params = Record<string, string | number | boolean | null | undefined>;

export class ApiError extends Error { constructor(message: string, public status: number, public outcome?: string) { super(message); } }

export const toQuery = (params: Params) => {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "" && value !== false) q.set(key, String(value));
  return q.toString();
};

export async function getJson<T>(resource: string, params: Params = {}): Promise<T> {
  const query = toQuery(params);
  const response = await fetch(`/api/manage/${resource}${query ? `?${query}` : ""}`, { headers: { accept: "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.message || "Couldn’t load that. Try again.", response.status, data.outcome);
  return data as T;
}

/** POST a change. `requestKey` makes a retry after a lost connection safe (the server replays the first result). */
export async function send<T = { message: string; id?: string }>(resource: string, body: Record<string, unknown>, requestKey: string, method: "POST" | "PATCH" = "POST"): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/manage/${resource}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, requestKey }) });
  } catch {
    throw new ApiError("The connection failed, so I can’t tell whether that saved. Tap Save again — it’s safe to retry and won’t create a duplicate.", 0, "uncertain");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.message || "That didn’t save. Nothing was changed.", response.status, data.outcome);
  return data as T;
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
