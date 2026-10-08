// What the worker notices about every API request after the fact: server errors, refused sign-ins,
// too-large requests and slow responses. Pure classification is separated from storage for testing.
import { recordEvent, routeLabel, type OpsKind } from "./log";
type D1 = D1Database;

export const SLOW_MS = 5000;
/** Past this many refused sign-ins in ten minutes the rest are only written to the log, never to the database. */
const AUTH_FAILURE_STORE_CAP = 50;

export function classify(pathname: string, status: number, ms: number): { kind: OpsKind; detail: string } | null {
  if (!pathname.startsWith("/api/")) return null;
  if (status >= 500) return { kind: "api_error", detail: `server error ${status}` };
  if (status === 401 || status === 403) return { kind: "auth_failure", detail: `refused with ${status}` };
  if (status === 413) return { kind: "limit_hit", detail: "request too large" };
  if (ms >= SLOW_MS) return { kind: "slow_request", detail: "slow response" };
  return null;
}

export async function observe(db: D1, input: { pathname: string; status: number; ms: number; owner?: string | null }) {
  const found = classify(input.pathname, input.status, input.ms);
  if (!found) return;
  await recordEvent(found.kind === "auth_failure" && (await storageFull(db)) ? null : db, {
    kind: found.kind,
    owner: input.owner,
    route: routeLabel(input.pathname),
    status: input.status,
    durationMs: input.ms,
    detail: found.detail,
  });
}

/** A request the worker itself refused before the app ran (missing or invalid Access token). */
export async function recordAuthFailure(db: D1, pathname: string, status: number, detail: string) {
  await recordEvent((await storageFull(db)) ? null : db, { kind: "auth_failure", route: routeLabel(pathname), status, detail });
}

async function storageFull(db: D1) {
  try {
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const row = await db
      .prepare("SELECT COUNT(*) n FROM ops_events WHERE kind='auth_failure' AND at>=?")
      .bind(since)
      .first<{ n: number }>();
    return (row?.n ?? 0) >= AUTH_FAILURE_STORE_CAP;
  } catch {
    return false;
  }
}
