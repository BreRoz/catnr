import { PERSON_TYPES } from "./constants";
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
import { displayName } from "./cats";
import { formatMoney } from "../money";

const COLUMNS = ["name", "type", "general_location", "contact", "notes"];
const KEYS: Record<string, string> = {
  name: "name",
  type: "type",
  generalLocation: "general_location",
  contact: "contact",
  notes: "notes",
};

function clean(input: Row, keys?: Set<string>): Row {
  const want = (k: string) => (keys ? keys.has(k) : k in input);
  const out: Row = {};
  if (want("name")) out.name = text(input.name, "Name", 200, true);
  if (want("type")) out.type = oneOf(input.type, PERSON_TYPES, "Type");
  if (want("generalLocation")) out.general_location = text(input.generalLocation, "Location", 300);
  if (want("contact")) out.contact = text(input.contact, "Contact", 300);
  if (want("notes")) out.notes = text(input.notes, "Notes", 2000);
  return out;
}

async function requireFreeName(db: D1, owner: string, name: string, exceptId?: string) {
  const other = await first(
    db,
    "SELECT id FROM people WHERE owner_id=? AND LOWER(name)=LOWER(?) AND archived_at IS NULL AND id<>?",
    owner,
    name,
    exceptId ?? "",
  );
  if (other)
    throw new ManageError(`There’s already someone called “${name}”. If they’re the same person, merge them instead.`, 409, "conflict");
}

export const shapePerson = (p: Row) => ({
  id: p.id,
  version: p.version,
  name: p.name,
  type: p.type,
  generalLocation: p.general_location,
  contact: p.contact,
  notes: p.notes,
  archivedAt: p.archived_at,
  archiveReason: p.archive_reason,
  mergedInto: p.merged_into ?? null,
  eventCount: p.event_count,
  transactionCount: p.transaction_count,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});

export async function listPeople(db: D1, owner: string, params: URLSearchParams) {
  const { page, pageSize, offset } = paging(params);
  const where = ["p.owner_id=?"],
    binds: Array<string | number> = [owner];
  const archived = params.get("archived") || "active";
  if (archived === "active") where.push("p.archived_at IS NULL");
  else if (archived === "archived") where.push("p.archived_at IS NOT NULL");
  else if (archived !== "all") throw new ManageError("archived must be active, archived or all.");
  const type = params.get("type");
  if (type === "none") where.push("p.type IS NULL");
  else if (type) {
    where.push("p.type=?");
    binds.push(type);
  }
  const search = searchClause(searchTerms(params), ["p.name", "p.contact", "p.general_location", "p.notes", "p.type"]);
  const filter = where.join(" AND ") + search.sql,
    args = [...binds, ...search.binds];
  const [count, rows] = await Promise.all([
    first<{ n: number }>(db, `SELECT COUNT(*) n FROM people p WHERE ${filter}`, ...args),
    all(
      db,
      `SELECT p.*,(SELECT COUNT(*) FROM active_events e WHERE e.owner_id=p.owner_id AND e.person_id=p.id) event_count,
      (SELECT COUNT(*) FROM active_transactions t WHERE t.owner_id=p.owner_id AND t.person_id=p.id) transaction_count,
      (SELECT m.survivor_id FROM merges m WHERE m.owner_id=p.owner_id AND m.record_type='person' AND m.merged_id=p.id) merged_into
      FROM people p WHERE ${filter} ORDER BY LOWER(p.name), p.id LIMIT ? OFFSET ?`,
      ...args,
      pageSize,
      offset,
    ),
  ]);
  return { items: rows.map(shapePerson), ...pageInfo(Number(count?.n || 0), page, pageSize) };
}

export async function read(db: D1, owner: string, url: URL) {
  const id = url.searchParams.get("id");
  if (!id) return listPeople(db, owner, url.searchParams);
  const person = await first(
    db,
    "SELECT p.*,(SELECT m.survivor_id FROM merges m WHERE m.owner_id=p.owner_id AND m.record_type='person' AND m.merged_id=p.id) merged_into FROM people p WHERE p.id=? AND p.owner_id=?",
    id,
    owner,
  );
  if (!person) throw new ManageError("Person not found.", 404);
  // "Relevant history": what they did with which cats, and the money tied to them.
  const [events, transactions, totals, changes, mergedFrom] = await Promise.all([
    all(
      db,
      `SELECT e.id,e.event_type,e.occurred_at,e.notes,e.cat_id,c.name,c.appearance,c.distinguishing_characteristics,c.sex,c.age_class FROM active_events e LEFT JOIN cats c ON c.id=e.cat_id AND c.owner_id=e.owner_id WHERE e.owner_id=? AND e.person_id=? ORDER BY e.occurred_at DESC, e.id LIMIT 50`,
      owner,
      id,
    ),
    all(
      db,
      "SELECT id,transaction_type,direction,date,amount_minor,currency,description,category FROM active_transactions WHERE owner_id=? AND person_id=? ORDER BY substr(date,1,10) DESC, id LIMIT 50",
      owner,
      id,
    ),
    all(
      db,
      "SELECT direction,currency,SUM(amount_minor) minor,COUNT(*) n FROM active_transactions WHERE owner_id=? AND person_id=? AND amount_minor IS NOT NULL GROUP BY direction,currency",
      owner,
      id,
    ),
    all(
      db,
      "SELECT id,action,reason,before_snapshot,after_snapshot,merge_id,created_at FROM record_changes WHERE owner_id=? AND record_type='person' AND record_id=? ORDER BY created_at DESC, rowid DESC LIMIT 50",
      owner,
      id,
    ),
    all(
      db,
      "SELECT m.id,m.merged_id,m.created_at,p.name FROM merges m JOIN people p ON p.id=m.merged_id AND p.owner_id=m.owner_id WHERE m.owner_id=? AND m.record_type='person' AND m.survivor_id=?",
      owner,
      id,
    ),
  ]);
  return {
    person: shapePerson(person),
    events: events.map((e) => ({
      id: e.id,
      eventType: e.event_type,
      occurredAt: e.occurred_at,
      notes: e.notes,
      catId: e.cat_id,
      catName: e.cat_id ? displayName(e) : null,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      transactionType: t.transaction_type,
      direction: t.direction,
      date: t.date,
      description: t.description,
      category: t.category,
      amountText: t.amount_minor == null ? null : formatMoney(t.amount_minor, t.currency),
    })),
    totals: totals.map((r) => ({
      direction: r.direction,
      currency: r.currency,
      minor: Number(r.minor),
      text: formatMoney(Number(r.minor), r.currency),
      count: r.n,
    })),
    changes: changes.map((c) => ({
      id: c.id,
      action: c.action,
      reason: c.reason,
      before: parseJson(c.before_snapshot, null),
      after: parseJson(c.after_snapshot, null),
      mergeId: c.merge_id,
      createdAt: c.created_at,
    })),
    mergedFrom: mergedFrom.map((m) => ({ mergeId: m.id, personId: m.merged_id, name: m.name, mergedAt: m.created_at })),
  };
}

export async function write(ctx: Ctx, body: Row, method: "POST" | "PATCH"): Promise<Write> {
  const action = typeof body.action === "string" ? body.action : method === "POST" ? "create" : "update";
  if (action === "create") {
    const fields = clean((body.person ?? body) as Row),
      id = makeId("person");
    await requireFreeName(ctx.db, ctx.owner, fields.name);
    const row = { id, version: 0, ...fields };
    return {
      statements: [
        ctx.stmt(
          `INSERT INTO people(id,owner_id,${COLUMNS.join(",")},created_at,updated_at) VALUES(?,?,${COLUMNS.map(() => "?").join(",")},?,?)`,
          id,
          ctx.owner,
          ...COLUMNS.map((c) => fields[c] ?? null),
          ctx.now,
          ctx.now,
        ),
        ctx.audit({ recordType: "person", recordId: id, action: "create", after: row }),
      ],
      response: { outcome: "saved", id, message: "Person added." },
    };
  }
  const id = recordId(body.id, "Person", true)!;
  const person = await first(ctx.db, "SELECT * FROM people WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!person) throw new ManageError("Person not found.", 404);
  if (action === "update") {
    checkVersion(person, body, "contact");
    if (person.archived_at) throw new ManageError("This contact is archived. Restore it before editing.", 409);
    const changes = (body.changes ?? {}) as Row,
      keys = new Set(Object.keys(changes));
    for (const k of keys) if (!(k in KEYS)) throw new ManageError(`${k} can’t be edited.`);
    const fields = clean(changes, keys),
      changed = diff(person, { ...person, ...fields }, Object.keys(fields));
    if (!Object.keys(changed).length) throw new ManageError("Nothing changed.");
    if (changed.name) await requireFreeName(ctx.db, ctx.owner, fields.name, id);
    const columns = Object.keys(changed);
    return {
      statements: [
        ctx.stmt(
          `UPDATE people SET ${columns.map((c) => `${c}=?`).join(",")} WHERE id=? AND owner_id=? AND version=?`,
          ...columns.map((c) => fields[c] ?? null),
          id,
          ctx.owner,
          person.version,
        ),
        ctx.audit({
          recordType: "person",
          recordId: id,
          action: "update",
          reason: text(body.reason, "Reason", 300),
          before: person,
          after: { ...person, ...fields },
        }),
      ],
      response: { outcome: "saved", id, changed: columns, message: "Saved." },
    };
  }
  if (action === "archive") {
    if (person.archived_at) throw new ManageError("This contact is already archived.", 409);
    const reason = text(body.reason, "Reason", 300);
    return {
      statements: [
        ctx.stmt(
          "UPDATE people SET archived_at=?,archive_reason=? WHERE id=? AND owner_id=? AND archived_at IS NULL",
          ctx.now,
          reason,
          id,
          ctx.owner,
        ),
        ctx.audit({
          recordType: "person",
          recordId: id,
          action: "archive",
          reason,
          before: person,
          after: { ...person, archived_at: ctx.now, archive_reason: reason },
        }),
      ],
      response: { outcome: "saved", id, message: "Archived. Their history and donations are kept." },
    };
  }
  if (action === "restore") {
    if (!person.archived_at) throw new ManageError("This contact isn’t archived.", 409);
    if (await mergedInto(ctx.db, ctx.owner, "person", id))
      throw new ManageError("This contact was merged into another one, so it can’t be restored.", 409);
    await requireFreeName(ctx.db, ctx.owner, person.name, id);
    return {
      statements: [
        ctx.stmt(
          "UPDATE people SET archived_at=NULL,archive_reason=NULL WHERE id=? AND owner_id=? AND archived_at IS NOT NULL",
          id,
          ctx.owner,
        ),
        ctx.audit({
          recordType: "person",
          recordId: id,
          action: "restore",
          before: person,
          after: { ...person, archived_at: null, archive_reason: null },
        }),
      ],
      response: { outcome: "saved", id, message: "Restored." },
    };
  }
  throw new ManageError("Unknown action.");
}
