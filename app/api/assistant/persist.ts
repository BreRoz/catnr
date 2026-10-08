import { answer } from "./answer";
import { display } from "./cats";
import { candidatesFor, queueClarification, queueResolved, queueStillAmbiguous } from "./clarifications";
import { queueCorrection } from "./corrections";
import { makeId, now } from "./ids";
import { execute, type Written } from "./record-writer";
import { digest, pendingWrites } from "./reliability";
import type { Interpretation } from "./interpret";
import type { Turn } from "./turn";
import type { D1, Snapshot } from "./types";

const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

/** The batched writes for one request, and the answer to send once they have committed. */
export type Queued = { response: Record<string, unknown>; statements: D1PreparedStatement[] };

type Parts = {
  db: D1;
  queued: D1;
  turn: Turn;
  plan: Interpretation["plan"];
  interpreted: Interpretation["interpreted"];
  inputId: string;
  createdAt: string;
};

/** A consequential change is stored, inert, until Ari approves it (it expires after a day). */
async function queueProposal(p: Parts, reasons: string[]): Promise<string> {
  const { turn, plan, queued, inputId, createdAt } = p;
  const id = makeId("proposal");
  await queued
    .prepare(
      "INSERT INTO proposed_actions(id,owner_id,input_id,kind,plan,reasons,correction_target,photo_digest,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      turn.owner,
      inputId,
      turn.correction ? "correction" : "record",
      JSON.stringify(plan),
      JSON.stringify(reasons),
      turn.correction ? JSON.stringify(turn.correction) : null,
      turn.photo ? await digest(turn.photo) : null,
      createdAt,
      new Date(Date.parse(createdAt) + PROPOSAL_TTL_MS).toISOString(),
    )
    .run();
  return id;
}

/** Keeps the photo with the cat or event it was sent about. */
async function queuePhoto(p: Parts, result: Written): Promise<void> {
  const { turn, plan, queued, createdAt } = p;
  const event = result.created.find((x) => x.startsWith("event:"))?.slice(6) || null;
  const created = result.created.find((x) => x.startsWith("cat:")) || result.updated.find((x) => x.startsWith("cat:"));
  const correctedCat =
    turn.correction && event && plan.events[0].catRef
      ? plan.cats.find((c) => c.ref === plan.events[0].catRef)?.existingId || plan.events[0].catRef
      : null;
  const cat = created?.slice(4) || correctedCat || null;
  if (!cat && !event) throw new Error("Photo has no record association");
  const id = makeId("photo");
  await queued
    .prepare("INSERT INTO photos(id,owner_id,cat_id,event_id,storage_location,taken_at,caption) VALUES(?,?,?,?,?,?,?)")
    .bind(id, turn.owner, cat, event, turn.photo, createdAt, turn.source)
    .run();
  result.created.push(`photo:${id}`);
}

/** Nothing is deleted: the original is superseded, linked to its replacement and kept in the audit trail. */
async function queueCorrectionWrites(p: Parts, result: Written, correctionCats: Interpretation["correctionCats"]): Promise<string> {
  const { db, queued, turn, plan, inputId, createdAt } = p;
  const correction = turn.correction!;
  const replacementId = result.created.find((x) => x.startsWith(`${correction.recordType}:`))!.slice(correction.recordType.length + 1);
  const queuedCorrection = await queueCorrection(db, queued, {
    owner: turn.owner,
    recordType: correction.recordType,
    original: turn.original!,
    plan,
    inputId,
    replacementId,
    reason: correction.reason,
    cats: correctionCats,
    now: createdAt,
  });
  result.updated.push(`superseded:${correction.recordType}:${correction.id}`, `correction:${queuedCorrection.correctionId}`);
  return queuedCorrection.correctionId;
}

/** Links an answered question to the answer, or keeps it open if the answer was still ambiguous. */
async function queueAnswerLinks(p: Parts, answerInputId: string): Promise<void> {
  const { queued, turn, plan, createdAt } = p;
  const clarification = turn.clarification!;
  const answer = turn.parsed.body.input.trim();
  const link = {
    clarificationId: clarification.id,
    owner: turn.owner,
    answerInputId,
    question: clarification.question,
    answer,
    createdAt,
    answerId: makeId("answer"),
  };
  const statements =
    plan.intent === "clarify"
      ? queueStillAmbiguous(queued, { ...link, newQuestion: plan.clarification || plan.message })
      : queueResolved(queued, link);
  for (const q of statements) await q;
}

/**
 * Builds every write for this request without running any of them: the audit record of what Ari said and what the
 * interpreter understood, the records themselves (or a stored proposal, or a pending question), photo, correction
 * links, and proposal bookkeeping. They commit together or not at all (see reliability.commit).
 */
export async function queueWrites(db: D1, hasAi: boolean, turn: Turn, data: Snapshot, interp: Interpretation): Promise<Queued> {
  const { owner, proposal, correction, clarification, parsed } = turn;
  const { body } = parsed;
  const { interpreted, plan, reasons } = interp;
  const proposing = reasons.length > 0;
  const executing = !proposing && plan.intent === "record";
  const inputId = proposal ? proposal.input_id : clarification ? clarification.input_id : makeId("input");
  const createdAt = now();
  const pending = pendingWrites(db);
  const queued = pending.db;
  const parts: Parts = { db, queued, turn, plan, interpreted, inputId, createdAt };

  if (!proposal && !clarification) {
    await queued
      .prepare(
        "INSERT INTO ai_inputs(id,owner_id,transcription,input_type,interpretation,confidence,correction,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        inputId,
        owner,
        correction ? correction.reason : turn.source,
        turn.mode,
        JSON.stringify(interpreted),
        interpreted.confidence,
        turn.original ? JSON.stringify(turn.original) : null,
        createdAt,
      )
      .run();
  }
  let result: Written = { created: [], updated: [], message: plan.message, clarification: plan.clarification };
  const answerInputId = clarification ? makeId("input") : null;
  if (clarification) {
    await queued
      .prepare("INSERT INTO ai_inputs(id,owner_id,transcription,input_type,interpretation,confidence,created_at) VALUES(?,?,?,?,?,?,?)")
      .bind(answerInputId, owner, body.input.trim(), "clarification_answer", JSON.stringify(interpreted), interpreted.confidence, createdAt)
      .run();
  }

  let proposalId: string | undefined;
  let clarificationId: string | undefined;
  if (proposing) {
    proposalId = await queueProposal(parts, reasons);
    result.message = `${plan.message} I haven’t saved anything yet — this needs your OK: ${reasons.join("; ")}.`;
  } else if (plan.intent === "query") {
    result.message = await answer(db, owner, plan.query);
  } else if (executing) {
    result = await execute(queued, owner, inputId, turn.source, plan);
  } else if (plan.intent === "social") {
    result.message = plan.socialDraft || plan.message;
  }
  if (plan.intent === "clarify" && !correction && !proposal && !clarification && hasAi) {
    // Keep everything needed to finish this update once Ari answers.
    clarificationId = makeId("clarify");
    await queueClarification(queued, {
      id: clarificationId,
      owner,
      inputId,
      sessionId: parsed.sessionId,
      mode: turn.mode,
      original: turn.source,
      question: plan.clarification || plan.message,
      candidates: candidatesFor(interpreted, data.cats, display),
      plan: interpreted,
      photoName: body.photoName || null,
      photo: turn.photo,
      createdAt,
    });
  }
  if (clarification) await queueAnswerLinks(parts, answerInputId!);

  let photoSaved = false;
  if (turn.photo && executing) {
    await queuePhoto(parts, result);
    photoSaved = true;
  }
  let correctionId: string | undefined;
  if (correction && executing) correctionId = await queueCorrectionWrites(parts, result, interp.correctionCats);
  if (proposal) {
    // The unique execution row makes a second approval of the same proposal fail the whole batch.
    await queued
      .prepare("INSERT INTO proposal_executions(proposal_id,owner_id,executed_at) VALUES(?,?,?)")
      .bind(proposal.id, owner, createdAt)
      .run();
    await queued
      .prepare("UPDATE proposed_actions SET status='executed',decided_at=?,decided_by=? WHERE id=? AND owner_id=?")
      .bind(createdAt, owner, proposal.id, owner)
      .run();
  }
  await queued
    .prepare("UPDATE ai_inputs SET clarification=?,records_created=?,records_updated=? WHERE id=? AND owner_id=?")
    .bind(result.clarification, JSON.stringify(result.created), JSON.stringify(result.updated), inputId, owner)
    .run();

  const response = {
    ...result,
    correctionId,
    photoSaved,
    proposalId,
    clarificationId: clarificationId || (clarification && plan.intent === "clarify" ? clarification.id : undefined),
    answeredClarification: clarification && plan.intent !== "clarify" ? clarification.id : undefined,
    reasons: proposing ? reasons : undefined,
    confirmed: proposal ? true : undefined,
    outcome: proposing
      ? "needs_confirmation"
      : plan.intent === "record"
        ? "committed"
        : plan.intent === "clarify"
          ? "clarification"
          : "answered",
  };
  return { response, statements: pending.statements };
}
