import { DEFAULT_CURRENCY, toMinorUnits } from "../../money";
import { isCatStatus } from "./cats";
import { makeId, now } from "./ids";
import { checkReferences } from "./validation";
import type { AgentPlan, CatDraft, D1, EventDraft, PersonDraft, TransactionDraft } from "./types";

// Turns a validated "record" plan into database writes. `db` is the batching wrapper from reliability.ts, so
// nothing here is committed until the whole request commits at once. Every lookup is limited to the owner.

export type Written = { created: string[]; updated: string[]; message: string; clarification: string | null };
type Tally = { created: string[]; updated: string[] };

// A name that now belongs to an archived, merged-away record resolves to the record it was merged into,
// so the assistant never recreates a duplicate or attaches new work to an archived record.
async function mergedSurvivor(db: D1, owner: string, table: "colonies" | "people", type: "colony" | "person", name: string) {
  const row = await db
    .prepare(
      `SELECT m.survivor_id id FROM merges m JOIN ${table} r ON r.id=m.merged_id AND r.owner_id=m.owner_id WHERE m.owner_id=? AND m.record_type=? AND LOWER(r.name)=LOWER(?) ORDER BY m.created_at DESC LIMIT 1`,
    )
    .bind(owner, type, name)
    .first<{ id: string }>();
  return row?.id ?? null;
}

async function colony(db: D1, owner: string, name: string, tally: Tally): Promise<string> {
  const found = await db
    .prepare("SELECT id FROM colonies WHERE owner_id=? AND LOWER(name)=LOWER(?) AND archived_at IS NULL LIMIT 1")
    .bind(owner, name)
    .first<{ id: string }>();
  if (found) return found.id;
  const folded = await mergedSurvivor(db, owner, "colonies", "colony", name);
  if (folded) return folded;
  const id = makeId("colony");
  await db
    .prepare("INSERT INTO colonies(id,owner_id,name,general_location,status,created_at) VALUES(?,?,?,?,?,?)")
    .bind(id, owner, name, name, "active", now())
    .run();
  tally.created.push(`colony:${id}`);
  return id;
}

async function updateExistingPerson(db: D1, owner: string, draft: PersonDraft, tally: Tally): Promise<string> {
  const id = draft.existingId!;
  const valid = await db.prepare("SELECT id FROM people WHERE id=? AND owner_id=? AND archived_at IS NULL").bind(id, owner).first();
  if (!valid) throw new Error("Unknown person");
  await db
    .prepare(
      "UPDATE people SET name=COALESCE(?,name),type=COALESCE(?,type),general_location=COALESCE(?,general_location),contact=COALESCE(?,contact) WHERE id=? AND owner_id=?",
    )
    .bind(draft.name, draft.type, draft.generalLocation, draft.contact, id, owner)
    .run();
  tally.updated.push(`person:${id}`);
  return id;
}

/** Finds the person (by id, by name, or through a merge) or creates them. Returns null when no one was named. */
async function person(db: D1, owner: string, draft: PersonDraft | null, name: string | null, tally: Tally): Promise<string | null> {
  if (!draft && !name) return null;
  if (draft?.existingId) return updateExistingPerson(db, owner, draft, tally);
  const personName = draft?.name || name!;
  const found = await db
    .prepare("SELECT id FROM people WHERE owner_id=? AND LOWER(name)=LOWER(?) AND archived_at IS NULL LIMIT 1")
    .bind(owner, personName)
    .first<{ id: string }>();
  if (found) return found.id;
  const folded = await mergedSurvivor(db, owner, "people", "person", personName);
  if (folded) return folded;
  const id = makeId("person");
  await db
    .prepare("INSERT INTO people(id,owner_id,name,type,general_location,contact,created_at) VALUES(?,?,?,?,?,?,?)")
    .bind(id, owner, personName, draft?.type ?? null, draft?.generalLocation ?? null, draft?.contact ?? null, now())
    .run();
  tally.created.push(`person:${id}`);
  return id;
}

async function updateCat(db: D1, owner: string, c: CatDraft, tally: Tally): Promise<string> {
  const id = c.existingId!;
  const valid = await db.prepare("SELECT id FROM cats WHERE id=? AND owner_id=?").bind(id, owner).first();
  if (!valid) throw new Error("Unknown cat");
  const origin = c.origin ? await colony(db, owner, c.origin, tally) : null;
  const status = isCatStatus(c.currentStatus) ? c.currentStatus : null;
  await db
    .prepare(
      "UPDATE cats SET name=COALESCE(?,name),sex=COALESCE(?,sex),age_class=COALESCE(?,age_class),appearance=COALESCE(?,appearance),distinguishing_characteristics=COALESCE(?,distinguishing_characteristics),health_observations=COALESCE(?,health_observations),reproductive_significance=COALESCE(?,reproductive_significance),origin_colony_id=COALESCE(?,origin_colony_id),current_status=COALESCE(?,current_status),current_location=COALESCE(?,current_location),microchip_number=COALESCE(?,microchip_number),updated_at=? WHERE id=? AND owner_id=?",
    )
    .bind(
      c.name,
      c.sex,
      c.ageClass,
      c.appearance,
      c.distinguishingCharacteristics,
      c.healthObservations,
      c.reproductiveSignificance,
      origin,
      status,
      c.currentLocation,
      c.microchipNumber,
      now(),
      id,
      owner,
    )
    .run();
  tally.updated.push(`cat:${id}`);
  return id;
}

async function createCat(db: D1, owner: string, c: CatDraft, tally: Tally): Promise<string> {
  const id = makeId("cat");
  const origin = c.origin ? await colony(db, owner, c.origin, tally) : null;
  const status = isCatStatus(c.currentStatus) ? c.currentStatus : "observed";
  await db
    .prepare(
      "INSERT INTO cats(id,owner_id,name,sex,age_class,appearance,distinguishing_characteristics,health_observations,reproductive_significance,origin_colony_id,current_status,current_location,microchip_number,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      owner,
      c.name,
      c.sex,
      c.ageClass,
      c.appearance,
      c.distinguishingCharacteristics,
      c.healthObservations,
      c.reproductiveSignificance,
      origin,
      status,
      c.currentLocation,
      c.microchipNumber,
      now(),
      now(),
    )
    .run();
  tally.created.push(`cat:${id}`);
  return id;
}

async function writeEvent(db: D1, owner: string, inputId: string, source: string, e: EventDraft, refs: Map<string, string>, tally: Tally) {
  const catId = e.catRef ? refs.get(e.catRef) || e.catRef : null;
  if (catId && !(await db.prepare("SELECT id FROM cats WHERE id=? AND owner_id=?").bind(catId, owner).first()))
    throw new Error("Unknown event cat");
  const personId = e.personName ? await person(db, owner, null, e.personName, tally) : null;
  const id = makeId("event");
  await db
    .prepare(
      "INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,location,person_id,notes,source_input_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(id, owner, catId, e.eventType, e.occurredAt || now(), e.location, personId, e.notes || source, inputId, now())
    .run();
  tally.created.push(`event:${id}`);
}

async function writeTransaction(db: D1, owner: string, inputId: string, t: TransactionDraft, refs: Map<string, string>, tally: Tally) {
  const currency = t.currency || DEFAULT_CURRENCY;
  const amountMinor = t.amount == null ? null : toMinorUnits(t.amount, currency);
  const estimatedMinor = t.estimatedValue == null ? null : toMinorUnits(t.estimatedValue, currency);
  const personId = t.personName ? await person(db, owner, null, t.personName, tally) : null;
  const catId = t.relatedCatRef ? refs.get(t.relatedCatRef) || t.relatedCatRef : null;
  const id = makeId("txn");
  await db
    .prepare(
      "INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount_minor,currency,person_id,category,description,item,quantity,unit,estimated_value_minor,related_cat_id,source_input_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      id,
      owner,
      t.transactionType,
      t.direction,
      t.date || now(),
      amountMinor,
      currency,
      personId,
      t.category,
      t.description,
      t.item,
      t.quantity,
      t.unit,
      estimatedMinor,
      catId,
      inputId,
      now(),
    )
    .run();
  tally.created.push(`transaction:${id}`);
}

/** Applies a validated plan: people, then cats (new or existing), then events, then money. */
export async function execute(db: D1, owner: string, inputId: string, source: string, plan: AgentPlan): Promise<Written> {
  const tally: Tally = { created: [], updated: [] };
  if (plan.intent === "clarify") return { ...tally, message: plan.message, clarification: plan.clarification };
  await checkReferences(db, owner, plan);
  const refs = new Map<string, string>();
  for (const draft of plan.people) await person(db, owner, draft, null, tally);
  for (const c of plan.cats) {
    if (c.existingId) {
      const id = await updateCat(db, owner, c, tally);
      refs.set(c.ref, id);
      refs.set(id, id);
    } else {
      refs.set(c.ref, await createCat(db, owner, c, tally));
    }
  }
  for (const e of plan.events) await writeEvent(db, owner, inputId, source, e, refs, tally);
  for (const t of plan.transactions) await writeTransaction(db, owner, inputId, t, refs, tally);
  return { ...tally, message: plan.socialDraft || plan.message, clarification: plan.clarification };
}
