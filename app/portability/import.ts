// Import from a spreadsheet (saved or pasted as CSV). Every row goes through the same planner and the
// same validation as adding that record by hand, so an imported cat cannot be anything a typed one
// could not. A preview runs the whole import without writing anything; the real import writes all of
// it in one atomic batch (or none of it), and every created record carries an audit entry saying which
// file it came from. Rows that are already in the records are skipped, so importing a file twice is safe.
import { toMinorUnits } from "../money";
import { ManageError, all, makeCtx, oneOf, type Ctx, type D1, type Row } from "../manage/common";
import { applyWrite, type Resource } from "../manage/http";
import { write as writeCat } from "../manage/cats";
import { write as writeColony } from "../manage/colonies";
import { write as writeEvent } from "../manage/events";
import { write as writePerson } from "../manage/people";
import { write as writeTransaction } from "../manage/transactions";
import { flagOn } from "../ops/limits";
import { CsvError, parseCsv, toCsv } from "./csv";

export const IMPORT_KINDS = ["cats", "colonies", "people", "events", "transactions"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
/** Kept low on purpose: each row costs a few database lookups, and one request has a lookup budget. */
export const MAX_IMPORT_ROWS = 200;
export const MAX_IMPORT_CHARS = 1_500_000;

type Spec = { label: string; fields: Record<string, { label: string; aliases: string[] }>; required: string[]; template: string[] };
const f = (label: string, ...aliases: string[]) => ({ label, aliases });

const SPECS: Record<ImportKind, Spec> = {
  cats: {
    label: "Cats", required: [],
    fields: {
      name: f("Name", "name", "catname"), sex: f("Sex", "sex", "gender"), ageClass: f("Age", "ageclass", "age", "agegroup", "lifestage"),
      appearance: f("Appearance", "appearance", "description", "color", "colour", "coat"),
      distinguishingCharacteristics: f("Distinguishing marks", "distinguishingcharacteristics", "distinguishing", "markings", "features"),
      healthObservations: f("Health notes", "healthobservations", "health", "healthnotes"),
      reproductiveSignificance: f("Reproductive notes", "reproductivesignificance", "reproductive", "reproductivestatus", "spayneuterstatus"),
      currentStatus: f("Status", "currentstatus", "status"), currentLocation: f("Location", "currentlocation", "location"),
      microchipNumber: f("Microchip", "microchipnumber", "microchip", "chip", "chipnumber"), colony: f("Colony (by name)", "colony", "origincolony", "colonyname"),
    },
    template: ["name", "sex", "age", "appearance", "status", "location", "microchip", "colony"],
  },
  colonies: {
    label: "Colonies", required: ["name"],
    fields: { name: f("Name", "name", "colony", "colonyname"), generalLocation: f("Location", "generallocation", "location", "address", "area"), notes: f("Notes", "notes", "note"), status: f("Status", "status"), latitude: f("Latitude", "latitude", "lat"), longitude: f("Longitude", "longitude", "lng", "lon", "long") },
    template: ["name", "location", "notes", "status"],
  },
  people: {
    label: "People", required: ["name"],
    fields: { name: f("Name", "name", "fullname", "person"), type: f("Type", "type", "role", "persontype"), generalLocation: f("Location", "generallocation", "location", "city", "area"), contact: f("Contact", "contact", "phone", "email", "phonenumber"), notes: f("Notes", "notes", "note") },
    template: ["name", "type", "contact", "location", "notes"],
  },
  events: {
    label: "History entries", required: ["eventType", "occurredAt"],
    fields: {
      catId: f("Cat id", "catid"), cat: f("Cat (by name)", "cat", "catname"), microchip: f("Cat (by microchip)", "microchip", "microchipnumber", "chip"),
      eventType: f("Type", "eventtype", "type", "event"), occurredAt: f("Date", "occurredat", "date", "eventdate", "when"),
      location: f("Location", "location", "where"), notes: f("Notes", "notes", "note"), person: f("Person (by name)", "person", "who", "vet", "foster", "adopter"),
    },
    template: ["cat", "type", "date", "location", "notes", "person"],
  },
  transactions: {
    label: "Money and donations", required: ["transactionType", "date"],
    fields: {
      date: f("Date", "date", "transactiondate"), transactionType: f("Type", "transactiontype", "type", "kind"), direction: f("Direction", "direction"),
      amount: f("Amount", "amount", "total", "cash"), currency: f("Currency", "currency"), description: f("Description", "description", "memo", "details", "note", "notes"),
      person: f("Person (by name)", "person", "donor", "from", "payee", "vendor", "source"), category: f("Category", "category"), item: f("Item", "item"),
      quantity: f("Quantity", "quantity", "qty"), unit: f("Unit", "unit"), estimatedValue: f("Estimated value", "estimatedvalue", "value"),
      cat: f("Cat (by name)", "cat", "relatedcat", "catname"), colony: f("Colony (by name)", "colony", "relatedcolony"),
    },
    template: ["date", "type", "amount", "description", "person", "category"],
  },
};

const norm = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");
const lower = (s: unknown) => String(s ?? "").trim().toLowerCase();
const slug = (s: string) => s.trim().toLowerCase().replace(/[\s\-/]+/g, "_");
const SEX: Record<string, string> = { f: "female", female: "female", m: "male", male: "male", u: "unknown", unknown: "unknown" };
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();

/** 3/31/2026 → 2026-03-31 (US order, as spreadsheets in the US write it). Anything else is left for the normal date check. */
export function importDate(value: string): string {
  const m = value.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : value.trim();
}

export type RowStatus = "ready" | "duplicate" | "error";
export type RowResult = { row: number; status: RowStatus; label: string; problem?: string };
type Lookups = { cats: Row[]; colonies: Row[]; people: Row[]; chips: Set<string>; keys: Set<string> };

async function lookups(db: D1, owner: string, kind: ImportKind): Promise<Lookups> {
  const need = (...k: ImportKind[]) => k.includes(kind);
  const [cats, colonies, people] = await Promise.all([
    need("cats", "events", "transactions") ? all(db, "SELECT id,name,microchip_number,archived_at FROM cats WHERE owner_id=?", owner) : [],
    need("cats", "colonies", "transactions") ? all(db, "SELECT id,name,archived_at FROM colonies WHERE owner_id=?", owner) : [],
    need("people", "events", "transactions") ? all(db, "SELECT id,name,archived_at FROM people WHERE owner_id=?", owner) : [],
  ]);
  const keys = new Set<string>();
  if (kind === "cats") for (const c of cats) if (!c.archived_at && c.name) keys.add(`name:${lower(c.name)}`);
  if (kind === "colonies") for (const c of colonies) if (!c.archived_at) keys.add(`name:${lower(c.name)}`);
  if (kind === "people") for (const p of people) if (!p.archived_at) keys.add(`name:${lower(p.name)}`);
  if (kind === "events") for (const e of await all(db, "SELECT cat_id,event_type,substr(occurred_at,1,10) day FROM active_events WHERE owner_id=? AND cat_id IS NOT NULL", owner)) keys.add(`${e.cat_id}|${e.event_type}|${e.day}`);
  if (kind === "transactions") for (const t of await all(db, "SELECT transaction_type,substr(date,1,10) day,amount_minor,description FROM active_transactions WHERE owner_id=?", owner)) keys.add(`${t.day}|${t.transaction_type}|${t.amount_minor ?? ""}|${lower(t.description)}`);
  return { cats, colonies, people, chips: new Set(cats.map((c) => c.microchip_number).filter(Boolean)), keys };
}

const byName = (rows: Row[], name: string, what: string, hint: string) => {
  const hits = rows.filter((r) => !r.archived_at && lower(r.name) === lower(name));
  if (!hits.length) throw new ManageError(`No ${what} called “${name}”. ${hint}`);
  if (hits.length > 1) throw new ManageError(`More than one ${what} is called “${name}”. ${what === "cat" ? "Use the microchip number instead." : "Rename one of them first."}`);
  return hits[0].id as string;
};

type Prepared = { body: Row; label: string; key?: string; keys?: string[] };

function prepare(kind: ImportKind, v: Record<string, string>, env: Lookups): Prepared {
  const body: Row = {};
  for (const [k, raw] of Object.entries(v)) if (raw !== "") body[k] = raw;
  if (kind === "cats") {
    if (body.sex) body.sex = SEX[lower(body.sex)] ?? lower(body.sex);
    if (body.ageClass) body.ageClass = lower(body.ageClass);
    if (body.currentStatus) body.currentStatus = lower(body.currentStatus).replace(/\s+/g, " ");
    if (body.colony) body.originColonyId = byName(env.colonies, body.colony, "colony", "Import the colony first, or leave this blank.");
    delete body.colony;
    const chip = body.microchipNumber ? String(body.microchipNumber).replace(/[\s-]+/g, "").toUpperCase() : null;
    const label = String(body.name || body.appearance || body.distinguishingCharacteristics || chip || "Unnamed cat");
    const keys = [chip && `chip:${chip}`, body.name && `name:${lower(body.name)}`].filter(Boolean) as string[];
    return { body, label, keys };
  }
  if (kind === "colonies") {
    if (body.status) body.status = lower(body.status);
    return { body, label: String(body.name ?? "Colony"), keys: body.name ? [`name:${lower(body.name)}`] : [] };
  }
  if (kind === "people") {
    if (body.type) body.type = slug(body.type);
    return { body, label: String(body.name ?? "Person"), keys: body.name ? [`name:${lower(body.name)}`] : [] };
  }
  if (kind === "events") {
    const live = env.cats.filter((c) => !c.archived_at);
    if (body.catId) { if (!live.some((c) => c.id === body.catId)) throw new ManageError("That cat id isn’t in your records."); }
    else if (body.microchip) {
      const chip = String(body.microchip).replace(/[\s-]+/g, "").toUpperCase(), hit = live.find((c) => c.microchip_number === chip);
      if (!hit) throw new ManageError(`No cat has microchip ${chip}.`);
      body.catId = hit.id;
    } else if (body.cat) body.catId = byName(live, body.cat, "cat", "Add the cat first (import cats before their history), or use the microchip number.");
    else throw new ManageError("Say which cat this is: a cat name, microchip number or cat id.");
    if (body.person) body.personId = byName(env.people, body.person, "person", "Import people first, or leave this blank.");
    if (body.eventType) body.eventType = slug(body.eventType);
    if (body.occurredAt) body.occurredAt = importDate(body.occurredAt);
    for (const k of ["cat", "microchip", "person"]) delete body[k];
    body.keepStatus = true; // history from a spreadsheet records what happened; it does not change where a cat is today
    const label = `${body.eventType ?? "entry"} · ${live.find((c) => c.id === body.catId)?.name ?? "cat"} · ${body.occurredAt ?? "no date"}`;
    return { body, label, keys: [`${body.catId}|${body.eventType}|${String(body.occurredAt ?? "").slice(0, 10)}`] };
  }
  // transactions
  if (body.transactionType) body.transactionType = slug(body.transactionType);
  if (body.direction) body.direction = lower(body.direction).replace(/^(in|income|received)$/, "inflow").replace(/^(out|expense|spent)$/, "outflow");
  if (body.date) body.date = importDate(body.date);
  if (body.currency) body.currency = body.currency.toUpperCase();
  if (body.person) body.personId = byName(env.people, body.person, "person", "Import people first, or leave this blank.");
  if (body.cat) body.relatedCatId = byName(env.cats, body.cat, "cat", "Add the cat first, or leave this blank.");
  if (body.colony) body.relatedColonyId = byName(env.colonies, body.colony, "colony", "Import the colony first, or leave this blank.");
  for (const k of ["person", "cat", "colony"]) delete body[k];
  body.description ??= body.item;
  let minor = "";
  try { if (body.amount) minor = String(toMinorUnits(Number(String(body.amount).replace(/^\$/, "").replace(/,/g, "")), String(body.currency ?? "USD"))); } catch { /* the normal amount check reports it */ }
  return { body, label: `${body.date ?? "no date"} · ${body.description ?? body.transactionType ?? "entry"}${body.amount ? ` · ${body.amount}` : ""}`, keys: [`${String(body.date ?? "").slice(0, 10)}|${body.transactionType}|${minor}|${lower(body.description)}`] };
}

const WRITERS = { cats: writeCat, colonies: writeColony, people: writePerson, events: writeEvent, transactions: writeTransaction };

export type ImportReport = ReturnType<typeof summarize>;
function summarize(kind: ImportKind, delimiter: string, columns: { recognized: Array<{ column: string; field: string }>; ignored: string[]; missing: string[] }, rows: RowResult[], errorCsv: string, filename: string | null) {
  const count = (s: RowStatus) => rows.filter((r) => r.status === s).length;
  const ready = count("ready"), errors = count("error");
  return {
    kind, filename, delimiter: delimiter === "\t" ? "tab" : delimiter, rowCount: rows.length, columns, rows,
    summary: { ready, duplicates: count("duplicate"), errors },
    canImport: !columns.missing.length && ready > 0,
    errorCsv: errors || count("duplicate") ? errorCsv : null,
  };
}

export async function planImport(ctx: Ctx, body: Row) {
  const kind = oneOf(body.kind, IMPORT_KINDS, "What you are importing", true)!, spec = SPECS[kind];
  if (typeof body.csv !== "string" || !body.csv.trim()) throw new ManageError("Choose a file or paste your spreadsheet rows.");
  if (body.csv.length > MAX_IMPORT_CHARS) throw new ManageError("That file is too large. Split it into smaller files and import them one at a time.", 413);
  const filename = typeof body.filename === "string" && body.filename.trim() ? clean(body.filename).slice(0, 100) : null;
  let table;
  try { table = parseCsv(body.csv); } catch (error) { if (error instanceof CsvError) throw new ManageError(error.message); throw error; }
  if (table.rows.length > MAX_IMPORT_ROWS) throw new ManageError(`That file has ${table.rows.length} rows. Import up to ${MAX_IMPORT_ROWS} at a time.`);
  if (table.header.length > 60) throw new ManageError("That file has too many columns.");

  // Which spreadsheet column feeds which field.
  const fieldOf = new Map<number, string>(), used = new Set<string>(), ignored: string[] = [];
  table.header.forEach((h, i) => {
    const key = Object.entries(spec.fields).find(([k, d]) => !used.has(k) && d.aliases.includes(norm(h)))?.[0];
    if (key) { fieldOf.set(i, key); used.add(key); } else if (h) ignored.push(h);
  });
  const columns = { recognized: [...fieldOf].map(([i, k]) => ({ column: table.header[i], field: spec.fields[k].label })), ignored, missing: spec.required.filter((k) => !used.has(k)).map((k) => spec.fields[k].label) };
  if (kind === "cats" && !used.size) columns.missing.push("at least one cat column (for example Name or Appearance)");

  const env = await lookups(ctx.db, ctx.owner, kind), seen = new Set<string>();
  const note = `Imported from ${filename ?? "a pasted spreadsheet"}`;
  const audited: Ctx = { ...ctx, audit: (e) => ctx.audit({ ...e, reason: e.reason ?? note }) };
  const results: RowResult[] = [], statements: D1PreparedStatement[] = [], problems: string[][] = [];
  for (let i = 0; i < table.rows.length; i++) {
    const cells = table.rows[i], rowNumber = i + 2;
    const result: RowResult = { row: rowNumber, status: "ready", label: "" };
    const extra = cells.slice(table.header.length).some((c) => c.trim());
    const values: Record<string, string> = {};
    for (const [index, key] of fieldOf) values[key] = clean(cells[index] ?? "");
    try {
      if (extra) throw new ManageError("This row has more cells than the header has columns (check for an unquoted comma).");
      const prepared = prepare(kind, values, env);
      result.label = prepared.label;
      const dupKey = prepared.keys?.find((k) => (k.startsWith("chip:") ? env.chips.has(k.slice(5)) : env.keys.has(k)) || seen.has(k));
      if (dupKey) {
        result.status = "duplicate";
        result.problem = seen.has(dupKey) ? "Repeated earlier in this file, so it was skipped." : "Already in your records, so it was skipped.";
      } else {
        const plan = await WRITERS[kind](audited, prepared.body, "POST");
        statements.push(...plan.statements);
        for (const k of prepared.keys ?? []) seen.add(k);
      }
    } catch (error) {
      if (!(error instanceof ManageError)) throw error;
      result.status = "error"; result.problem = error.message;
    }
    results.push(result);
    if (result.status !== "ready") problems.push([String(rowNumber), result.status === "error" ? "problem" : "skipped", result.problem ?? "", ...table.header.map((_, c) => cells[c] ?? "")]);
  }
  const names = table.header.map((h, i) => h || `column ${i + 1}`), reportColumns = ["row", "result", "reason", ...names];
  const errorCsv = toCsv(reportColumns, problems.map((p) => Object.fromEntries(p.map((v, i) => [reportColumns[i], v]))));
  return { report: summarize(kind, table.delimiter, columns, results, errorCsv, filename), statements };
}

const guide = () => ({
  kinds: IMPORT_KINDS.map((k) => ({ kind: k, label: SPECS[k].label, required: SPECS[k].required.map((r) => SPECS[k].fields[r].label), columns: Object.values(SPECS[k].fields).map((d) => d.label), template: toCsv(SPECS[k].template, []) })),
  maxRows: MAX_IMPORT_ROWS,
  notes: [
    "Save your spreadsheet as CSV (File → Download → CSV in Google Sheets, File → Save As → CSV in Excel), or paste the rows.",
    "Dates can be 2026-03-31 or 3/31/2026 (month first).",
    "Import people, colonies and cats before the history and money that refer to them.",
    "Imported history does not change a cat’s current status.",
    "Rows already in your records are skipped, so importing a file twice is safe.",
  ],
  photos: "Photos are added to a cat from its page. Photo files are not imported in bulk, and a photo’s EXIF details (date, GPS position) are deliberately not read: photos are shrunk on your device before upload, which removes them, and that keeps a colony’s location from riding along inside a picture.",
});

export const resource: Resource = {
  read: async () => guide(),
  async post(db, owner, body) {
    if (body.mode === "commit" && !await flagOn(db, "imports")) throw new ManageError("Importing is switched off for now. Nothing was imported.", 503, "rejected");
    if (body.mode === "preview") {
      const { report } = await planImport(makeCtx(db, owner), body);
      return { outcome: "preview", ...report };
    }
    if (body.mode !== "commit") throw new ManageError("Say whether to preview or import.");
    return applyWrite(db, owner, body, "POST", async (ctx, payload) => {
      const { report, statements } = await planImport(ctx, payload);
      if (report.columns.missing.length) throw new ManageError(`The file needs a column for: ${report.columns.missing.join(", ")}.`);
      if (report.summary.errors && payload.skipInvalid !== true) throw new ManageError(`${report.summary.errors} row${report.summary.errors === 1 ? " has a problem" : "s have problems"}, so nothing was imported. Fix them, or choose to skip them.`);
      if (!statements.length) throw new ManageError("There is nothing new to import: every row is already in your records or has a problem.");
      if (statements.length > 900) throw new ManageError("That import is too large to save safely at once. Split the file.");
      const { ready, duplicates, errors } = report.summary;
      return { statements, response: { outcome: "saved", imported: ready, skippedDuplicates: duplicates, skippedInvalid: errors, message: `Imported ${ready} row${ready === 1 ? "" : "s"}${duplicates ? `; ${duplicates} already there` : ""}${errors ? `; ${errors} skipped because of problems` : ""}.` } };
    });
  },
};
