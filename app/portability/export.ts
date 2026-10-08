// Complete, machine-readable export of everything an owner has: JSON for the whole thing, CSV per record
// type for spreadsheets, and a ZIP that bundles both with the actual photo files. Every query is scoped to
// the signed-in owner. A "shareable" profile leaves out what could hurt someone if it were passed on.
import { all, first, makeId, ManageError, now, type D1, type Row } from "../manage/common";
import type { Resource } from "../manage/http";
import { toCsv } from "./csv";
import { zipStream, type ZipEntry } from "./zip";

export const PROFILES = ["full", "shareable"] as const;
export type Profile = (typeof PROFILES)[number];

/** Tables that belong in an export, in the order they are written. Internal bookkeeping is deliberately absent. */
export const EXPORT_TABLES = ["colonies", "people", "cats", "events", "photos", "transactions", "ai_inputs", "corrections", "record_changes", "merges", "proposed_actions", "clarifications", "clarification_answers", "duplicate_dismissals"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];
/** Left out on purpose: owners, write_requests, write_guards, rescue_revisions, proposal_executions, clarification_resolutions (technical bookkeeping). */
export const CSV_TABLES: ExportTable[] = ["cats", "colonies", "people", "events", "transactions", "photos"];

// The shareable profile is an allow-list, so a column added later stays private until someone chooses to share it.
// Colony places, coordinates, people, contact details, descriptions, notes, health details and photos never appear in it.
const SHAREABLE: Partial<Record<ExportTable, string[]>> = {
  colonies: ["id", "name", "status", "archived_at"],
  cats: ["id", "name", "sex", "age_class", "appearance", "distinguishing_characteristics", "reproductive_significance", "origin_colony_id", "current_status", "created_at", "updated_at", "archived_at"],
  events: ["id", "cat_id", "event_type", "occurred_at", "created_at", "superseded_at", "voided_at"],
  transactions: ["id", "transaction_type", "direction", "date", "amount_minor", "currency", "category", "item", "quantity", "unit", "estimated_value_minor", "related_cat_id", "related_colony_id", "created_at", "superseded_at", "voided_at"],
};

const ORDER: Record<ExportTable, string> = {
  colonies: "created_at,id", people: "created_at,id", cats: "created_at,id", events: "occurred_at,id", photos: "taken_at,id", transactions: "date,id", ai_inputs: "created_at,id",
  corrections: "created_at,id", record_changes: "created_at,rowid", merges: "created_at,id", proposed_actions: "created_at,id", clarifications: "created_at,id", clarification_answers: "created_at,id", duplicate_dismissals: "created_at",
};

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const photoFileName = (row: Row) => { const m = typeof row.storage_location === "string" ? row.storage_location.match(DATA_URL) : null; return m ? `photos/${row.id}.${EXTENSION[m[1]]}` : null; };

export function profileFrom(params: URLSearchParams): Profile {
  const profile = params.get("profile") || "full";
  if (!(PROFILES as readonly string[]).includes(profile)) throw new ManageError("profile must be full or shareable.");
  return profile as Profile;
}

/** Strips ownership, moves photo bytes and queued photo data out of the rows, and applies the profile. */
function shape(table: ExportTable, row: Row, profile: Profile): Row {
  const { owner_id: _owner, ...rest } = row; void _owner;
  if (profile === "shareable") return Object.fromEntries(SHAREABLE[table]!.map((c) => [c, rest[c] ?? null]));
  if (table === "photos") { const { storage_location, ...meta } = rest; return { ...meta, file: photoFileName({ id: rest.id, storage_location }) }; }
  if (table === "clarifications") { const { photo_data, ...meta } = rest; return { ...meta, has_photo: photo_data != null ? 1 : 0 }; }
  return rest;
}

export function tablesFor(profile: Profile): ExportTable[] {
  return profile === "full" ? [...EXPORT_TABLES] : (Object.keys(SHAREABLE) as ExportTable[]);
}

async function loadTable(db: D1, owner: string, table: ExportTable, profile: Profile): Promise<Row[]> {
  const rows = await all(db, `SELECT * FROM ${table} WHERE owner_id=? ORDER BY ${ORDER[table]}`, owner);
  return rows.map((r) => shape(table, r, profile));
}

export async function loadTables(db: D1, owner: string, profile: Profile): Promise<Record<string, Row[]>> {
  const tables: Record<string, Row[]> = {};
  for (const table of tablesFor(profile)) tables[table] = await loadTable(db, owner, table, profile);
  return tables;
}

export const countsOf = (tables: Record<string, Row[]>) => Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));

function columnsOf(rows: Row[], profile: Profile, table: ExportTable): string[] {
  if (profile === "shareable") return SHAREABLE[table]!;
  return rows.length ? Object.keys(rows[0]) : [];
}

export function csvFor(table: ExportTable, rows: Row[], profile: Profile) {
  return toCsv(columnsOf(rows, profile, table), rows);
}

const README = (profile: Profile, exportedAt: string) => `Cat Tracker export
Created ${exportedAt}
Profile: ${profile === "full" ? "full (everything in your account)" : "shareable summary (no places, contacts, notes, people or photos)"}

What is in here
- export.json            Everything, one table per key. Column names match the database.
- csv/*.csv              The main record types as spreadsheets (open in Excel, Numbers or Google Sheets).
${profile === "full" ? "- photos/                Your photo files. csv/photos.csv and export.json link each photo row to its file.\n" : ""}
Reading the data
- Money is stored as whole minor units (cents) in *_minor columns, with a currency code beside it. 2550 USD means $25.50.
- Dates are ISO 8601 (2026-03-31 or 2026-03-31T14:00:00.000Z).
- Records are never deleted when you remove them. Look at archived_at, voided_at and superseded_at to see what is hidden or was replaced.
- Columns that end in _snapshot, plus plan, candidates and similar, contain JSON text.
- Text in CSV cells that starts with = + - or @ has a ' put in front so a spreadsheet can never run it as a formula.
${profile === "full" ? "\nThis file contains personal information (contact details, donors, colony locations). Keep it somewhere private and do not share it as it is.\n" : ""}`;

async function* zipEntries(db: D1, owner: string, profile: Profile, tables: Record<string, Row[]>, exportedAt: string): AsyncGenerator<ZipEntry> {
  const encode = (s: string) => new TextEncoder().encode(s);
  yield { name: "README.txt", data: encode(README(profile, exportedAt)) };
  yield { name: "export.json", data: encode(JSON.stringify(exportDocument(profile, tables, exportedAt), null, 1)) };
  for (const table of CSV_TABLES) if (tables[table]) yield { name: `csv/${table}.csv`, data: encode(csvFor(table, tables[table], profile)) };
  if (profile !== "full") return;
  // Photos are read one at a time so memory stays small however many there are.
  for (const photo of (tables.photos ?? []).filter((p) => p.file)) {
    const row = await first<{ storage_location: string }>(db, "SELECT storage_location FROM photos WHERE id=? AND owner_id=?", String(photo.id), owner);
    const match = row?.storage_location.match(DATA_URL);
    if (!match) continue;
    yield { name: String(photo.file), data: Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)) };
  }
}

export function exportDocument(profile: Profile, tables: Record<string, Row[]>, exportedAt: string) {
  return { format: "catnr-export", version: 1, exportedAt, profile, counts: countsOf(tables), tables };
}

async function logExport(db: D1, owner: string, profile: Profile, format: "zip" | "json" | "csv", counts: Record<string, number>) {
  await db.prepare("INSERT INTO data_exports(id,owner_id,profile,format,counts,created_at) VALUES(?,?,?,?,?,?)").bind(makeId("export"), owner, profile, format, JSON.stringify(counts), now()).run();
}

const stamp = () => now().slice(0, 10);
const HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
const download = (body: BodyInit, type: string, name: string) => new Response(body, { headers: { ...HEADERS, "content-type": type, "content-disposition": `attachment; filename="${name}"` } });

/** With no `download` parameter: what is available, how much, and when the last download happened. */
export async function summary(db: D1, owner: string) {
  const counts = Object.fromEntries(await Promise.all(EXPORT_TABLES.map(async (t) => [t, Number((await first<{ n: number }>(db, `SELECT COUNT(*) n FROM ${t} WHERE owner_id=?`, owner))?.n ?? 0)])));
  const last = await first<{ created_at: string; profile: string }>(db, "SELECT created_at,profile FROM data_exports WHERE owner_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", owner);
  return { counts, lastExport: last ? { at: last.created_at, profile: last.profile } : null, profiles: PROFILES, csvTables: CSV_TABLES };
}

export const resource: Resource = {
  async read(db, owner, url) {
    const kind = url.searchParams.get("download");
    if (!kind) return summary(db, owner);
    const profile = profileFrom(url.searchParams), exportedAt = now();
    if (!["zip", "json", "csv"].includes(kind)) throw new ManageError("download must be zip, json or csv.");
    const tables = await loadTables(db, owner, profile), counts = countsOf(tables);
    if (kind === "json") { await logExport(db, owner, profile, "json", counts); return download(JSON.stringify(exportDocument(profile, tables, exportedAt), null, 1), "application/json; charset=utf-8", `catnr-${profile}-${stamp()}.json`); }
    if (kind === "csv") {
      const table = url.searchParams.get("table") as ExportTable;
      if (!CSV_TABLES.includes(table) || !tables[table]) throw new ManageError(`table must be one of: ${CSV_TABLES.filter((t) => tables[t]).join(", ")}.`);
      await logExport(db, owner, profile, "csv", { [table]: tables[table].length });
      return download(csvFor(table, tables[table], profile), "text/csv; charset=utf-8", `catnr-${table}-${stamp()}.csv`);
    }
    await logExport(db, owner, profile, "zip", counts);
    return download(zipStream(zipEntries(db, owner, profile, tables, exportedAt)), "application/zip", `catnr-${profile}-${stamp()}.zip`);
  },
};
