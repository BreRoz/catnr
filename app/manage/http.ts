import { commit, digest, receipt, revision, writeFailure } from "../api/assistant/reliability";
import { ManageError, makeCtx, type Ctx, type D1, type Row, type Write } from "./common";

// Identity headers are set only by worker/index.ts after it verifies Cloudflare Access.
export function ownerFrom(req: Request): string | null {
  const owner = req.headers.get("x-catnr-user-id");
  return owner && req.headers.get("x-catnr-user-email") && owner.trim() && owner !== "local-owner" && !owner.startsWith("legacy:") ? owner : null;
}

const NO_STORE = { "cache-control": "no-store" };
export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: NO_STORE });
const unauthorized = () => json({ message: "Sign in to access rescue records." }, 401);

/** What each resource module provides: reads for GET, and a planner for writes (never writes itself). */
export interface Resource {
  read(db: D1, owner: string, url: URL, req: Request): Promise<unknown | Response>;
  write?(ctx: Ctx, body: Row, method: "POST" | "PATCH"): Promise<Write>;
  /** Full control of a POST for actions that are not a plain record change (a dry run, a whole-account deletion). */
  post?(db: D1, owner: string, body: Row, req: Request): Promise<unknown | Response>;
}

const MAX_BODY = 2_500_000;
const DB_MESSAGES: Array<[RegExp, string]> = [
  [/uniq_cats_owner_microchip|cats\.microchip_number|microchip_number/, "Another cat already has that microchip number. Nothing was saved."],
  [/uniq_colonies_owner_name|colonies\.owner_id, lower/, "A colony with that name already exists. Nothing was saved."],
  [/uniq_people_owner_name|people\.owner_id, lower/, "Someone with that name already exists. Nothing was saved."],
];

/** Plans a change, then commits it atomically with a retry receipt and a revision guard. */
export async function applyWrite(db: D1, owner: string, body: Row, method: "POST" | "PATCH", plan: (ctx: Ctx, body: Row, method: "POST" | "PATCH") => Promise<Write>): Promise<Response> {
  const { requestKey, ...payload } = body;
  if (requestKey != null && (typeof requestKey !== "string" || !requestKey || requestKey.length > 200)) return json({ outcome: "rejected", message: "Invalid retry key." }, 400);
  const hash = await digest(JSON.stringify({ method, payload }));
  const key = typeof requestKey === "string" ? requestKey : hash;
  let attempted = false;
  try {
    const saved = await receipt(db, owner, key, hash);
    if (saved) return saved;
    const base = await revision(db, owner);
    const { statements, response } = await plan(makeCtx(db, owner), payload, method);
    if (await revision(db, owner) !== base) throw new Error("Concurrent edit");
    attempted = true;
    await commit(db, owner, key, hash, base, statements, response);
    return json(response);
  } catch (error) {
    if (error instanceof ManageError) return json({ outcome: error.outcome, message: error.message }, error.status);
    try { const saved = await receipt(db, owner, key, hash); if (saved) return saved; } catch { /* keep the original failure */ }
    const known = DB_MESSAGES.find(([pattern]) => pattern.test(String(error)));
    if (known) return json({ outcome: "conflict", message: known[1] }, 409);
    return writeFailure(error, attempted);
  }
}

/** Builds GET/POST/PATCH handlers for a route file. */
export function serve(getDb: () => D1, resource: Resource) {
  const guard = (fn: (db: D1, owner: string, req: Request) => Promise<Response>) => async (req: Request) => {
    const owner = ownerFrom(req);
    if (!owner) return unauthorized();
    try { return await fn(getDb(), owner, req); } catch (error) {
      if (error instanceof ManageError) return json({ outcome: error.outcome, message: error.message }, error.status);
      return json({ outcome: "retryable", message: "Something went wrong reading your records. Nothing was changed; try again." }, 503);
    }
  };
  const mutate = (method: "POST" | "PATCH") => guard(async (db, owner, req) => {
    if (!resource.write && !resource.post) return json({ message: "Not supported." }, 405);
    // A browser sends Origin on cross-site posts; refuse any that is not this site, whatever the body says.
    const origin = req.headers.get("origin");
    if (origin && origin !== new URL(req.url).origin) return json({ outcome: "rejected", message: "That request came from another site." }, 403);
    if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return json({ outcome: "rejected", message: "That request is too large." }, 413);
    let body: unknown;
    try { body = await req.json(); } catch { return json({ outcome: "rejected", message: "Invalid request." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ outcome: "rejected", message: "Invalid request." }, 400);
    if (resource.post && method === "POST") { const result = await resource.post(db, owner, body as Row, req); return result instanceof Response ? result : json(result); }
    return applyWrite(db, owner, body as Row, method, resource.write!);
  });
  return {
    GET: guard(async (db, owner, req) => {
      const result = await resource.read(db, owner, new URL(req.url), req);
      return result instanceof Response ? result : json(result);
    }),
    POST: mutate("POST"),
    PATCH: mutate("PATCH"),
  };
}
