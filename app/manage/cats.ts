import { AGE_CLASSES, CAT_STATUSES, SEXES } from "./constants";
import {
  ManageError,
  all,
  checkVersion,
  diff,
  first,
  makeId,
  mergedInto,
  oneOf,
  pageInfo,
  paging,
  parseJson,
  recordId,
  searchClause,
  searchTerms,
  text,
  type Ctx,
  type D1,
  type Row,
  type Write,
} from "./common";

export const CAT_FIELDS = [
  "name",
  "sex",
  "age_class",
  "appearance",
  "distinguishing_characteristics",
  "health_observations",
  "reproductive_significance",
  "origin_colony_id",
  "current_status",
  "current_location",
  "microchip_number",
];
const FIELD_KEYS: Record<string, string> = {
  name: "name",
  sex: "sex",
  ageClass: "age_class",
  appearance: "appearance",
  distinguishingCharacteristics: "distinguishing_characteristics",
  healthObservations: "health_observations",
  reproductiveSignificance: "reproductive_significance",
  originColonyId: "origin_colony_id",
  currentStatus: "current_status",
  currentLocation: "current_location",
  microchipNumber: "microchip_number",
};

/** A cat is identified by what we know; a name is optional. */
export const displayName = (c: Row) =>
  String(
    c.name ||
      [c.distinguishing_characteristics, c.appearance, c.sex !== "unknown" ? c.sex : null, c.age_class !== "unknown" ? c.age_class : null]
        .filter(Boolean)
        .join(" ") ||
      "Unnamed cat",
  );

async function cleanFields(db: D1, owner: string, input: Row, only?: Set<string>): Promise<Row> {
  const out: Row = {};
  const want = (key: string) => (only ? only.has(key) : key in input);
  if (want("name")) out.name = text(input.name, "Name", 100);
  if (want("sex")) out.sex = oneOf(input.sex, SEXES, "Sex");
  if (want("ageClass")) out.age_class = oneOf(input.ageClass, AGE_CLASSES, "Age");
  if (want("appearance")) out.appearance = text(input.appearance, "Appearance", 500);
  if (want("distinguishingCharacteristics"))
    out.distinguishing_characteristics = text(input.distinguishingCharacteristics, "Distinguishing characteristics", 500);
  if (want("healthObservations")) out.health_observations = text(input.healthObservations, "Health notes", 2000);
  if (want("reproductiveSignificance")) out.reproductive_significance = text(input.reproductiveSignificance, "Reproductive notes", 500);
  if (want("currentLocation")) out.current_location = text(input.currentLocation, "Location", 300);
  if (want("currentStatus")) out.current_status = oneOf(input.currentStatus, CAT_STATUSES, "Status", true);
  if (want("microchipNumber")) {
    const chip = text(input.microchipNumber, "Microchip", 40);
    out.microchip_number = chip ? chip.replace(/[\s-]+/g, "").toUpperCase() : null;
  }
  if (want("originColonyId")) {
    const id = recordId(input.originColonyId, "Colony");
    if (id) {
      const colony = await first(db, "SELECT id,archived_at FROM colonies WHERE id=? AND owner_id=?", id, owner);
      if (!colony) throw new ManageError("That colony doesn’t exist.", 404);
      if (colony.archived_at) throw new ManageError("That colony is archived. Restore it first or choose another.", 409);
    }
    out.origin_colony_id = id;
  }
  return out;
}

async function requireFreeMicrochip(db: D1, owner: string, chip: unknown, exceptId?: string) {
  if (!chip) return;
  const other = await first(
    db,
    "SELECT id,name FROM cats WHERE owner_id=? AND microchip_number=? AND id<>?",
    owner,
    chip as string,
    exceptId ?? "",
  );
  if (other)
    throw new ManageError(
      `${other.name ? `${other.name} already has` : "Another cat already has"} microchip ${chip}. If these are the same cat, merge them instead.`,
      409,
      "conflict",
    );
}

export async function loadCat(db: D1, owner: string, id: string) {
  const cat = await first(db, "SELECT * FROM cats WHERE id=? AND owner_id=?", id, owner);
  if (!cat) throw new ManageError("Cat not found.", 404);
  return cat;
}

// ---------- reads ----------
const SORTS: Record<string, string> = {
  updated: "c.updated_at DESC, c.id",
  created: "c.created_at DESC, c.id",
  name: "LOWER(COALESCE(NULLIF(c.name,''),c.distinguishing_characteristics,c.appearance,'~')), c.id",
};

export async function listCats(db: D1, owner: string, params: URLSearchParams) {
  const { page, pageSize, offset } = paging(params);
  const where = ["c.owner_id=?"],
    binds: Array<string | number> = [owner];
  const archived = params.get("archived") || "active";
  if (archived === "active") where.push("c.archived_at IS NULL");
  else if (archived === "archived") where.push("c.archived_at IS NOT NULL");
  else if (archived !== "all") throw new ManageError("archived must be active, archived or all.");
  const eq = (param: string, column: string) => {
    const v = params.get(param);
    if (v) {
      where.push(`${column}=?`);
      binds.push(v);
    }
  };
  eq("status", "c.current_status");
  eq("sex", "c.sex");
  eq("ageClass", "c.age_class");
  const colony = params.get("colonyId");
  if (colony === "none") where.push("c.origin_colony_id IS NULL");
  else if (colony) {
    where.push("c.origin_colony_id=?");
    binds.push(colony);
  }
  if (params.get("hasPhoto") === "yes")
    where.push("EXISTS(SELECT 1 FROM photos p WHERE p.owner_id=c.owner_id AND p.cat_id=c.id AND p.archived_at IS NULL)");
  if (params.get("hasPhoto") === "no")
    where.push("NOT EXISTS(SELECT 1 FROM photos p WHERE p.owner_id=c.owner_id AND p.cat_id=c.id AND p.archived_at IS NULL)");
  const search = searchClause(searchTerms(params), [
    "c.name",
    "c.appearance",
    "c.distinguishing_characteristics",
    "c.health_observations",
    "c.current_location",
    "c.microchip_number",
    "co.name",
    "c.current_status",
    "c.sex",
    "c.age_class",
  ]);
  const filter = where.join(" AND ") + search.sql,
    args = [...binds, ...search.binds];
  const from = "FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id";
  const order = SORTS[params.get("sort") || "updated"] || SORTS.updated;
  const [count, rows] = await Promise.all([
    first<{ n: number }>(db, `SELECT COUNT(*) n ${from} WHERE ${filter}`, ...args),
    all(
      db,
      `SELECT c.*,co.name colony_name,
      (SELECT COUNT(*) FROM active_events e WHERE e.owner_id=c.owner_id AND e.cat_id=c.id) event_count,
      (SELECT COUNT(*) FROM photos p WHERE p.owner_id=c.owner_id AND p.cat_id=c.id AND p.archived_at IS NULL) photo_count,
      (SELECT p.id FROM photos p WHERE p.owner_id=c.owner_id AND p.cat_id=c.id AND p.archived_at IS NULL ORDER BY p.taken_at DESC, p.id LIMIT 1) lead_photo_id,
      (SELECT m.survivor_id FROM merges m WHERE m.owner_id=c.owner_id AND m.record_type='cat' AND m.merged_id=c.id) merged_into
      ${from} WHERE ${filter} ORDER BY ${order} LIMIT ? OFFSET ?`,
      ...args,
      pageSize,
      offset,
    ),
  ]);
  return { items: rows.map(shapeCat), ...pageInfo(Number(count?.n || 0), page, pageSize) };
}

export function shapeCat(c: Row) {
  return {
    id: c.id,
    version: c.version,
    displayName: displayName(c),
    name: c.name,
    sex: c.sex,
    ageClass: c.age_class,
    appearance: c.appearance,
    distinguishingCharacteristics: c.distinguishing_characteristics,
    healthObservations: c.health_observations,
    reproductiveSignificance: c.reproductive_significance,
    originColonyId: c.origin_colony_id,
    colonyName: c.colony_name ?? null,
    currentStatus: c.current_status,
    currentLocation: c.current_location,
    microchipNumber: c.microchip_number,
    archivedAt: c.archived_at,
    archiveReason: c.archive_reason,
    mergedInto: c.merged_into ?? null,
    eventCount: c.event_count,
    photoCount: c.photo_count,
    leadPhotoId: c.lead_photo_id ?? null,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  };
}

export async function catDetail(db: D1, owner: string, id: string, params: URLSearchParams) {
  const row = await first(
    db,
    `SELECT c.*,co.name colony_name,(SELECT m.survivor_id FROM merges m WHERE m.owner_id=c.owner_id AND m.record_type='cat' AND m.merged_id=c.id) merged_into
    FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.id=? AND c.owner_id=?`,
    id,
    owner,
  );
  if (!row) throw new ManageError("Cat not found.", 404);
  const { page, pageSize, offset } = paging(params, 50);
  // History includes records that were merged into this cat, so nothing "disappears" after a merge.
  const ids = "(SELECT ? UNION SELECT merged_id FROM merges WHERE owner_id=? AND record_type='cat' AND survivor_id=?)";
  const [count, events, photoCount, changes, mergedFrom] = await Promise.all([
    first<{ n: number }>(db, `SELECT COUNT(*) n FROM active_events WHERE owner_id=? AND cat_id IN ${ids}`, owner, id, owner, id),
    all(
      db,
      `SELECT e.id,e.version,e.event_type,e.occurred_at,e.location,e.notes,e.person_id,p.name person_name,e.created_at,
      (SELECT COUNT(*) FROM photos ph WHERE ph.owner_id=e.owner_id AND ph.event_id=e.id AND ph.archived_at IS NULL) photo_count
      FROM active_events e LEFT JOIN people p ON p.id=e.person_id AND p.owner_id=e.owner_id
      WHERE e.owner_id=? AND e.cat_id IN ${ids} ORDER BY e.occurred_at DESC, e.created_at DESC, e.id LIMIT ? OFFSET ?`,
      owner,
      id,
      owner,
      id,
      pageSize,
      offset,
    ),
    first<{ n: number }>(db, "SELECT COUNT(*) n FROM photos WHERE owner_id=? AND cat_id=? AND archived_at IS NULL", owner, id),
    all(
      db,
      "SELECT id,action,reason,actor_id,before_snapshot,after_snapshot,merge_id,created_at FROM record_changes WHERE owner_id=? AND record_type='cat' AND record_id=? ORDER BY created_at DESC, rowid DESC LIMIT 50",
      owner,
      id,
    ),
    all(
      db,
      "SELECT m.id,m.merged_id,m.created_at,c.name,c.appearance,c.distinguishing_characteristics,c.sex,c.age_class FROM merges m JOIN cats c ON c.id=m.merged_id AND c.owner_id=m.owner_id WHERE m.owner_id=? AND m.record_type='cat' AND m.survivor_id=? ORDER BY m.created_at DESC",
      owner,
      id,
    ),
  ]);
  return {
    cat: { ...shapeCat({ ...row, photo_count: photoCount?.n }) },
    events: events.map((e) => ({
      id: e.id,
      version: e.version,
      eventType: e.event_type,
      occurredAt: e.occurred_at,
      location: e.location,
      notes: e.notes,
      personId: e.person_id,
      personName: e.person_name,
      photoCount: e.photo_count,
      createdAt: e.created_at,
    })),
    eventsPaging: pageInfo(Number(count?.n || 0), page, pageSize),
    changes: changes.map((c) => ({
      id: c.id,
      action: c.action,
      reason: c.reason,
      actorId: c.actor_id,
      before: parseJson(c.before_snapshot, null),
      after: parseJson(c.after_snapshot, null),
      mergeId: c.merge_id,
      createdAt: c.created_at,
    })),
    mergedFrom: mergedFrom.map((m) => ({ mergeId: m.id, catId: m.merged_id, displayName: displayName(m), mergedAt: m.created_at })),
  };
}

export async function read(db: D1, owner: string, url: URL) {
  const id = url.searchParams.get("id");
  return id ? catDetail(db, owner, id, url.searchParams) : listCats(db, owner, url.searchParams);
}

// ---------- writes ----------
export async function write(ctx: Ctx, body: Row, method: "POST" | "PATCH"): Promise<Write> {
  const action = typeof body.action === "string" ? body.action : method === "POST" ? "create" : "update";
  if (action === "create") return createCat(ctx, body);
  if (action === "update") return updateCat(ctx, body);
  if (action === "archive" || action === "restore") return archiveCat(ctx, body, action);
  throw new ManageError("Unknown action.");
}

async function createCat(ctx: Ctx, body: Row): Promise<Write> {
  const input = (body.cat ?? body) as Row;
  const fields = await cleanFields(ctx.db, ctx.owner, input);
  fields.current_status ??= "observed";
  const known = (f: string) => fields[f] != null && fields[f] !== "unknown";
  const described = [
    "name",
    "sex",
    "age_class",
    "appearance",
    "distinguishing_characteristics",
    "health_observations",
    "reproductive_significance",
    "origin_colony_id",
    "current_location",
    "microchip_number",
  ].some(known);
  if (!described)
    throw new ManageError(
      "Tell me something about this cat — a name isn’t required, but a description, colony, location or chip number is.",
    );
  await requireFreeMicrochip(ctx.db, ctx.owner, fields.microchip_number);
  const id = makeId("cat");
  const columns = ["id", "owner_id", ...CAT_FIELDS, "created_at", "updated_at"];
  const values = [id, ctx.owner, ...CAT_FIELDS.map((f) => fields[f] ?? null), ctx.now, ctx.now];
  const created = { id, version: 0, ...Object.fromEntries(CAT_FIELDS.map((f) => [f, fields[f] ?? null])) };
  return {
    statements: [
      ctx.stmt(`INSERT INTO cats(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`, ...values),
      ctx.audit({ recordType: "cat", recordId: id, action: "create", after: created }),
    ],
    response: { outcome: "saved", id, message: "Cat added." },
  };
}

async function updateCat(ctx: Ctx, body: Row): Promise<Write> {
  const id = recordId(body.id, "Cat", true)!,
    cat = await loadCat(ctx.db, ctx.owner, id);
  checkVersion(cat, body, "cat");
  if (cat.archived_at) throw new ManageError("This cat is archived. Restore it before editing.", 409);
  const changes = (body.changes ?? {}) as Row;
  if (typeof changes !== "object" || Array.isArray(changes)) throw new ManageError("Nothing to change.");
  const keys = new Set(Object.keys(changes));
  for (const k of keys) if (!(k in FIELD_KEYS)) throw new ManageError(`${k} can’t be edited.`);
  const clean = await cleanFields(ctx.db, ctx.owner, changes, keys);
  const changed = diff(cat, { ...cat, ...clean }, Object.keys(clean));
  if (!Object.keys(changed).length) throw new ManageError("Nothing changed.");
  if (changed.microchip_number) await requireFreeMicrochip(ctx.db, ctx.owner, clean.microchip_number, id);
  const columns = Object.keys(changed),
    after = { ...cat, ...clean };
  return {
    statements: [
      ctx.stmt(
        `UPDATE cats SET ${columns.map((c) => `${c}=?`).join(",")},updated_at=? WHERE id=? AND owner_id=? AND version=?`,
        ...columns.map((c) => clean[c] ?? null),
        ctx.now,
        id,
        ctx.owner,
        cat.version,
      ),
      ctx.audit({
        recordType: "cat",
        recordId: id,
        action: "update",
        reason: text(body.reason, "Reason", 300),
        before: cat,
        after: { ...after, updated_at: ctx.now },
      }),
    ],
    response: { outcome: "saved", id, changed: Object.keys(changed), message: "Saved." },
  };
}

async function archiveCat(ctx: Ctx, body: Row, action: "archive" | "restore"): Promise<Write> {
  const id = recordId(body.id, "Cat", true)!,
    cat = await loadCat(ctx.db, ctx.owner, id);
  if (action === "archive") {
    if (cat.archived_at) throw new ManageError("This cat is already archived.", 409);
    const reason = text(body.reason, "Reason", 300);
    return {
      statements: [
        ctx.stmt(
          "UPDATE cats SET archived_at=?,archive_reason=?,updated_at=? WHERE id=? AND owner_id=? AND archived_at IS NULL",
          ctx.now,
          reason,
          ctx.now,
          id,
          ctx.owner,
        ),
        ctx.audit({
          recordType: "cat",
          recordId: id,
          action: "archive",
          reason,
          before: cat,
          after: { ...cat, archived_at: ctx.now, archive_reason: reason },
        }),
      ],
      response: { outcome: "saved", id, message: "Archived. Its history and photos are kept, and you can restore it any time." },
    };
  }
  if (!cat.archived_at) throw new ManageError("This cat isn’t archived.", 409);
  const survivor = await mergedInto(ctx.db, ctx.owner, "cat", id);
  if (survivor)
    throw new ManageError(
      "This record was merged into another cat, so it can’t be restored. Its history now lives on the cat it was merged into.",
      409,
    );
  return {
    statements: [
      ctx.stmt(
        "UPDATE cats SET archived_at=NULL,archive_reason=NULL,updated_at=? WHERE id=? AND owner_id=? AND archived_at IS NOT NULL",
        ctx.now,
        id,
        ctx.owner,
      ),
      ctx.audit({
        recordType: "cat",
        recordId: id,
        action: "restore",
        before: cat,
        after: { ...cat, archived_at: null, archive_reason: null },
      }),
    ],
    response: { outcome: "saved", id, message: "Restored." },
  };
}
