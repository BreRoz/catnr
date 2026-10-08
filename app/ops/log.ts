// Operational log. Every event is written to the Worker log as one JSON line (visible in Cloudflare
// observability) and, for the kinds that matter, to the ops_events table so it survives and can be
// counted. Nothing here may ever break a request, and nothing here may contain rescue content:
// owners appear only as a one-way fingerprint and free text is scrubbed and cut short.
type D1 = D1Database;

export const OPS_KINDS = [
  "api_error",
  "db_error",
  "ai_call",
  "ai_failure",
  "ai_invalid",
  "upload_rejected",
  "auth_failure",
  "limit_hit",
  "retry_replay",
  "slow_request",
  "job_ok",
  "job_failure",
] as const;
export type OpsKind = (typeof OPS_KINDS)[number];
export type OpsEvent = {
  kind: OpsKind;
  owner?: string | null;
  route?: string | null;
  status?: number | null;
  durationMs?: number | null;
  detail?: unknown;
};

const MAX_DETAIL = 200;

/** Removes anything that could identify a person or unlock a service, then shortens the text. */
export function scrub(value: unknown, max = MAX_DETAIL): string | null {
  if (value == null) return null;
  const text = value instanceof Error ? `${value.name}: ${value.message}` : String(value);
  return (
    text
      .replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[image]")
      .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, "[key]")
      .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]")
      .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[jwt]")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max) || null
  );
}

/** A short one-way fingerprint: enough to count one person's requests, useless for finding who. */
export async function fingerprint(owner: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`catnr-ops:${owner}`)));
  return [...bytes.slice(0, 6)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** /api/manage/cats/abc123xyz... -> /api/manage/cats/:id (keeps the log free of record identifiers). */
export function routeLabel(pathname: string): string {
  return pathname
    .split("/")
    .map((part) => (part.length > 16 || /\d{4,}/.test(part) ? ":id" : part))
    .join("/")
    .slice(0, 80);
}

const newId = () => `ops_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

/** Logs the event and stores it. Returns the stored row's id (null if it could not be stored). */
export async function recordEvent(db: D1 | null | undefined, event: OpsEvent): Promise<string | null> {
  const detail = scrub(event.detail);
  const line = {
    ops: true,
    kind: event.kind,
    route: event.route ?? null,
    status: event.status ?? null,
    ms: event.durationMs ?? null,
    detail,
  };
  (event.kind.endsWith("failure") || event.kind.endsWith("error") ? console.error : console.log)(JSON.stringify(line));
  if (!db) return null;
  try {
    const id = newId(),
      owner = event.owner ? await fingerprint(event.owner) : null;
    await db
      .prepare("INSERT INTO ops_events(id,kind,owner_hash,route,status,duration_ms,detail) VALUES(?,?,?,?,?,?,?)")
      .bind(id, event.kind, owner, event.route ?? null, event.status ?? null, event.durationMs ?? null, detail)
      .run();
    return id;
  } catch {
    return null; // Monitoring must never be the reason a request fails.
  }
}

/** Completes an earlier event (an AI call records when it starts, so a crash is still counted). */
export async function finishEvent(db: D1 | null | undefined, id: string | null, durationMs: number, status: number | null) {
  if (!db || !id) return;
  try {
    await db.prepare("UPDATE ops_events SET duration_ms=?, status=? WHERE id=?").bind(Math.round(durationMs), status, id).run();
  } catch {
    /* best effort */
  }
}
