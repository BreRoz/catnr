import { ManageError, makeId, type Ctx, type Row } from "./common";

// Events and transactions are never edited in place. An edit inserts a replacement row, marks the
// original superseded and records a `corrections` row (the same mechanism the assistant's corrections
// use), so the full chain can be shown and undone. Voiding hides a record from histories and totals
// without replacing it, and can be reversed.
type Kind = "event" | "transaction";
const table = (kind: Kind) => (kind === "event" ? "events" : "transactions");

const EVENT_COLUMNS = ["cat_id", "event_type", "occurred_at", "location", "person_id", "notes"];
const TRANSACTION_COLUMNS = ["transaction_type", "direction", "date", "amount_minor", "currency", "person_id", "category", "description", "item", "quantity", "unit", "estimated_value_minor", "related_cat_id", "related_event_id", "related_colony_id"];

export async function replaceRecord(ctx: Ctx, kind: Kind, original: Row, replacementId: string, edit: { columns: Row; reason: string }) {
  const names = kind === "event" ? EVENT_COLUMNS : TRANSACTION_COLUMNS;
  const values = names.map((n) => edit.columns[n] ?? (n in edit.columns ? null : original[n] ?? null));
  const correctionId = makeId("correction"), statements: D1PreparedStatement[] = [];
  const replacement = { id: replacementId, version: 0, ...Object.fromEntries(names.map((n, i) => [n, values[i]])), created_at: ctx.now };
  statements.push(ctx.stmt(`INSERT INTO ${table(kind)}(id,owner_id,${names.join(",")},created_at,updated_at) VALUES(?,?,${names.map(() => "?").join(",")},?,?)`, replacementId, ctx.owner, ...values, ctx.now, ctx.now));
  const relinked = { photos: [] as string[], transactions: [] as string[] };
  if (kind === "event") {
    const [photos, transactions] = await Promise.all([
      ctx.db.prepare("SELECT id FROM photos WHERE event_id=? AND owner_id=?").bind(original.id, ctx.owner).all<Row>(),
      ctx.db.prepare("SELECT id FROM transactions WHERE related_event_id=? AND owner_id=?").bind(original.id, ctx.owner).all<Row>(),
    ]);
    relinked.photos = photos.results.map((r) => r.id);
    relinked.transactions = transactions.results.map((r) => r.id);
    statements.push(ctx.stmt("UPDATE photos SET event_id=? WHERE event_id=? AND owner_id=?", replacementId, original.id, ctx.owner));
    statements.push(ctx.stmt("UPDATE transactions SET related_event_id=? WHERE related_event_id=? AND owner_id=?", replacementId, original.id, ctx.owner));
  }
  statements.push(ctx.stmt(`UPDATE ${table(kind)} SET superseded_at=?,superseded_by=? WHERE id=? AND owner_id=? AND superseded_at IS NULL`, ctx.now, correctionId, original.id, ctx.owner));
  statements.push(ctx.stmt("INSERT INTO corrections(id,owner_id,kind,record_type,original_id,replacement_id,reverts_id,status,made_by,actor_id,reason,source_input_id,original_snapshot,replacement_snapshot,cat_changes,relinked,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    correctionId, ctx.owner, "correction", kind, original.id, replacementId, null, "applied", "user", ctx.owner, edit.reason, null, JSON.stringify(original), null, "[]", JSON.stringify(relinked), ctx.now));
  statements.push(ctx.audit({ recordType: kind, recordId: replacementId, action: "replace", reason: edit.reason, before: original, after: replacement }));
  return statements;
}

export function setVoided(ctx: Ctx, kind: Kind, row: Row, action: "void" | "unvoid", reason: string | null) {
  const t = table(kind);
  if (action === "void") {
    if (row.voided_at) throw new ManageError("This entry is already removed.", 409);
    return [
      ctx.stmt(`UPDATE ${t} SET voided_at=?,void_reason=? WHERE id=? AND owner_id=? AND superseded_at IS NULL AND voided_at IS NULL`, ctx.now, reason, row.id, ctx.owner),
      ctx.audit({ recordType: kind, recordId: row.id, action: "void", reason, before: row, after: { ...row, voided_at: ctx.now, void_reason: reason } }),
    ];
  }
  if (!row.voided_at) throw new ManageError("This entry isn’t removed.", 409);
  return [
    ctx.stmt(`UPDATE ${t} SET voided_at=NULL,void_reason=NULL WHERE id=? AND owner_id=? AND superseded_at IS NULL AND voided_at IS NOT NULL`, row.id, ctx.owner),
    ctx.audit({ recordType: kind, recordId: row.id, action: "unvoid", reason, before: row, after: { ...row, voided_at: null, void_reason: null } }),
  ];
}
