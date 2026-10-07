import { COLONY_STATUSES } from "./constants";
import { ManageError, all, checkVersion, diff, first, makeId, mergedInto, oneOf, pageInfo, paging, parseJson, recordId, searchClause, searchTerms, text, type Ctx, type D1, type Row, type Write } from "./common";
import { displayName } from "./cats";

const COLUMNS = ["name", "general_location", "notes", "status", "latitude", "longitude"];
const KEYS: Record<string, string> = { name: "name", generalLocation: "general_location", notes: "notes", status: "status", latitude: "latitude", longitude: "longitude" };

function coordinate(value: unknown, field: string, limit: number): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > limit) throw new ManageError(`${field} must be a number between -${limit} and ${limit}.`);
  return n;
}

function clean(input: Row, keys?: Set<string>): Row {
  const want = (k: string) => (keys ? keys.has(k) : k in input);
  const out: Row = {};
  if (want("name")) out.name = text(input.name, "Name", 100, true);
  if (want("generalLocation")) out.general_location = text(input.generalLocation, "Location", 300);
  if (want("notes")) out.notes = text(input.notes, "Notes", 2000);
  if (want("status")) out.status = oneOf(input.status, COLONY_STATUSES, "Status", true);
  if (want("latitude")) out.latitude = coordinate(input.latitude, "Latitude", 90);
  if (want("longitude")) out.longitude = coordinate(input.longitude, "Longitude", 180);
  return out;
}

// A map pin needs both coordinates (or neither), whatever combination of fields was edited.
function checkPin(row: Row) {
  if ((row.latitude == null) !== (row.longitude == null)) throw new ManageError("Enter both latitude and longitude, or neither.");
}

async function requireFreeName(db: D1, owner: string, name: string, exceptId?: string) {
  const other = await first(db, "SELECT id FROM colonies WHERE owner_id=? AND LOWER(name)=LOWER(?) AND archived_at IS NULL AND id<>?", owner, name, exceptId ?? "");
  if (other) throw new ManageError(`There’s already a colony called “${name}”. If they’re the same place, merge them instead.`, 409, "conflict");
}

export const shapeColony = (c: Row) => ({
  id: c.id, version: c.version, name: c.name, generalLocation: c.general_location, notes: c.notes, status: c.status, latitude: c.latitude, longitude: c.longitude,
  archivedAt: c.archived_at, archiveReason: c.archive_reason, mergedInto: c.merged_into ?? null, catCount: c.cat_count, createdAt: c.created_at, updatedAt: c.updated_at,
});

export async function listColonies(db: D1, owner: string, params: URLSearchParams) {
  const { page, pageSize, offset } = paging(params);
  const where = ["c.owner_id=?"], binds: Array<string | number> = [owner];
  const archived = params.get("archived") || "active";
  if (archived === "active") where.push("c.archived_at IS NULL"); else if (archived === "archived") where.push("c.archived_at IS NOT NULL"); else if (archived !== "all") throw new ManageError("archived must be active, archived or all.");
  const status = params.get("status");
  if (status) { where.push("c.status=?"); binds.push(status); }
  const search = searchClause(searchTerms(params), ["c.name", "c.general_location", "c.notes"]);
  const filter = where.join(" AND ") + search.sql, args = [...binds, ...search.binds];
  const [count, rows] = await Promise.all([
    first<{ n: number }>(db, `SELECT COUNT(*) n FROM colonies c WHERE ${filter}`, ...args),
    all(db, `SELECT c.*,(SELECT COUNT(*) FROM cats k WHERE k.owner_id=c.owner_id AND k.origin_colony_id=c.id AND k.archived_at IS NULL) cat_count,
      (SELECT m.survivor_id FROM merges m WHERE m.owner_id=c.owner_id AND m.record_type='colony' AND m.merged_id=c.id) merged_into
      FROM colonies c WHERE ${filter} ORDER BY LOWER(c.name), c.id LIMIT ? OFFSET ?`, ...args, pageSize, offset),
  ]);
  return { items: rows.map(shapeColony), ...pageInfo(Number(count?.n || 0), page, pageSize) };
}

export async function read(db: D1, owner: string, url: URL) {
  const id = url.searchParams.get("id");
  if (!id) return listColonies(db, owner, url.searchParams);
  const row = await first(db, "SELECT c.*,(SELECT COUNT(*) FROM cats k WHERE k.owner_id=c.owner_id AND k.origin_colony_id=c.id AND k.archived_at IS NULL) cat_count,(SELECT m.survivor_id FROM merges m WHERE m.owner_id=c.owner_id AND m.record_type='colony' AND m.merged_id=c.id) merged_into FROM colonies c WHERE c.id=? AND c.owner_id=?", id, owner);
  if (!row) throw new ManageError("Colony not found.", 404);
  const [cats, spending, changes, mergedFrom] = await Promise.all([
    all(db, "SELECT id,name,appearance,distinguishing_characteristics,sex,age_class,current_status FROM cats WHERE owner_id=? AND origin_colony_id=? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 100", owner, id),
    all(db, "SELECT direction,currency,SUM(amount_minor) minor,COUNT(*) n FROM active_transactions WHERE owner_id=? AND related_colony_id=? AND amount_minor IS NOT NULL GROUP BY direction,currency", owner, id),
    all(db, "SELECT id,action,reason,before_snapshot,after_snapshot,merge_id,created_at FROM record_changes WHERE owner_id=? AND record_type='colony' AND record_id=? ORDER BY created_at DESC, rowid DESC LIMIT 50", owner, id),
    all(db, "SELECT m.id,m.merged_id,m.created_at,c.name FROM merges m JOIN colonies c ON c.id=m.merged_id AND c.owner_id=m.owner_id WHERE m.owner_id=? AND m.record_type='colony' AND m.survivor_id=?", owner, id),
  ]);
  return {
    colony: shapeColony(row),
    cats: cats.map((c) => ({ id: c.id, displayName: displayName(c), currentStatus: c.current_status })),
    money: spending.map((r) => ({ direction: r.direction, currency: r.currency, minor: Number(r.minor), count: r.n })),
    changes: changes.map((c) => ({ id: c.id, action: c.action, reason: c.reason, before: parseJson(c.before_snapshot, null), after: parseJson(c.after_snapshot, null), mergeId: c.merge_id, createdAt: c.created_at })),
    mergedFrom: mergedFrom.map((m) => ({ mergeId: m.id, colonyId: m.merged_id, name: m.name, mergedAt: m.created_at })),
  };
}

export async function write(ctx: Ctx, body: Row, method: "POST" | "PATCH"): Promise<Write> {
  const action = typeof body.action === "string" ? body.action : method === "POST" ? "create" : "update";
  if (action === "create") {
    const fields = clean((body.colony ?? body) as Row), id = makeId("colony");
    fields.status ??= "active";
    checkPin(fields);
    await requireFreeName(ctx.db, ctx.owner, fields.name);
    const row = { id, version: 0, ...fields };
    return {
      statements: [ctx.stmt(`INSERT INTO colonies(id,owner_id,${COLUMNS.join(",")},created_at,updated_at) VALUES(?,?,${COLUMNS.map(() => "?").join(",")},?,?)`, id, ctx.owner, ...COLUMNS.map((c) => fields[c] ?? null), ctx.now, ctx.now),
        ctx.audit({ recordType: "colony", recordId: id, action: "create", after: row })],
      response: { outcome: "saved", id, message: "Colony added." },
    };
  }
  const id = recordId(body.id, "Colony", true)!;
  const colony = await first(ctx.db, "SELECT * FROM colonies WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!colony) throw new ManageError("Colony not found.", 404);
  if (action === "update") {
    checkVersion(colony, body, "colony");
    if (colony.archived_at) throw new ManageError("This colony is archived. Restore it before editing.", 409);
    const changes = (body.changes ?? {}) as Row, keys = new Set(Object.keys(changes));
    for (const k of keys) if (!(k in KEYS)) throw new ManageError(`${k} can’t be edited.`);
    const fields = clean(changes, keys), changed = diff(colony, { ...colony, ...fields }, Object.keys(fields));
    if (!Object.keys(changed).length) throw new ManageError("Nothing changed.");
    checkPin({ ...colony, ...fields });
    if (changed.name) await requireFreeName(ctx.db, ctx.owner, fields.name, id);
    const columns = Object.keys(changed);
    return {
      statements: [ctx.stmt(`UPDATE colonies SET ${columns.map((c) => `${c}=?`).join(",")} WHERE id=? AND owner_id=? AND version=?`, ...columns.map((c) => fields[c] ?? null), id, ctx.owner, colony.version),
        ctx.audit({ recordType: "colony", recordId: id, action: "update", reason: text(body.reason, "Reason", 300), before: colony, after: { ...colony, ...fields } })],
      response: { outcome: "saved", id, changed: columns, message: "Saved." },
    };
  }
  if (action === "archive") {
    if (colony.archived_at) throw new ManageError("This colony is already archived.", 409);
    const reason = text(body.reason, "Reason", 300);
    const cats = await first<{ n: number }>(ctx.db, "SELECT COUNT(*) n FROM cats WHERE owner_id=? AND origin_colony_id=? AND archived_at IS NULL", ctx.owner, id);
    return {
      statements: [ctx.stmt("UPDATE colonies SET archived_at=?,archive_reason=? WHERE id=? AND owner_id=? AND archived_at IS NULL", ctx.now, reason, id, ctx.owner),
        ctx.audit({ recordType: "colony", recordId: id, action: "archive", reason, before: colony, after: { ...colony, archived_at: ctx.now, archive_reason: reason } })],
      response: { outcome: "saved", id, message: cats?.n ? `Archived. The ${cats.n} cat${cats.n === 1 ? "" : "s"} from here keep their origin.` : "Archived." },
    };
  }
  if (action === "restore") {
    if (!colony.archived_at) throw new ManageError("This colony isn’t archived.", 409);
    if (await mergedInto(ctx.db, ctx.owner, "colony", id)) throw new ManageError("This colony was merged into another one, so it can’t be restored.", 409);
    await requireFreeName(ctx.db, ctx.owner, colony.name, id);
    return {
      statements: [ctx.stmt("UPDATE colonies SET archived_at=NULL,archive_reason=NULL WHERE id=? AND owner_id=? AND archived_at IS NOT NULL", id, ctx.owner),
        ctx.audit({ recordType: "colony", recordId: id, action: "restore", before: colony, after: { ...colony, archived_at: null, archive_reason: null } })],
      response: { outcome: "saved", id, message: "Restored." },
    };
  }
  throw new ManageError("Unknown action.");
}
