import { ManageError, all, checkVersion, makeId, oneOf, recordId, type Ctx, type D1, type Row, type Write } from "./common";
import { catBlockers, type RecordType } from "./duplicates";
import { displayName } from "./cats";

// Merging folds a duplicate into the record Ari keeps (the survivor). Nothing is deleted:
//  - every active link (events, photos, money, cats of a colony…) is re-pointed at the survivor;
//  - blank fields on the survivor are filled from the duplicate; different values are never overwritten
//    and are written into the merge record and the survivor's history instead;
//  - the duplicate is archived (not deleted) and `merges` + `record_changes` keep the whole story.
// Superseded events stay attached to the duplicate (they are frozen history); the survivor's history
// view includes everything that was merged into it.
type Spec = {
  table: string;
  label: (r: Row) => string;
  blank: (v: unknown) => boolean;
  fields: Array<[column: string, label: string]>;
  append: string[]; // text fields combined instead of conflicting
  links: Array<{ key: string; sql: string; select: string }>;
};

const isBlank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");
const SPECS: Record<RecordType, Spec> = {
  cat: {
    table: "cats",
    label: displayName,
    blank: (v) => isBlank(v) || v === "unknown",
    fields: [
      ["name", "name"],
      ["sex", "sex"],
      ["age_class", "age"],
      ["appearance", "appearance"],
      ["distinguishing_characteristics", "distinguishing characteristics"],
      ["health_observations", "health notes"],
      ["reproductive_significance", "reproductive notes"],
      ["origin_colony_id", "colony"],
      ["current_location", "location"],
      ["microchip_number", "microchip"],
    ],
    append: [],
    links: [
      {
        key: "events",
        select: "SELECT id FROM events WHERE owner_id=? AND cat_id=? AND superseded_at IS NULL",
        sql: "UPDATE events SET cat_id=? WHERE owner_id=? AND cat_id=? AND superseded_at IS NULL",
      },
      {
        key: "photos",
        select: "SELECT id FROM photos WHERE owner_id=? AND cat_id=?",
        sql: "UPDATE photos SET cat_id=? WHERE owner_id=? AND cat_id=?",
      },
      {
        key: "transactions",
        select: "SELECT id FROM transactions WHERE owner_id=? AND related_cat_id=?",
        sql: "UPDATE transactions SET related_cat_id=? WHERE owner_id=? AND related_cat_id=?",
      },
    ],
  },
  person: {
    table: "people",
    label: (r) => r.name,
    blank: isBlank,
    fields: [
      ["type", "type"],
      ["general_location", "location"],
      ["contact", "contact"],
    ],
    append: ["notes"],
    links: [
      {
        key: "events",
        select: "SELECT id FROM events WHERE owner_id=? AND person_id=? AND superseded_at IS NULL",
        sql: "UPDATE events SET person_id=? WHERE owner_id=? AND person_id=? AND superseded_at IS NULL",
      },
      {
        key: "transactions",
        select: "SELECT id FROM transactions WHERE owner_id=? AND person_id=?",
        sql: "UPDATE transactions SET person_id=? WHERE owner_id=? AND person_id=?",
      },
    ],
  },
  colony: {
    table: "colonies",
    label: (r) => r.name,
    blank: isBlank,
    fields: [
      ["general_location", "location"],
      ["latitude", "latitude"],
      ["longitude", "longitude"],
    ],
    append: ["notes"],
    links: [
      {
        key: "cats",
        select: "SELECT id FROM cats WHERE owner_id=? AND origin_colony_id=?",
        sql: "UPDATE cats SET origin_colony_id=? WHERE owner_id=? AND origin_colony_id=?",
      },
      {
        key: "transactions",
        select: "SELECT id FROM transactions WHERE owner_id=? AND related_colony_id=?",
        sql: "UPDATE transactions SET related_colony_id=? WHERE owner_id=? AND related_colony_id=?",
      },
    ],
  },
};

export type Analysis = {
  fills: Row;
  conflicts: Array<{ field: string; kept: unknown; other: unknown }>;
  blockers: string[];
  appended: Row;
};

/** What a merge would do to the fields; pure, so previews and the real merge can never disagree. */
export function analyze(type: RecordType, survivor: Row, duplicate: Row): Analysis {
  const spec = SPECS[type],
    out: Analysis = { fills: {}, conflicts: [], blockers: [], appended: {} };
  if (type === "cat") out.blockers.push(...catBlockers(survivor, duplicate));
  for (const [column, label] of spec.fields) {
    const s = survivor[column],
      d = duplicate[column];
    if (spec.blank(d)) continue;
    if (spec.blank(s)) out.fills[column] = d;
    else if (s !== d) out.conflicts.push({ field: label, kept: s, other: d });
  }
  if (type === "cat" && survivor.current_status === "observed" && duplicate.current_status !== "observed")
    out.fills.current_status = duplicate.current_status;
  else if (type === "cat" && survivor.current_status !== duplicate.current_status && duplicate.current_status !== "observed")
    out.conflicts.push({ field: "status", kept: survivor.current_status, other: duplicate.current_status });
  if (type === "colony" && survivor.status !== duplicate.status && survivor.status === "inactive" && duplicate.status === "active")
    out.fills.status = "active";
  if (type === "person" || type === "colony") {
    // Nothing the duplicate knew is lost: its name and notes are carried into the survivor's notes.
    const parts: string[] = [];
    if (normalizeLoose(duplicate.name) !== normalizeLoose(survivor.name)) parts.push(`Also recorded as “${duplicate.name}”.`);
    if (!isBlank(duplicate.notes) && duplicate.notes !== survivor.notes) parts.push(String(duplicate.notes).trim());
    if (parts.length)
      out.appended.notes = [
        isBlank(survivor.notes) ? null : String(survivor.notes).trim(),
        `Merged from “${duplicate.name}”: ${parts.join(" ")}`,
      ]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 2000);
  }
  return out;
}
const normalizeLoose = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

async function loadPair(db: D1, owner: string, type: RecordType, survivorId: string, mergedId: string) {
  if (survivorId === mergedId) throw new ManageError("Choose two different records to merge.");
  const spec = SPECS[type];
  const rows = await all(db, `SELECT * FROM ${spec.table} WHERE owner_id=? AND id IN (?,?)`, owner, survivorId, mergedId);
  const survivor = rows.find((r) => r.id === survivorId),
    duplicate = rows.find((r) => r.id === mergedId);
  if (!survivor || !duplicate) throw new ManageError("One of those records doesn’t exist.", 404);
  if (survivor.archived_at || duplicate.archived_at) throw new ManageError("An archived record can’t be merged. Restore it first.", 409);
  return { spec, survivor, duplicate };
}

async function collect(db: D1, owner: string, spec: Spec, mergedId: string) {
  const moved: Record<string, string[]> = {};
  await Promise.all(
    spec.links.map(async (link) => {
      moved[link.key] = (await all(db, link.select, owner, mergedId)).map((r) => r.id);
    }),
  );
  return moved;
}

function typeOf(value: unknown) {
  return oneOf(value, ["cat", "person", "colony"] as const, "recordType", true)!;
}

/** Read-only preview shown before Ari confirms. */
export async function read(db: D1, owner: string, url: URL) {
  const p = url.searchParams,
    type = typeOf(p.get("type"));
  const { spec, survivor, duplicate } = await loadPair(
    db,
    owner,
    type,
    recordId(p.get("survivorId"), "survivorId", true)!,
    recordId(p.get("mergedId"), "mergedId", true)!,
  );
  const analysis = analyze(type, survivor, duplicate),
    moved = await collect(db, owner, spec, duplicate.id);
  const brief = (r: Row) => ({ id: r.id, version: r.version, label: spec.label(r) });
  return {
    recordType: type,
    survivor: brief(survivor),
    duplicate: brief(duplicate),
    blockers: analysis.blockers,
    canMerge: !analysis.blockers.length,
    willFill: Object.entries(analysis.fills).map(([field, value]) => ({ field, value })),
    conflicts: analysis.conflicts,
    willMove: Object.fromEntries(Object.entries(moved).map(([k, ids]) => [k, ids.length])),
    note: "Nothing is deleted. The other record is archived and its history, photos and money move to the one you keep.",
  };
}

export async function write(ctx: Ctx, body: Row): Promise<Write> {
  const type = typeOf(body.recordType),
    survivorId = recordId(body.survivorId, "Record to keep", true)!,
    mergedId = recordId(body.mergedId, "Record to merge", true)!;
  if (body.confirm !== true) throw new ManageError("Please confirm the merge.");
  const { spec, survivor, duplicate } = await loadPair(ctx.db, ctx.owner, type, survivorId, mergedId);
  checkVersion(survivor, { version: body.survivorVersion }, "record you are keeping");
  checkVersion(duplicate, { version: body.mergedVersion }, "record you are merging");
  const analysis = analyze(type, survivor, duplicate);
  if (analysis.blockers.length) throw new ManageError(`These can’t be merged. ${analysis.blockers.join(" ")}`, 409, "blocked");
  const moved = await collect(ctx.db, ctx.owner, spec, mergedId),
    mergeId = makeId("merge"),
    statements: D1PreparedStatement[] = [];
  const updates: Row = { ...analysis.fills, ...analysis.appended };
  const chipMoves = type === "cat" && "microchip_number" in analysis.fills;

  // A microchip can belong to only one record, so it is released from the duplicate before the survivor takes it.
  if (chipMoves)
    statements.push(ctx.stmt("UPDATE cats SET microchip_number=NULL,updated_at=? WHERE id=? AND owner_id=?", ctx.now, mergedId, ctx.owner));
  const columns = Object.keys(updates);
  if (columns.length)
    statements.push(
      ctx.stmt(
        `UPDATE ${spec.table} SET ${columns.map((c) => `${c}=?`).join(",")}${type === "cat" ? ",updated_at=?" : ""} WHERE id=? AND owner_id=? AND version=?`,
        ...columns.map((c) => updates[c]),
        ...(type === "cat" ? [ctx.now] : []),
        survivorId,
        ctx.owner,
        survivor.version,
      ),
    );
  for (const link of spec.links) statements.push(ctx.stmt(link.sql, survivorId, ctx.owner, mergedId));
  if (type === "cat") {
    const dropped = analysis.conflicts.map((c) => `${c.field}: ${c.other}`);
    const notes = [
      `Merged in a duplicate record (${spec.label(duplicate)}).`,
      dropped.length ? `Kept this record’s details. The other record had: ${dropped.join("; ")}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    statements.push(
      ctx.stmt(
        "INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
        makeId("event"),
        ctx.owner,
        survivorId,
        "other",
        ctx.now,
        notes.slice(0, 2000),
        ctx.now,
        ctx.now,
      ),
    );
  }
  const reason = `Merged into ${spec.label(survivor)}`;
  statements.push(
    ctx.stmt(
      `UPDATE ${spec.table} SET archived_at=?,archive_reason=? WHERE id=? AND owner_id=? AND archived_at IS NULL`,
      ctx.now,
      reason,
      mergedId,
      ctx.owner,
    ),
  );
  statements.push(
    ctx.stmt(
      "INSERT INTO merges(id,owner_id,record_type,survivor_id,merged_id,actor_id,summary,conflicts,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      mergeId,
      ctx.owner,
      type,
      survivorId,
      mergedId,
      ctx.owner,
      JSON.stringify({
        moved,
        filled: analysis.fills,
        appended: analysis.appended,
        microchipMoved: chipMoves,
        survivorBefore: survivor,
        duplicateBefore: duplicate,
      }),
      JSON.stringify(analysis.conflicts),
      ctx.now,
    ),
  );
  statements.push(
    ctx.audit({
      recordType: type,
      recordId: survivorId,
      action: "merged_from",
      reason: `Merged in ${spec.label(duplicate)}`,
      before: survivor,
      after: { ...survivor, ...updates },
      mergeId,
    }),
  );
  statements.push(
    ctx.audit({
      recordType: type,
      recordId: mergedId,
      action: "merge_into",
      reason,
      before: duplicate,
      after: { ...duplicate, ...(chipMoves ? { microchip_number: null } : {}), archived_at: ctx.now, archive_reason: reason },
      mergeId,
    }),
  );
  const counts = Object.fromEntries(Object.entries(moved).map(([k, ids]) => [k, ids.length]));
  return {
    statements,
    response: {
      outcome: "merged",
      mergeId,
      survivorId,
      mergedId,
      moved: counts,
      conflicts: analysis.conflicts,
      message: `Merged. Nothing was deleted: ${spec.label(duplicate)} is archived and its history now lives on ${spec.label(survivor)}.`,
    },
  };
}
