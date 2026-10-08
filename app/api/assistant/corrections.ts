import type { AgentPlan } from "./types";

// Versioned corrections: a correction never deletes the activity it replaces. The original is marked
// superseded, linked to its replacement in `corrections`, and can be reconstructed or restored.
type D1 = D1Database;
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- D1 rows are untyped
type RecordType = "event" | "transaction";
export type CatChange = { catId: string; changes: Array<{ field: string; from: unknown; to: unknown }> };
type Failure = { error: string; status: number };

const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const tableFor = (type: RecordType) => (type === "event" ? "events" : "transactions");

// Plan field -> cats column. Only these fields can be changed (and later restored) by a correction.
const CAT_COLUMNS: Record<string, string> = {
  name: "name",
  sex: "sex",
  ageClass: "age_class",
  appearance: "appearance",
  distinguishingCharacteristics: "distinguishing_characteristics",
  healthObservations: "health_observations",
  reproductiveSignificance: "reproductive_significance",
  currentStatus: "current_status",
  currentLocation: "current_location",
  microchipNumber: "microchip_number",
};
const RESTORABLE_COLUMNS = new Set(Object.values(CAT_COLUMNS));

const STATUS_BY_EVENT: Record<string, string> = {
  captured: "captured",
  capture: "captured",
  foster: "foster",
  adoption: "adopted",
  adopted: "adopted",
  returned_to_colony: "returned to colony",
  lost: "lost",
  deceased: "deceased",
};
export const impliedStatus = (eventType: string) => STATUS_BY_EVENT[eventType.trim().toLowerCase().replaceAll(" ", "_")] ?? null;

type StatusEvent = { id: string; cat_id: string | null; event_type: string; occurred_at: string; created_at: string };
// The status the cat should have given its active history: the latest status-implying event.
export function derivedStatus(events: StatusEvent[], catId: string): string | null {
  const latest = events
    .filter((e) => e.cat_id === catId && impliedStatus(e.event_type))
    .sort((a, b) => `${a.occurred_at}|${a.created_at}`.localeCompare(`${b.occurred_at}|${b.created_at}`))
    .pop();
  return latest ? impliedStatus(latest.event_type) : null;
}

// When an event is replaced, move the cat's status only if the status came from event history
// (i.e. nothing newer or manual has set it); otherwise leave it untouched.
export function statusRepair(catRow: Row, before: StatusEvent[], after: StatusEvent[]): string | null {
  const wasDerived = derivedStatus(before, catRow.id);
  const unchangedByHand = catRow.current_status === wasDerived || (wasDerived === null && catRow.current_status === "observed");
  if (!unchangedByHand) return null;
  const target = derivedStatus(after, catRow.id) ?? (wasDerived ? "observed" : null);
  return target && target !== catRow.current_status ? target : null;
}

function diffCat(before: Row, draft: Row): CatChange["changes"] {
  const changes: CatChange["changes"] = [];
  for (const [key, column] of Object.entries(CAT_COLUMNS)) {
    const value = draft[key];
    if (value != null && value !== before[column]) changes.push({ field: column, from: before[column] ?? null, to: value });
  }
  return changes;
}

async function loadCats(db: D1, owner: string, ids: string[]) {
  const cats = new Map<string, Row>();
  if (!ids.length) return cats;
  const found = await db
    .prepare(
      `SELECT c.*,co.name origin FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.owner_id=? AND c.id IN (${ids.map(() => "?").join(",")})`,
    )
    .bind(owner, ...ids)
    .all<Row>();
  for (const row of found.results) cats.set(row.id, row);
  return cats;
}

// Validate that the interpreted replacement is a faithful one-for-one swap before anything is applied.
export async function checkCorrectionPlan(
  db: D1,
  owner: string,
  recordType: RecordType,
  original: Row,
  plan: AgentPlan,
): Promise<Failure | { cats: Map<string, Row> }> {
  const reject = (error: string): Failure => ({ error, status: 409 });
  const replacements = recordType === "event" ? plan.events : plan.transactions;
  const extras = recordType === "event" ? plan.transactions : plan.events;
  if (plan.intent !== "record" || replacements.length !== 1)
    return reject(plan.clarification || "Please describe the complete corrected activity.");
  if (extras.length) return reject("A correction replaces only the activity you chose. Record other changes as separate updates.");
  const aliases = new Map<string, string>();
  for (const cat of plan.cats) {
    if (!cat.existingId) return reject("A correction can’t add a new cat. Record a new cat as a separate update.");
    aliases.set(cat.ref, cat.existingId);
  }
  const resolve = (ref: string | null) => (ref ? aliases.get(ref) || ref : null);
  const allowed = new Set<string>();
  if (recordType === "event") {
    const replacementCat = resolve(plan.events[0].catRef);
    if (original.cat_id && !replacementCat)
      return reject("This activity belongs to a cat. Tell me which cat the corrected activity is for.");
    if (replacementCat) allowed.add(replacementCat);
    if (original.cat_id) allowed.add(original.cat_id);
  } else if (plan.cats.length) return reject("Correcting money or supplies can’t change cat records.");
  if (plan.cats.some((c) => !allowed.has(c.existingId!))) return reject("A correction can only update the cat tied to this activity.");
  const cats = await loadCats(db, owner, [...allowed]);
  for (const cat of plan.cats) {
    const row = cats.get(cat.existingId!);
    if (!row) return reject("I couldn’t find that cat.");
    if (cat.origin && cat.origin.toLowerCase() !== String(row.origin || "").toLowerCase())
      return reject("Changing a cat’s colony isn’t part of correcting an activity.");
  }
  if (recordType === "event") {
    const replacementCat = resolve(plan.events[0].catRef);
    if (replacementCat && !cats.has(replacementCat)) return reject("I couldn’t find that cat.");
  }
  return { cats };
}

export type CorrectionRequest = {
  owner: string;
  recordType: RecordType;
  original: Row;
  plan: AgentPlan;
  inputId: string;
  replacementId: string;
  reason: string;
  cats: Map<string, Row>;
  now: string;
};

// Queue (never execute directly) everything that makes a replacement a correction.
export async function queueCorrection(db: D1, q: D1, p: CorrectionRequest) {
  const { owner, original, plan, now } = p,
    table = tableFor(p.recordType),
    correctionId = makeId("correction");
  const catChanges = new Map<string, CatChange>();
  const addChange = (catId: string, change: CatChange["changes"][number]) => {
    const entry = catChanges.get(catId) || { catId, changes: [] };
    entry.changes.push(change);
    catChanges.set(catId, entry);
  };
  const explicitStatus = new Set<string>();
  for (const draft of plan.cats) {
    const before = p.cats.get(draft.existingId!)!;
    if (draft.currentStatus) explicitStatus.add(before.id);
    for (const change of diffCat(before, draft)) addChange(before.id, change);
  }

  const relinked = { photos: [] as string[], transactions: [] as string[] };
  if (p.recordType === "event") {
    const aliases = new Map(plan.cats.map((c) => [c.ref, c.existingId!]));
    const draft = plan.events[0],
      replacementCat = draft.catRef ? aliases.get(draft.catRef) || draft.catRef : null;
    const catIds = [...new Set([original.cat_id, replacementCat].filter(Boolean))] as string[];
    if (catIds.length) {
      const active = (
        await db
          .prepare(
            `SELECT id,cat_id,event_type,occurred_at,created_at FROM active_events WHERE owner_id=? AND cat_id IN (${catIds.map(() => "?").join(",")})`,
          )
          .bind(owner, ...catIds)
          .all<StatusEvent>()
      ).results;
      const replacement: StatusEvent = {
        id: p.replacementId,
        cat_id: replacementCat,
        event_type: draft.eventType,
        occurred_at: draft.occurredAt || original.occurred_at,
        created_at: now,
      };
      const after = [...active.filter((e) => e.id !== original.id), replacement];
      const cats = await loadCats(db, owner, catIds);
      for (const catId of catIds) {
        if (explicitStatus.has(catId)) continue;
        const current = cats.get(catId)!;
        const next = statusRepair(current, active, after);
        if (!next) continue;
        await q.prepare("UPDATE cats SET current_status=?,updated_at=? WHERE id=? AND owner_id=?").bind(next, now, catId, owner).run();
        addChange(catId, { field: "current_status", from: current.current_status, to: next });
      }
    }
    relinked.photos = (
      await db.prepare("SELECT id FROM photos WHERE event_id=? AND owner_id=?").bind(original.id, owner).all<Row>()
    ).results.map((r) => r.id);
    relinked.transactions = (
      await db.prepare("SELECT id FROM transactions WHERE related_event_id=? AND owner_id=?").bind(original.id, owner).all<Row>()
    ).results.map((r) => r.id);
    await q.prepare("UPDATE photos SET event_id=? WHERE event_id=? AND owner_id=?").bind(p.replacementId, original.id, owner).run();
    await q
      .prepare("UPDATE transactions SET related_event_id=? WHERE related_event_id=? AND owner_id=?")
      .bind(p.replacementId, original.id, owner)
      .run();
  }

  await q
    .prepare(`UPDATE ${table} SET superseded_at=?,superseded_by=? WHERE id=? AND owner_id=? AND superseded_at IS NULL`)
    .bind(now, correctionId, original.id, owner)
    .run();
  await q
    .prepare(
      "INSERT INTO corrections(id,owner_id,kind,record_type,original_id,replacement_id,reverts_id,status,made_by,actor_id,reason,source_input_id,original_snapshot,replacement_snapshot,cat_changes,relinked,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      correctionId,
      owner,
      "correction",
      p.recordType,
      original.id,
      p.replacementId,
      null,
      "applied",
      "assistant",
      owner,
      p.reason,
      p.inputId,
      JSON.stringify(original),
      null,
      JSON.stringify([...catChanges.values()]),
      JSON.stringify(relinked),
      now,
    )
    .run();
  return { correctionId, catChanges: [...catChanges.values()], relinked };
}

// An undo is only allowed while it cannot contradict anything recorded since.
export async function checkUndo(
  db: D1,
  owner: string,
  correctionId: string,
): Promise<Failure | { correction: Row; original: Row; replacement: Row }> {
  const correction = await db.prepare("SELECT * FROM corrections WHERE id=? AND owner_id=?").bind(correctionId, owner).first<Row>();
  if (!correction) return { error: "Correction not found.", status: 404 };
  if (correction.kind !== "correction") return { error: "Only a correction can be undone.", status: 409 };
  if (correction.status !== "applied") return { error: "This correction was already undone.", status: 409 };
  const table = tableFor(correction.record_type);
  const [original, replacement] = await Promise.all(
    [correction.original_id, correction.replacement_id].map((id) =>
      db.prepare(`SELECT * FROM ${table} WHERE id=? AND owner_id=?`).bind(id, owner).first<Row>(),
    ),
  );
  if (!original || !replacement) return { error: "The corrected records are missing, so this can’t be undone safely.", status: 409 };
  if (replacement.superseded_at || original.superseded_by !== correction.id)
    return { error: "This activity was corrected again afterward. Undo the newer correction first.", status: 409 };
  for (const entry of JSON.parse(correction.cat_changes) as CatChange[]) {
    const cat = await db.prepare("SELECT * FROM cats WHERE id=? AND owner_id=?").bind(entry.catId, owner).first<Row>();
    if (!cat) return { error: "A cat tied to this correction is missing, so it can’t be undone safely.", status: 409 };
    const moved = entry.changes.filter((c) => (cat[c.field] ?? null) !== (c.to ?? null));
    if (moved.length)
      return {
        error: `${cat.name || "A cat"}’s record changed after this correction (${moved.map((c) => c.field.replaceAll("_", " ")).join(", ")}). Undoing now would leave the records inconsistent, so nothing was changed.`,
        status: 409,
      };
  }
  return { correction, original, replacement };
}

export async function queueUndo(db: D1, q: D1, owner: string, checked: { correction: Row; original: Row; replacement: Row }, now: string) {
  const { correction, original, replacement } = checked,
    table = tableFor(correction.record_type),
    undoId = makeId("correction");
  const inverse: CatChange[] = [];
  for (const entry of JSON.parse(correction.cat_changes) as CatChange[]) {
    const fields = entry.changes.filter((c) => RESTORABLE_COLUMNS.has(c.field));
    if (!fields.length) continue;
    await q
      .prepare(`UPDATE cats SET ${fields.map((c) => `${c.field}=?`).join(",")},updated_at=? WHERE id=? AND owner_id=?`)
      .bind(...fields.map((c) => c.from as string | null), now, entry.catId, owner)
      .run();
    inverse.push({ catId: entry.catId, changes: fields.map((c) => ({ field: c.field, from: c.to, to: c.from })) });
  }
  // Attachments and linked money follow the activity back, then the replacement is retired (not deleted).
  const relinked = { photos: [] as string[], transactions: [] as string[] };
  if (correction.record_type === "event") {
    relinked.photos = (
      await db.prepare("SELECT id FROM photos WHERE event_id=? AND owner_id=?").bind(replacement.id, owner).all<Row>()
    ).results.map((r) => r.id);
    relinked.transactions = (
      await db.prepare("SELECT id FROM transactions WHERE related_event_id=? AND owner_id=?").bind(replacement.id, owner).all<Row>()
    ).results.map((r) => r.id);
    await q.prepare("UPDATE photos SET event_id=? WHERE event_id=? AND owner_id=?").bind(original.id, replacement.id, owner).run();
    await q
      .prepare("UPDATE transactions SET related_event_id=? WHERE related_event_id=? AND owner_id=?")
      .bind(original.id, replacement.id, owner)
      .run();
  }
  await q
    .prepare(`UPDATE ${table} SET superseded_at=?,superseded_by=? WHERE id=? AND owner_id=? AND superseded_at IS NULL`)
    .bind(now, undoId, replacement.id, owner)
    .run();
  await q
    .prepare(`UPDATE ${table} SET superseded_at=NULL,superseded_by=NULL WHERE id=? AND owner_id=? AND superseded_by=?`)
    .bind(original.id, owner, correction.id)
    .run();
  await q
    .prepare(
      "INSERT INTO corrections(id,owner_id,kind,record_type,original_id,replacement_id,reverts_id,status,made_by,actor_id,reason,source_input_id,original_snapshot,replacement_snapshot,cat_changes,relinked,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      undoId,
      owner,
      "undo",
      correction.record_type,
      original.id,
      replacement.id,
      correction.id,
      "applied",
      "user",
      owner,
      "Undo requested by user",
      null,
      JSON.stringify(original),
      JSON.stringify(replacement),
      JSON.stringify(inverse),
      JSON.stringify(relinked),
      now,
    )
    .run();
  await q
    .prepare("UPDATE corrections SET status='undone',undone_at=?,undone_by=? WHERE id=? AND owner_id=? AND status='applied'")
    .bind(now, undoId, correction.id, owner)
    .run();
  return { undoId, catChanges: inverse, relinked };
}

const parse = (value: string | null, fallback: unknown) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};
// Audit history for the owner; with recordId, only the connected chain of corrections for that activity.
export async function listCorrections(db: D1, owner: string, recordId?: string | null) {
  let rows = (await db.prepare("SELECT * FROM corrections WHERE owner_id=? ORDER BY created_at,rowid LIMIT 500").bind(owner).all<Row>())
    .results;
  if (recordId) {
    const ids = new Set([recordId]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const r of rows)
        if ((ids.has(r.original_id) || ids.has(r.replacement_id)) && !(ids.has(r.original_id) && ids.has(r.replacement_id))) {
          ids.add(r.original_id);
          ids.add(r.replacement_id);
          grew = true;
        }
    }
    rows = rows.filter((r) => ids.has(r.original_id) || ids.has(r.replacement_id));
  }
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    recordType: r.record_type,
    status: r.status,
    madeBy: r.made_by,
    actorId: r.actor_id,
    reason: r.reason,
    originalId: r.original_id,
    replacementId: r.replacement_id,
    revertsId: r.reverts_id,
    sourceInputId: r.source_input_id,
    original: parse(r.original_snapshot, null),
    replacement: parse(r.replacement_snapshot, null),
    catChanges: parse(r.cat_changes, []),
    relinked: parse(r.relinked, {}),
    createdAt: r.created_at,
    undoneAt: r.undone_at,
    undoneBy: r.undone_by,
  }));
}
