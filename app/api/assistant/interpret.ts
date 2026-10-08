import type { AiConfig } from "../../config";
import { monitoredAgent } from "./agent";
import { CAT_STATUS_SET } from "./cats";
import { answerPrompt, referencedCats } from "./clarifications";
import { checkCorrectionPlan } from "./corrections";
import { ambiguity, checkReferences, consequences, validateProviderPlan, type StoredCat } from "./validation";
import type { AgentPlan, D1, Snapshot } from "./types";
import type { Turn } from "./turn";

/** What a request means once the interpreter's answer (or a stored proposal) has been validated. */
export type Interpretation = {
  /** The validated answer exactly as the interpreter gave it; this is what the audit trail stores. */
  interpreted: AgentPlan;
  /** What will actually be done: the same, or a question if identity was uncertain. */
  plan: AgentPlan;
  /** Why Ari must approve first; empty when the change can be applied now. */
  reasons: string[];
  /** For a correction: the cats whose fields the correction would change, with their current values. */
  correctionCats: Map<string, Record<string, unknown>>;
};

/** The answer to a pending question must pick among the cats the question was about. */
function unmatchedAnswer(turn: Turn, interpreted: AgentPlan): string | null {
  if (!turn.clarification || !turn.candidates.length || interpreted.intent !== "record") return null;
  const picked = referencedCats(interpreted);
  if (picked.length && picked.every((id) => turn.candidates.some((c) => c.id === id))) return null;
  return `That doesn’t match the cats I asked about (${turn.candidates.map((c) => c.label).join("; ")}). Which one did you mean? I haven't changed anything yet.`;
}

const clarifying = (interpreted: AgentPlan, question: string): AgentPlan => ({
  ...interpreted,
  intent: "clarify",
  message: question,
  clarification: question,
  cats: [],
  events: [],
  people: [],
  transactions: [],
});

/**
 * Asks the interpreter (or re-reads a stored proposal), validates the answer, and decides whether it can be applied,
 * must be approved first, or needs a question. A stored proposal is re-validated exactly like fresh provider output;
 * it is never trusted because it was stored. Returns a Response when the request must stop here.
 */
export async function interpret(db: D1, ai: AiConfig, turn: Turn, data: Snapshot): Promise<Interpretation | Response> {
  const { owner, proposal, correction, clarification, original, parsed } = turn;
  const { body } = parsed;
  const agentInput = clarification ? answerPrompt(clarification, turn.candidates, body.input.trim()) : turn.source;
  const raw = proposal
    ? JSON.parse(proposal.plan)
    : await monitoredAgent(db, ai, owner, agentInput, turn.mode, data, turn.photo || undefined);
  const interpreted = validateProviderPlan(raw, { statuses: CAT_STATUS_SET, mode: clarification ? clarification.mode : body.mode });
  await checkReferences(db, owner, interpreted);

  // Identity is uncertain: ask, and change nothing.
  const unsure = (correction ? null : ambiguity(interpreted, data.cats as StoredCat[])) || unmatchedAnswer(turn, interpreted);
  const plan = unsure ? clarifying(interpreted, unsure) : interpreted;

  const replacements = correction?.recordType === "event" ? plan.events : plan.transactions;
  if (correction && (plan.intent !== "record" || !replacements.length)) {
    return Response.json(
      { outcome: "clarification", message: plan.message, clarification: plan.clarification || "Please describe the corrected activity." },
      { status: 409 },
    );
  }
  let correctionCats = new Map<string, Record<string, unknown>>();
  if (correction) {
    // The replacement must be a faithful one-for-one swap; keep the original date when the interpreter omits one.
    const checked = await checkCorrectionPlan(db, owner, correction.recordType, original!, plan);
    if ("error" in checked)
      return Response.json({ outcome: "clarification", message: checked.error, clarification: checked.error }, { status: checked.status });
    correctionCats = checked.cats;
    if (correction.recordType === "event") plan.events[0].occurredAt ||= original!.occurred_at ?? null;
    else plan.transactions[0].date ||= original!.date ?? null;
  }
  // Consequential changes are only proposed until Ari approves them.
  const reasons = proposal ? [] : consequences(plan, { correctionOf: correction?.recordType === "transaction" ? "transaction" : null });
  return { interpreted, plan, reasons, correctionCats };
}
