import { photoRefusal } from "../../ops/limits";
import { recordEvent } from "../../ops/log";
import { loadForAnswer, type Candidate, type ClarificationRow } from "./clarifications";
import { now } from "./ids";
import { digest, validatedPhoto } from "./reliability";
import { refuse } from "./responses";
import type { ParsedBody } from "./write-body";
import type { Correction, D1, EventOrTxnRow, ProposalRow } from "./types";

/**
 * Everything one write request is about, loaded and checked before the interpreter is asked anything.
 * A request is exactly one of: a fresh update, the approval of a stored proposal, the answer to one pending question,
 * or a correction of one earlier record (which may itself be the approval of a stored correction proposal).
 */
export type Turn = {
  owner: string;
  parsed: ParsedBody;
  proposal: ProposalRow | null;
  correction: Correction | null;
  clarification: ClarificationRow | null;
  candidates: Candidate[];
  /** The record being corrected, exactly as it is stored now. */
  original: EventOrTxnRow | null;
  photo: string | null;
  /** The words the interpreter works from: Ari's text, the stored original, or the correction request. */
  source: string;
  mode: string;
};

const conflict = (message: string) => Response.json({ outcome: "conflict", message }, { status: 409 });

async function loadProposal(db: D1, owner: string, id: string): Promise<ProposalRow | Response> {
  const proposal = await db.prepare("SELECT * FROM proposed_actions WHERE id=? AND owner_id=?").bind(id, owner).first<ProposalRow>();
  if (!proposal) return refuse("I couldn’t find that pending change.", 404);
  if (proposal.status !== "proposed") return refuse("That change was already handled.", 409, "conflict");
  if (proposal.expires_at < now()) return refuse("That change expired. Tell me again and I’ll re-check it.", 409, "conflict");
  return proposal;
}

function requestedCorrection(parsed: ParsedBody): Correction | Response {
  const { body } = parsed;
  if (
    !body.id ||
    typeof body.id !== "string" ||
    typeof body.correction !== "string" ||
    !body.correction.trim() ||
    (body.recordType !== "event" && body.recordType !== "transaction")
  ) {
    return Response.json({ message: "Correction details are required." }, { status: 400 });
  }
  return { recordType: body.recordType, id: body.id, version: body.version, reason: body.correction.trim() };
}

/** The record to correct must exist, still be current, and be the version Ari was looking at. */
async function loadOriginal(db: D1, owner: string, correction: Correction): Promise<EventOrTxnRow | Response> {
  const table = correction.recordType === "event" ? "events" : "transactions";
  const original = await db.prepare(`SELECT * FROM ${table} WHERE id=? AND owner_id=?`).bind(correction.id, owner).first<EventOrTxnRow>();
  if (!original) return Response.json({ message: "Activity record not found." }, { status: 404 });
  if (original.superseded_at) return conflict("This activity was already corrected. Refresh to correct the latest version.");
  if (correction.version !== original.version)
    return conflict("This activity changed. Refresh and review the latest version before correcting it.");
  return original;
}

/** The photo this request carries, after size/type checks and the daily photo allowance. */
async function requestPhoto(db: D1, owner: string, parsed: ParsedBody): Promise<string | null | Response> {
  let photo: string | null;
  try {
    photo = parsed.clarifyId ? null : validatedPhoto(parsed.body.photoDataUrl);
  } catch (e) {
    await recordEvent(db, { kind: "upload_rejected", owner, route: "/api/assistant", status: 400, detail: e });
    return Response.json({ outcome: "rejected", message: (e as Error).message }, { status: 400 });
  }
  if (photo && !parsed.clarifyId) {
    const refusal = await photoRefusal(db, owner);
    if (refusal) {
      await recordEvent(db, { kind: "limit_hit", owner, route: "/api/assistant", status: refusal.status, detail: refusal.detail });
      return Response.json({ outcome: "rejected", message: refusal.message }, { status: refusal.status });
    }
  }
  return photo;
}

/** An approval must be given with the very photo the proposal was made with. */
async function photoForProposal(db: D1, owner: string, proposal: ProposalRow, photo: string | null): Promise<string | null | Response> {
  let kept = photo;
  if (proposal.photo_digest && !kept) {
    // A photo that arrived with a clarified update is kept with that update, so Ari need not re-add it.
    const stored = await db
      .prepare("SELECT photo_data FROM clarifications WHERE input_id=? AND owner_id=? AND photo_data IS NOT NULL")
      .bind(proposal.input_id, owner)
      .first<{ photo_data: string }>();
    if (stored) kept = stored.photo_data;
  }
  if (proposal.photo_digest && (!kept || (await digest(kept)) !== proposal.photo_digest)) {
    return refuse("Add the same photo again to confirm this change.", 400);
  }
  return proposal.photo_digest ? kept : null;
}

export async function loadTurn(db: D1, owner: string, parsed: ParsedBody, patch: boolean): Promise<Turn | Response> {
  const { body, confirmId, clarifyId } = parsed;

  let proposal: ProposalRow | null = null;
  let correction: Correction | null = null;
  if (confirmId) {
    const loaded = await loadProposal(db, owner, confirmId);
    if (loaded instanceof Response) return loaded;
    proposal = loaded;
    if (proposal.kind === "correction") correction = JSON.parse(proposal.correction_target as string);
  } else if (patch) {
    const requested = requestedCorrection(parsed);
    if (requested instanceof Response) return requested;
    correction = requested;
  }

  // An answer is bound to exactly one pending question by its id; it is never matched by guessing.
  let clarification: ClarificationRow | null = null;
  let candidates: Candidate[] = [];
  if (clarifyId) {
    if (typeof body.input !== "string" || !body.input.trim() || body.input.length > 2000) return refuse("Tell me your answer first.", 400);
    const loaded = await loadForAnswer(db, owner, clarifyId);
    if ("error" in loaded) return refuse(loaded.error, loaded.status, loaded.outcome);
    clarification = loaded.row;
    candidates = loaded.candidates;
  }

  let original: EventOrTxnRow | null = null;
  if (correction) {
    const loaded = await loadOriginal(db, owner, correction);
    if (loaded instanceof Response) return loaded;
    original = loaded;
  } else if (!confirmId && !body.input?.trim() && !body.photoDataUrl) {
    return Response.json({ message: "Tell me what happened or add a photo first." }, { status: 400 });
  }

  let photo = await requestPhoto(db, owner, parsed);
  if (photo instanceof Response) return photo;
  // The photo belongs to the pending question, not to this request.
  if (clarification) photo = clarification.photo_data;
  if (proposal) {
    const checked = await photoForProposal(db, owner, proposal, photo);
    if (checked instanceof Response) return checked;
    photo = checked;
  }

  let storedWords: string | null = null;
  if (proposal) {
    const row = await db
      .prepare("SELECT transcription FROM ai_inputs WHERE id=? AND owner_id=?")
      .bind(proposal.input_id, owner)
      .first<{ transcription: string }>();
    if (!row) return refuse("The original words for this change are missing.", 409, "conflict");
    storedWords = row.transcription;
  }
  const source = correction
    ? `Correct this ${correction.recordType}. Original record: ${JSON.stringify(original)}. Complete corrected version from Ari: ${correction.reason}`
    : proposal
      ? storedWords!
      : clarification
        ? clarification.original_text
        : body.input?.trim() || `Photo added: ${body.photoName || "cat photo"}`;
  const mode = correction ? "correction" : clarification ? clarification.mode : body.mode || "text";
  return { owner, parsed, proposal, correction, clarification, candidates, original, photo, source, mode };
}
