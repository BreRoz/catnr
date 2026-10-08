import { ownerFrom } from "../../identity";
import { cancel as cancelClarification } from "./clarifications";
import { checkUndo, queueUndo } from "./corrections";
import { now } from "./ids";
import { commit, digest, pendingWrites, receipt, revision } from "./reliability";
import { newRetryState, recoverOrFail } from "./retry";
import { unauthorized } from "./responses";
import type { D1, RequestBody } from "./types";

// DELETE /api/assistant. Nothing here deletes rescue records: it dismisses a proposal, drops a question, or undoes a
// correction (which restores the original activity and the cat fields the correction changed).

const invalid = () => Response.json({ message: "Invalid request." }, { status: 400 });
const conflict = (message: string) => Response.json({ outcome: "conflict", message }, { status: 409 });

/** Dismissing a proposal changes no rescue records; it only closes the pending change. */
async function dismissProposal(db: D1, owner: string, proposalId: unknown): Promise<Response> {
  if (typeof proposalId !== "string") return invalid();
  const closed = await db
    .prepare("UPDATE proposed_actions SET status='rejected',decided_at=?,decided_by=? WHERE id=? AND owner_id=? AND status='proposed'")
    .bind(now(), owner, proposalId, owner)
    .run();
  return closed.meta.changes === 0
    ? conflict("That change was already handled.")
    : Response.json({ outcome: "dismissed", message: "Okay, I didn’t make that change." });
}

/** Cancelling closes the question only; the original words stay in the audit trail and nothing else changes. */
async function dropQuestion(db: D1, owner: string, clarificationId: unknown): Promise<Response> {
  if (typeof clarificationId !== "string") return invalid();
  return (await cancelClarification(db, owner, clarificationId))
    ? Response.json({ outcome: "cancelled", message: "Okay, I dropped that question and didn’t change anything." })
    : conflict("That question was already closed.");
}

async function undoCorrection(db: D1, owner: string, body: RequestBody): Promise<Response> {
  const retry = newRetryState();
  try {
    if (typeof body.correctionId !== "string" || !body.correctionId)
      return Response.json({ message: "Choose a correction to undo." }, { status: 400 });
    retry.hash = await digest(JSON.stringify({ method: "DELETE", correctionId: body.correctionId }));
    retry.key = body.requestKey || retry.hash;
    if (typeof retry.key !== "string" || retry.key.length > 200) return Response.json({ message: "Invalid retry key." }, { status: 400 });
    const saved = await receipt(db, owner, retry.key, retry.hash);
    if (saved) return saved;
    const base = await revision(db, owner);
    const checked = await checkUndo(db, owner, body.correctionId);
    if ("error" in checked) return Response.json({ outcome: "rejected", message: checked.error }, { status: checked.status });
    if ((await revision(db, owner)) !== base) throw new Error("Concurrent edit");
    const pending = pendingWrites(db);
    const undone = await queueUndo(db, pending.db, owner, checked, now());
    const response = {
      outcome: "undone",
      correctionId: undone.undoId,
      revertedCorrectionId: body.correctionId,
      message: "Correction undone. The original activity is back.",
    };
    retry.commitAttempted = true;
    await commit(db, owner, retry.key, retry.hash, base, pending.statements, response);
    return Response.json(response);
  } catch (error) {
    return recoverOrFail(db, owner, retry, error);
  }
}

export async function handleDelete(req: Request, db: D1): Promise<Response> {
  const owner = ownerFrom(req);
  if (!owner) return unauthorized();
  try {
    const body = (await req.json()) as RequestBody;
    if (body?.rejectProposalId != null) return await dismissProposal(db, owner, body.rejectProposalId);
    if (body?.cancelClarificationId != null) return await dropQuestion(db, owner, body.cancelClarificationId);
    return await undoCorrection(db, owner, body);
  } catch (error) {
    return recoverOrFail(db, owner, newRetryState(), error);
  }
}
