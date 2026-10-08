import type { AgentPlan } from "./types";

type D1 = D1Database;
export const CLARIFICATION_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export type Candidate = { id: string; label: string; version: number };
export type ClarificationRow = {
  id: string;
  owner_id: string;
  input_id: string;
  session_id: string | null;
  mode: string;
  original_text: string;
  question: string;
  candidates: string;
  proposed_plan: string;
  photo_name: string | null;
  photo_data: string | null;
  attempts: number;
  status: string;
  created_at: string;
  expires_at: string;
};

type ListRow = {
  id: string;
  session_id: string | null;
  mode: string;
  original_text: string;
  question: string;
  candidates: string;
  photo_name: string | null;
  has_photo: number;
  attempts: number;
  created_at: string;
  expires_at: string;
};
const now = () => new Date().toISOString();
const NOT_PENDING: Record<string, string> = {
  resolved: "That question was already answered.",
  cancelled: "You cancelled that question, so I didn’t change anything.",
  expired: "That question expired. Tell me the update again and I’ll re-check it.",
  stale: "Your records changed after I asked, so I didn’t apply that answer. Tell me the update again and I’ll re-check it.",
};

/** Cats the plan points at, as stored cats. These are the only cats an answer may resolve to. */
export function candidatesFor(
  plan: AgentPlan,
  cats: { id: string; version?: number }[],
  label: (c: { id: string; version?: number }) => string,
): Candidate[] {
  const ids = new Set<string>();
  for (const id of [
    ...plan.cats.map((c) => c.existingId),
    ...plan.events.map((e) => e.catRef),
    ...plan.transactions.map((t) => t.relatedCatRef),
  ])
    if (id) ids.add(id);
  return cats.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, label: label(c), version: Number(c.version ?? 0) }));
}

/** Every stored cat an answer's plan touches. */
export function referencedCats(plan: AgentPlan): string[] {
  const aliases = new Map(plan.cats.filter((c) => c.existingId).map((c) => [c.ref, c.existingId!]));
  const declared = new Set(plan.cats.filter((c) => !c.existingId).map((c) => c.ref));
  const ids = [
    ...plan.cats.map((c) => c.existingId),
    ...plan.events.map((e) => e.catRef),
    ...plan.transactions.map((t) => t.relatedCatRef),
  ];
  return [...new Set(ids.filter((r): r is string => !!r && !declared.has(r)).map((r) => aliases.get(r) || r))];
}

export function queueClarification(
  queued: D1,
  a: {
    id: string;
    owner: string;
    inputId: string;
    sessionId: string | null;
    mode: string;
    original: string;
    question: string;
    candidates: Candidate[];
    plan: AgentPlan;
    photoName: string | null;
    photo: string | null;
    createdAt: string;
  },
) {
  return queued
    .prepare(
      "INSERT INTO clarifications(id,owner_id,input_id,session_id,mode,original_text,question,candidates,proposed_plan,photo_name,photo_data,attempts,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,'pending',?,?,?)",
    )
    .bind(
      a.id,
      a.owner,
      a.inputId,
      a.sessionId,
      a.mode,
      a.original,
      a.question,
      JSON.stringify(a.candidates),
      JSON.stringify(a.plan),
      a.photoName,
      a.photo,
      a.createdAt,
      a.createdAt,
      new Date(Date.parse(a.createdAt) + CLARIFICATION_TTL_MS).toISOString(),
    )
    .run();
}

/** Housekeeping only: moves overdue pending questions to expired. Never touches rescue records. */
export async function expireOverdue(db: D1, owner: string) {
  const t = now();
  await db
    .prepare("UPDATE clarifications SET status='expired',decided_at=?,updated_at=? WHERE owner_id=? AND status='pending' AND expires_at<?")
    .bind(t, t, owner, t)
    .run();
}

export async function listPending(db: D1, owner: string) {
  await expireOverdue(db, owner);
  const rows = await db
    .prepare(
      "SELECT id,session_id,mode,original_text,question,candidates,photo_name,photo_data IS NOT NULL has_photo,attempts,created_at,expires_at FROM clarifications WHERE owner_id=? AND status='pending' ORDER BY created_at DESC",
    )
    .bind(owner)
    .all<ListRow>();
  return rows.results.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    mode: r.mode,
    originalText: r.original_text,
    question: r.question,
    candidates: (JSON.parse(r.candidates) as Candidate[]).map((c) => c.label),
    hasPhoto: !!r.has_photo,
    photoName: r.photo_name,
    attempts: r.attempts,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

export async function cancel(db: D1, owner: string, id: string) {
  const t = now();
  const done = await db
    .prepare("UPDATE clarifications SET status='cancelled',decided_at=?,updated_at=? WHERE id=? AND owner_id=? AND status='pending'")
    .bind(t, t, id, owner)
    .run();
  return (
    ((done as unknown as { meta?: { changes?: number }; changes?: number }).meta?.changes ??
      (done as unknown as { changes?: number }).changes ??
      0) > 0
  );
}

/**
 * Loads the one pending question an answer is addressed to. The answer is bound to this id and owner only;
 * it is never matched to a question by guessing.
 */
export async function loadForAnswer(
  db: D1,
  owner: string,
  id: string,
): Promise<{ row: ClarificationRow; candidates: Candidate[] } | { error: string; status: number; outcome: string }> {
  const row = await db.prepare("SELECT * FROM clarifications WHERE id=? AND owner_id=?").bind(id, owner).first<ClarificationRow>();
  if (!row) return { error: "I couldn’t find that question.", status: 404, outcome: "rejected" };
  if (row.status === "pending" && row.expires_at < now()) {
    await expireOverdue(db, owner);
    row.status = "expired";
  }
  if (row.status !== "pending") return { error: NOT_PENDING[row.status] || "That question is closed.", status: 409, outcome: "conflict" };
  const candidates = JSON.parse(row.candidates) as Candidate[];
  for (const c of candidates) {
    const cat = await db.prepare("SELECT version FROM cats WHERE id=? AND owner_id=?").bind(c.id, owner).first<{ version: number }>();
    if (!cat || Number(cat.version) !== c.version) {
      const t = now();
      await db
        .prepare("UPDATE clarifications SET status='stale',decided_at=?,updated_at=? WHERE id=? AND owner_id=? AND status='pending'")
        .bind(t, t, id, owner)
        .run();
      return { error: NOT_PENDING.stale, status: 409, outcome: "conflict" };
    }
  }
  return { row, candidates };
}

/** The interpreter sees the original update together with the question and answer, so Ari never repeats herself. */
export function answerPrompt(row: ClarificationRow, candidates: Candidate[], answer: string) {
  return `Ari earlier said: "${row.original_text}"\nYou asked her: "${row.question}"\nCandidate cats: ${candidates.length ? JSON.stringify(candidates.map((c) => ({ id: c.id, description: c.label }))) : "not narrowed down"}\nAri answered: "${answer}"\nApply her answer to her ORIGINAL update. If the answer still does not identify exactly one cat, return intent=clarify with a new question and no mutations.`;
}

export function queueStillAmbiguous(
  queued: D1,
  a: {
    clarificationId: string;
    owner: string;
    answerInputId: string;
    question: string;
    answer: string;
    newQuestion: string;
    createdAt: string;
    answerId: string;
  },
) {
  return [
    queued
      .prepare(
        "INSERT INTO clarification_answers(id,clarification_id,owner_id,input_id,question,answer,outcome,created_at) VALUES(?,?,?,?,?,?,'still_ambiguous',?)",
      )
      .bind(a.answerId, a.clarificationId, a.owner, a.answerInputId, a.question, a.answer, a.createdAt)
      .run(),
    queued
      .prepare("UPDATE clarifications SET question=?,attempts=attempts+1,updated_at=? WHERE id=? AND owner_id=? AND status='pending'")
      .bind(a.newQuestion, a.createdAt, a.clarificationId, a.owner)
      .run(),
  ];
}

/** Resolution is part of the same atomic batch as the records it produces; the unique row blocks a double answer. */
export function queueResolved(
  queued: D1,
  a: {
    clarificationId: string;
    owner: string;
    answerInputId: string;
    question: string;
    answer: string;
    createdAt: string;
    answerId: string;
  },
) {
  return [
    queued
      .prepare(
        "INSERT INTO clarification_answers(id,clarification_id,owner_id,input_id,question,answer,outcome,created_at) VALUES(?,?,?,?,?,?,'resolved',?)",
      )
      .bind(a.answerId, a.clarificationId, a.owner, a.answerInputId, a.question, a.answer, a.createdAt)
      .run(),
    queued
      .prepare("INSERT INTO clarification_resolutions(clarification_id,owner_id,resolved_at) VALUES(?,?,?)")
      .bind(a.clarificationId, a.owner, a.createdAt)
      .run(),
    queued
      .prepare("UPDATE clarifications SET status='resolved',decided_at=?,updated_at=? WHERE id=? AND owner_id=? AND status='pending'")
      .bind(a.createdAt, a.createdAt, a.clarificationId, a.owner)
      .run(),
  ];
}
