import { derivedStatus, impliedStatus, statusRepair } from "../api/assistant/corrections";
import { EVENT_TYPES } from "./constants";
import { ManageError, all, checkVersion, dateValue, diff, first, makeId, oneOf, recordId, text, type Ctx, type D1, type Row, type Write } from "./common";
import { loadCat } from "./cats";
import { replaceRecord, setVoided } from "./versioned";

type StatusEvent = { id: string; cat_id: string | null; event_type: string; occurred_at: string; created_at: string };
const EDITABLE = ["eventType", "occurredAt", "location", "personId", "notes"];

async function cleanEvent(ctx: Ctx, input: Row, keys?: Set<string>): Promise<Row> {
  const want = (k: string) => (keys ? keys.has(k) : true);
  const out: Row = {};
  if (want("eventType")) out.event_type = oneOf(input.eventType, EVENT_TYPES, "Event type", true);
  if (want("occurredAt")) out.occurred_at = dateValue(input.occurredAt, "Date");
  if (want("location")) out.location = text(input.location, "Location", 300);
  if (want("notes")) out.notes = text(input.notes, "Notes", 2000);
  if (want("personId")) {
    const id = recordId(input.personId, "Person");
    if (id) {
      const person = await first(ctx.db, "SELECT id,archived_at FROM people WHERE id=? AND owner_id=?", id, ctx.owner);
      if (!person) throw new ManageError("That person doesn’t exist.", 404);
      if (person.archived_at) throw new ManageError("That person is archived. Restore them first or choose someone else.", 409);
    }
    out.person_id = id;
  }
  return out;
}

const activeEvents = (db: D1, owner: string, catId: string) =>
  all<StatusEvent>(db, "SELECT id,cat_id,event_type,occurred_at,created_at FROM active_events WHERE owner_id=? AND cat_id=?", owner, catId);

export async function write(ctx: Ctx, body: Row, method: "POST" | "PATCH"): Promise<Write> {
  const action = typeof body.action === "string" ? body.action : method === "POST" ? "create" : "update";
  if (action === "create") return createEvent(ctx, body);
  if (action === "update") return updateEvent(ctx, body);
  if (action === "void" || action === "unvoid") return voidEvent(ctx, body, action);
  throw new ManageError("Unknown action.");
}

async function createEvent(ctx: Ctx, body: Row): Promise<Write> {
  const input = (body.event ?? body) as Row;
  const catId = recordId(input.catId, "Cat", true)!, cat = await loadCat(ctx.db, ctx.owner, catId);
  if (cat.archived_at) throw new ManageError("This cat is archived. Restore it before adding history.", 409);
  const fields = await cleanEvent(ctx, input);
  const id = makeId("event"), statements: D1PreparedStatement[] = [];
  const row = { id, version: 0, cat_id: catId, ...fields, created_at: ctx.now };
  statements.push(ctx.stmt("INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,location,person_id,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    id, ctx.owner, catId, fields.event_type, fields.occurred_at, fields.location, fields.person_id, fields.notes, ctx.now, ctx.now));
  statements.push(ctx.audit({ recordType: "event", recordId: id, action: "create", after: row }));
  // An event that implies a status (adopted, foster, deceased…) moves the cat only if it is now the latest such event.
  const before = await activeEvents(ctx.db, ctx.owner, catId);
  const added: StatusEvent = { id, cat_id: catId, event_type: fields.event_type, occurred_at: fields.occurred_at, created_at: ctx.now };
  const implied = impliedStatus(fields.event_type);
  let status: string | null = null;
  if (implied && derivedStatus([...before, added], catId) === implied && cat.current_status !== implied) status = implied;
  if (status) statements.push(...catStatusStatements(ctx, cat, status));
  return { statements, response: { outcome: "saved", id, statusChangedTo: status, message: status ? `Added. ${displayStatus(status)}.` : "Added to the cat’s history." } };
}

const displayStatus = (s: string) => `Status is now “${s}”`;
function catStatusStatements(ctx: Ctx, cat: Row, status: string) {
  return [
    ctx.stmt("UPDATE cats SET current_status=?,updated_at=? WHERE id=? AND owner_id=?", status, ctx.now, cat.id, ctx.owner),
    ctx.audit({ recordType: "cat", recordId: cat.id, action: "update", reason: "Status follows the cat’s history", before: cat, after: { ...cat, current_status: status, updated_at: ctx.now } }),
  ];
}

async function loadEvent(ctx: Ctx, id: string) {
  const event = await first(ctx.db, "SELECT * FROM events WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!event) throw new ManageError("Event not found.", 404);
  if (event.superseded_at) throw new ManageError("This entry was already replaced by a newer version. Reload to see the current one.", 409, "conflict");
  return event;
}

async function updateEvent(ctx: Ctx, body: Row): Promise<Write> {
  const id = recordId(body.id, "Event", true)!, event = await loadEvent(ctx, id);
  checkVersion(event, body, "entry");
  if (event.voided_at) throw new ManageError("This entry was removed. Restore it before editing.", 409);
  const changes = (body.changes ?? {}) as Row, keys = new Set(Object.keys(changes));
  for (const k of keys) if (!EDITABLE.includes(k)) throw new ManageError(`${k} can’t be edited.`);
  const clean = await cleanEvent(ctx, changes, keys);
  const next = { ...event, ...clean };
  if (!Object.keys(diff(event, next, Object.keys(clean))).length) throw new ManageError("Nothing changed.");
  const replacementId = makeId("event");
  const statements = await replaceRecord(ctx, "event", event, replacementId, {
    columns: { cat_id: event.cat_id, event_type: next.event_type, occurred_at: next.occurred_at, location: next.location, person_id: next.person_id, notes: next.notes },
    reason: text(body.reason, "Reason", 300) ?? "Edited by hand",
  });
  if (event.cat_id) {
    const cat = await loadCat(ctx.db, ctx.owner, event.cat_id), before = await activeEvents(ctx.db, ctx.owner, event.cat_id);
    const replacement: StatusEvent = { id: replacementId, cat_id: event.cat_id, event_type: next.event_type, occurred_at: next.occurred_at, created_at: ctx.now };
    const repaired = statusRepair(cat, before, [...before.filter((e) => e.id !== id), replacement]);
    if (repaired) statements.push(...catStatusStatements(ctx, cat, repaired));
  }
  return { statements, response: { outcome: "saved", id: replacementId, replacedId: id, message: "Saved. The earlier version is kept in the history." } };
}

async function voidEvent(ctx: Ctx, body: Row, action: "void" | "unvoid"): Promise<Write> {
  const id = recordId(body.id, "Event", true)!, event = await loadEvent(ctx, id);
  const reason = text(body.reason, "Reason", 300);
  const statements = setVoided(ctx, "event", event, action, reason);
  if (event.cat_id) {
    const cat = await loadCat(ctx.db, ctx.owner, event.cat_id), before = await activeEvents(ctx.db, ctx.owner, event.cat_id);
    const after = action === "void" ? before.filter((e) => e.id !== id) : [...before, event as StatusEvent];
    const repaired = statusRepair(cat, before, after);
    if (repaired) statements.push(...catStatusStatements(ctx, cat, repaired));
  }
  return { statements, response: { outcome: "saved", id, message: action === "void" ? "Removed from the history. You can restore it any time." : "Restored to the history." } };
}

/** Events are read through the cat they belong to (api/manage/cats?id=…); this lists recent history. */
export async function read(db: D1, owner: string, url: URL) {
  const catId = url.searchParams.get("catId");
  const rows = await all(db, `SELECT e.id,e.version,e.cat_id,e.event_type,e.occurred_at,e.location,e.notes,e.person_id FROM active_events e WHERE e.owner_id=?${catId ? " AND e.cat_id=?" : ""} ORDER BY e.occurred_at DESC, e.id LIMIT 100`, ...(catId ? [owner, catId] : [owner]));
  return { items: rows };
}
