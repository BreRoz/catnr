import type { AiConfig } from "../../config";
import { aiConfigured } from "../../config";
import { ownerFrom } from "../../identity";
import { recordEvent } from "../../ops/log";
import { interpret } from "./interpret";
import { queueWrites } from "./persist";
import { AiLimited, AiUnavailable, commit, receipt, revision } from "./reliability";
import { newRetryState, recoverOrFail } from "./retry";
import { rejectedPlan, unauthorized } from "./responses";
import { snapshot } from "./snapshot";
import { loadTurn } from "./turn";
import { PlanRejected } from "./validation";
import { parseBody, retryIdentity } from "./write-body";
import type { D1, RequestBody } from "./types";

export type WriteDeps = { db: D1; ai: AiConfig };

/**
 * POST (a new update, an answer, or the approval of a stored proposal) and PATCH (a correction).
 * Four separate states: question (read-only) → proposed action (stored, inert) → approved action (Ari confirms)
 * → executed action (one atomic batch).
 */
export async function handleWrite(req: Request, patch: boolean, { db, ai }: WriteDeps): Promise<Response> {
  const owner = ownerFrom(req);
  if (!owner) return unauthorized();
  const retry = newRetryState();
  try {
    const parsed = parseBody((await req.json()) as RequestBody, patch);
    if (parsed instanceof Response) return parsed;
    const identity = await retryIdentity(parsed, patch);
    if (identity instanceof Response) return identity;
    retry.key = identity.key;
    retry.hash = identity.hash;
    const saved = await receipt(db, owner, retry.key, retry.hash);
    if (saved) return saved;
    const base = await revision(db, owner);

    const turn = await loadTurn(db, owner, parsed, patch);
    if (turn instanceof Response) return turn;
    const data = await snapshot(db, owner);
    // Detect any changes made while collecting the interpreter's snapshot.
    if ((await revision(db, owner)) !== base) throw new Error("Concurrent edit");

    const interpretation = await interpret(db, ai, turn, data);
    if (interpretation instanceof Response) return interpretation;
    const queued = await queueWrites(db, aiConfigured(ai), turn, data, interpretation);
    retry.commitAttempted = true;
    await commit(db, owner, retry.key, retry.hash, base, queued.statements, queued.response);
    return Response.json(queued.response);
  } catch (error) {
    if (error instanceof PlanRejected) {
      await recordEvent(db, { kind: "ai_invalid", owner, route: "/api/assistant", detail: "plan rejected by validation" });
      return rejectedPlan();
    }
    if (!(error instanceof AiUnavailable || error instanceof AiLimited) && !String(error).includes("Concurrent edit")) {
      await recordEvent(db, { kind: "db_error", owner, route: "/api/assistant", detail: error });
    }
    return recoverOrFail(db, owner, retry, error);
  }
}
