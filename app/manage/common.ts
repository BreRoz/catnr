// Shared plumbing for manual record management (Stage 7). Nothing here calls the AI: Ari can do all of
// this when the assistant is unavailable. Every change is queued as statements and committed in one
// atomic D1 batch together with its audit rows, the retry receipt and the revision guard.
export type D1 = D1Database;
export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- D1 rows are untyped

/** A problem Ari can understand and fix; `status` is the HTTP status it is reported with. */
export class ManageError extends Error {
  constructor(message: string, public status = 400, public outcome = "rejected") { super(message); this.name = "ManageError"; }
}

export const now = () => new Date().toISOString();
export const makeId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

// ---------- input validation ----------
export function text(value: unknown, field: string, max: number, required = false): string | null {
  if (value == null || value === "") { if (required) throw new ManageError(`${field} is required.`); return null; }
  if (typeof value !== "string") throw new ManageError(`${field} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) { if (required) throw new ManageError(`${field} is required.`); return null; }
  if (trimmed.length > max) throw new ManageError(`${field} is too long (limit ${max} characters).`);
  return trimmed;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string, required = false): T | null {
  if (value == null || value === "") { if (required) throw new ManageError(`${field} is required.`); return null; }
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw new ManageError(`${field} must be one of: ${allowed.join(", ")}.`);
  return value as T;
}

export function recordId(value: unknown, field: string, required = false): string | null {
  if (value == null || value === "") { if (required) throw new ManageError(`${field} is required.`); return null; }
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,120}$/.test(value)) throw new ManageError(`${field} is not a valid id.`);
  return value;
}

/** YYYY-MM-DD or a full ISO timestamp. Returned as given (date-only stays date-only). */
export function dateValue(value: unknown, field: string, required = true, nowMs = Date.now()): string | null {
  if (value == null || value === "") { if (required) throw new ManageError(`${field} is required.`); return null; }
  if (typeof value !== "string") throw new ManageError(`${field} must be a date.`);
  const v = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(v), stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v);
  const ms = Date.parse(v);
  // Date-only values must survive a round trip, which rejects impossible days such as 2026-02-31.
  if ((!dateOnly && !stamp) || Number.isNaN(ms) || (dateOnly && new Date(ms).toISOString().slice(0, 10) !== v)) throw new ManageError(`${field} is not a valid date.`);
  if (ms > nowMs + 36 * 3600_000) throw new ManageError(`${field} can’t be in the future.`);
  if (ms < Date.UTC(1990, 0, 1)) throw new ManageError(`${field} is too far in the past.`);
  return v;
}

export function plainDate(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) throw new ManageError(`${field} must be a date like 2026-03-31.`);
  return value;
}

// ---------- paging and search ----------
export const DEFAULT_PAGE_SIZE = 25, MAX_PAGE_SIZE = 100;
export function paging(params: URLSearchParams, defaultSize = DEFAULT_PAGE_SIZE) {
  const int = (name: string, fallback: number) => { const raw = params.get(name); if (raw == null || raw === "") return fallback; const n = Number(raw); return Number.isInteger(n) && n >= 1 ? n : fallback; };
  const pageSize = Math.min(int("pageSize", defaultSize), MAX_PAGE_SIZE), page = Math.min(int("page", 1), 100_000);
  return { page, pageSize, offset: (page - 1) * pageSize };
}
export const pageInfo = (total: number, page: number, pageSize: number) => ({ total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)), hasMore: page * pageSize < total });

/** Escape a user's search word for LIKE ... ESCAPE '\'. Wildcards typed by the user are matched literally. */
export const likeTerm = (word: string) => `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
export function searchTerms(params: URLSearchParams, name = "q"): string[] {
  return (params.get(name) || "").toLowerCase().split(/\s+/).map((w) => w.trim()).filter(Boolean).slice(0, 6).map((w) => w.slice(0, 60));
}
/** Every word must appear in at least one of the columns (case-insensitive). */
export function searchClause(terms: string[], columns: string[]): { sql: string; binds: string[] } {
  if (!terms.length) return { sql: "", binds: [] };
  const binds: string[] = [];
  const parts = terms.map((term) => { for (let i = 0; i < columns.length; i++) binds.push(likeTerm(term)); return `(${columns.map((c) => `LOWER(COALESCE(${c},'')) LIKE ? ESCAPE '\\'`).join(" OR ")})`; });
  return { sql: ` AND ${parts.join(" AND ")}`, binds };
}

export const parseJson = (value: unknown, fallback: unknown) => { try { return typeof value === "string" && value ? JSON.parse(value) : fallback; } catch { return fallback; } };

// ---------- write context ----------
export type Write = { statements: D1PreparedStatement[]; response: Row };
export type Ctx = {
  db: D1; owner: string; now: string;
  stmt(sql: string, ...binds: Array<string | number | null | undefined>): D1PreparedStatement;
  audit(entry: AuditEntry): D1PreparedStatement;
};
export type AuditEntry = { recordType: "cat" | "colony" | "person" | "event" | "transaction" | "photo"; recordId: string; action: "create" | "update" | "archive" | "restore" | "void" | "unvoid" | "replace" | "merge_into" | "merged_from"; reason?: string | null; before?: Row | null; after?: Row | null; mergeId?: string | null };

// Photo bytes are never copied into the audit trail.
const snapshotOf = (row: Row | null | undefined) => { if (!row) return null; const { storage_location: _omit, ...rest } = row; void _omit; return JSON.stringify(rest); };

export function makeCtx(db: D1, owner: string): Ctx {
  const when = now();
  return {
    db, owner, now: when,
    stmt: (sql, ...binds) => db.prepare(sql).bind(...binds.map((b) => (b === undefined ? null : b))),
    audit: (e) => db.prepare("INSERT INTO record_changes(id,owner_id,record_type,record_id,action,made_by,actor_id,reason,before_snapshot,after_snapshot,merge_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(makeId("change"), owner, e.recordType, e.recordId, e.action, "user", owner, e.reason ?? null, snapshotOf(e.before), snapshotOf(e.after), e.mergeId ?? null, when),
  };
}

export const first = async <T = Row>(db: D1, sql: string, ...binds: Array<string | number | null>) => db.prepare(sql).bind(...binds).first<T>();
export const all = async <T = Row>(db: D1, sql: string, ...binds: Array<string | number | null>) => (await db.prepare(sql).bind(...binds).all<T>()).results;

/** Fields that differ, as {field: {from,to}}; used for audit and to reject empty edits. */
export function diff(before: Row, after: Row, fields: string[]) {
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) if ((before[f] ?? null) !== (after[f] ?? null)) changed[f] = { from: before[f] ?? null, to: after[f] ?? null };
  return changed;
}

export const mergedInto = async (db: D1, owner: string, recordType: "cat" | "colony" | "person", id: string) =>
  (await first<{ survivor_id: string }>(db, "SELECT survivor_id FROM merges WHERE owner_id=? AND record_type=? AND merged_id=?", owner, recordType, id))?.survivor_id ?? null;

/** Optimistic concurrency: the caller edited the version it was shown. */
export function checkVersion(row: Row, body: Row, what: string) {
  if (body.version == null) throw new ManageError(`Reload this ${what} before saving changes.`, 400);
  if (Number(body.version) !== Number(row.version)) throw new ManageError(`This ${what} changed since you opened it. Reload it to see the latest version, then make your change again. Nothing was saved.`, 409, "conflict");
}
