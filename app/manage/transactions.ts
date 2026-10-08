import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  MoneyError,
  formatMoney,
  formatTotals,
  minorToDecimalString,
  toMinorUnits,
  type MoneyTotal,
} from "../money";
import { INFLOW_TYPES, OUTFLOW_TYPES, TRANSACTION_TYPES } from "./constants";
import {
  ManageError,
  all,
  checkVersion,
  dateValue,
  diff,
  first,
  makeId,
  oneOf,
  pageInfo,
  paging,
  parseJson,
  plainDate,
  recordId,
  searchClause,
  searchTerms,
  text,
  type Ctx,
  type D1,
  type Row,
  type Write,
} from "./common";
import { replaceRecord, setVoided } from "./versioned";

const MAX_MINOR = 100_000_000,
  MAX_QTY = 100_000;

function money(value: unknown, field: string, currency: string, required: boolean): number | null {
  if (value == null || value === "") {
    if (required) throw new ManageError(`${field} is required.`);
    return null;
  }
  let n: number;
  if (typeof value === "string") {
    const s = value.trim().replace(/^\$/, "").replace(/,/g, "");
    if (!/^\d+(\.\d+)?$/.test(s)) throw new ManageError(`${field} must be an amount like 25 or 25.50.`);
    n = Number(s);
  } else if (typeof value === "number") n = value;
  else throw new ManageError(`${field} must be an amount.`);
  try {
    const minor = toMinorUnits(n, currency);
    if (minor > MAX_MINOR) throw new ManageError(`${field} is too large.`);
    return minor;
  } catch (error) {
    if (error instanceof MoneyError) throw new ManageError(`${field}: ${error.message}. Use whole cents, like 25.50.`);
    throw error;
  }
}

async function cleanTransaction(ctx: Ctx, input: Row): Promise<Row> {
  const type = oneOf(input.transactionType, TRANSACTION_TYPES, "Type", true)!;
  let direction = oneOf(input.direction, ["inflow", "outflow"] as const, "Direction");
  const expected = INFLOW_TYPES.has(type) ? "inflow" : OUTFLOW_TYPES.has(type) ? "outflow" : null;
  if (expected && direction && direction !== expected)
    throw new ManageError(`A ${type.replaceAll("_", " ")} is money ${expected === "inflow" ? "coming in" : "going out"}.`);
  direction = (expected ?? direction) as "inflow" | "outflow" | null;
  if (!direction) throw new ManageError("Say whether this is money in or money out.");
  const currency = input.currency == null || input.currency === "" ? DEFAULT_CURRENCY : oneOf(input.currency, CURRENCIES, "Currency")!;
  const inKind = type === "in_kind_donation" || type === "other";
  const amount = money(input.amount, "Amount", currency, !inKind);
  if (amount === 0) throw new ManageError("Amount must be greater than zero.");
  const estimated = money(input.estimatedValue, "Estimated value", currency, false);
  let quantity: number | null = null;
  if (input.quantity != null && input.quantity !== "") {
    quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity < 0 || quantity > MAX_QTY)
      throw new ManageError("Quantity must be a number from 0 to 100000.");
  }
  const linked = async (value: unknown, field: string, table: "people" | "cats" | "colonies") => {
    const id = recordId(value, field);
    if (!id) return null;
    const row = await first(ctx.db, `SELECT id,archived_at FROM ${table} WHERE id=? AND owner_id=?`, id, ctx.owner);
    if (!row) throw new ManageError(`That ${field.toLowerCase()} doesn’t exist.`, 404);
    if (row.archived_at) throw new ManageError(`That ${field.toLowerCase()} is archived. Restore it first or choose another.`, 409);
    return id;
  };
  const description = text(input.description, "Description", 500, true)!;
  return {
    transaction_type: type,
    direction,
    date: dateValue(input.date, "Date"),
    amount_minor: amount,
    currency,
    person_id: await linked(input.personId, "Person", "people"),
    category: text(input.category, "Category", 100),
    description,
    item: text(input.item, "Item", 200),
    quantity,
    unit: text(input.unit, "Unit", 40),
    estimated_value_minor: estimated,
    related_cat_id: await linked(input.relatedCatId, "Cat", "cats"),
    related_colony_id: await linked(input.relatedColonyId, "Colony", "colonies"),
  };
}

const COLUMNS = [
  "transaction_type",
  "direction",
  "date",
  "amount_minor",
  "currency",
  "person_id",
  "category",
  "description",
  "item",
  "quantity",
  "unit",
  "estimated_value_minor",
  "related_cat_id",
  "related_colony_id",
];
const INPUT_KEYS: Record<string, string> = {
  transactionType: "transaction_type",
  direction: "direction",
  date: "date",
  amount: "amount_minor",
  currency: "currency",
  personId: "person_id",
  category: "category",
  description: "description",
  item: "item",
  quantity: "quantity",
  unit: "unit",
  estimatedValue: "estimated_value_minor",
  relatedCatId: "related_cat_id",
  relatedColonyId: "related_colony_id",
};

/** The editable form of a stored row (amounts back to decimals) so a partial edit can be re-validated as a whole. */
function editable(row: Row): Row {
  return {
    transactionType: row.transaction_type,
    direction: row.direction,
    date: row.date,
    currency: row.currency,
    amount: row.amount_minor == null ? null : minorToDecimalString(row.amount_minor, row.currency),
    estimatedValue: row.estimated_value_minor == null ? null : minorToDecimalString(row.estimated_value_minor, row.currency),
    personId: row.person_id,
    category: row.category,
    description: row.description,
    item: row.item,
    quantity: row.quantity,
    unit: row.unit,
    relatedCatId: row.related_cat_id,
    relatedColonyId: row.related_colony_id,
  };
}

export function shapeTransaction(t: Row) {
  return {
    id: t.id,
    version: t.version,
    transactionType: t.transaction_type,
    direction: t.direction,
    date: t.date,
    amountMinor: t.amount_minor,
    currency: t.currency,
    amountText: t.amount_minor == null ? null : formatMoney(t.amount_minor, t.currency),
    personId: t.person_id,
    personName: t.person_name ?? null,
    category: t.category,
    description: t.description,
    item: t.item,
    quantity: t.quantity,
    unit: t.unit,
    estimatedValueMinor: t.estimated_value_minor,
    estimatedValueText: t.estimated_value_minor == null ? null : formatMoney(t.estimated_value_minor, t.currency),
    relatedCatId: t.related_cat_id,
    relatedCatName: t.cat_name ?? null,
    relatedColonyId: t.related_colony_id,
    relatedColonyName: t.colony_name ?? null,
    voidedAt: t.voided_at,
    voidReason: t.void_reason,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    corrected: !!t.corrected,
  };
}

const FROM = `FROM transactions t LEFT JOIN people p ON p.id=t.person_id AND p.owner_id=t.owner_id
  LEFT JOIN cats c ON c.id=t.related_cat_id AND c.owner_id=t.owner_id LEFT JOIN colonies co ON co.id=t.related_colony_id AND co.owner_id=t.owner_id`;

export async function listTransactions(db: D1, owner: string, params: URLSearchParams) {
  const { page, pageSize, offset } = paging(params);
  const where = ["t.owner_id=?", "t.superseded_at IS NULL"],
    binds: Array<string | number> = [owner];
  const eq = (param: string, column: string) => {
    const v = params.get(param);
    if (v) {
      where.push(`${column}=?`);
      binds.push(v);
    }
  };
  eq("type", "t.transaction_type");
  eq("direction", "t.direction");
  eq("currency", "t.currency");
  eq("personId", "t.person_id");
  eq("catId", "t.related_cat_id");
  eq("colonyId", "t.related_colony_id");
  const category = params.get("category");
  if (category) {
    where.push("LOWER(t.category)=LOWER(?)");
    binds.push(category);
  }
  const from = plainDate(params.get("from"), "from"),
    to = plainDate(params.get("to"), "to");
  if (from && to && from > to) throw new ManageError("The start date is after the end date.");
  if (from) {
    where.push("substr(t.date,1,10)>=?");
    binds.push(from);
  }
  if (to) {
    where.push("substr(t.date,1,10)<=?");
    binds.push(to);
  }
  const search = searchClause(searchTerms(params), [
    "t.description",
    "t.item",
    "t.category",
    "t.transaction_type",
    "p.name",
    "c.name",
    "co.name",
  ]);
  const status = params.get("status") || "active";
  if (!["active", "voided", "all"].includes(status)) throw new ManageError("status must be active, voided or all.");
  const base = where.join(" AND ") + search.sql,
    args = [...binds, ...search.binds];
  const shown = base + (status === "active" ? " AND t.voided_at IS NULL" : status === "voided" ? " AND t.voided_at IS NOT NULL" : "");
  const [count, rows, totals] = await Promise.all([
    first<{ n: number }>(db, `SELECT COUNT(*) n ${FROM} WHERE ${shown}`, ...args),
    all(
      db,
      `SELECT t.*,p.name person_name,c.name cat_name,co.name colony_name,
      EXISTS(SELECT 1 FROM corrections k WHERE k.owner_id=t.owner_id AND k.replacement_id=t.id AND k.kind='correction' AND k.status='applied') corrected
      ${FROM} WHERE ${shown} ORDER BY substr(t.date,1,10) DESC, t.created_at DESC, t.id LIMIT ? OFFSET ?`,
      ...args,
      pageSize,
      offset,
    ),
    // Totals describe the filtered, still-active money; voided rows never count.
    all(
      db,
      `SELECT t.direction,t.currency,SUM(t.amount_minor) minor,COUNT(*) n ${FROM} WHERE ${base} AND t.voided_at IS NULL AND t.amount_minor IS NOT NULL GROUP BY t.direction,t.currency ORDER BY t.currency`,
      ...args,
    ),
  ]);
  const pick = (direction: string): MoneyTotal[] =>
    totals.filter((r) => r.direction === direction).map((r) => ({ currency: r.currency, minor: Number(r.minor) }));
  const result: Row = {
    items: rows.map(shapeTransaction),
    ...pageInfo(Number(count?.n || 0), page, pageSize),
    totals: {
      cashIn: pick("inflow"),
      cashOut: pick("outflow"),
      cashInText: formatTotals(pick("inflow")),
      cashOutText: formatTotals(pick("outflow")),
    },
  };
  if (params.get("facets"))
    result.categories = (
      await all(
        db,
        "SELECT DISTINCT category FROM active_transactions WHERE owner_id=? AND category IS NOT NULL ORDER BY LOWER(category) LIMIT 200",
        owner,
      )
    ).map((r) => r.category);
  return result;
}

export async function read(db: D1, owner: string, url: URL) {
  const id = url.searchParams.get("id");
  if (!id) return listTransactions(db, owner, url.searchParams);
  const row = await first(
    db,
    `SELECT t.*,p.name person_name,c.name cat_name,co.name colony_name ${FROM} WHERE t.id=? AND t.owner_id=?`,
    id,
    owner,
  );
  if (!row) throw new ManageError("Transaction not found.", 404);
  const changes = await all(
    db,
    "SELECT id,action,reason,actor_id,before_snapshot,after_snapshot,created_at FROM record_changes WHERE owner_id=? AND record_type='transaction' AND record_id=? ORDER BY created_at DESC, rowid DESC LIMIT 50",
    owner,
    id,
  );
  return {
    transaction: shapeTransaction(row),
    changes: changes.map((c) => ({
      id: c.id,
      action: c.action,
      reason: c.reason,
      actorId: c.actor_id,
      before: parseJson(c.before_snapshot, null),
      after: parseJson(c.after_snapshot, null),
      createdAt: c.created_at,
    })),
  };
}

export async function write(ctx: Ctx, body: Row, method: "POST" | "PATCH"): Promise<Write> {
  const action = typeof body.action === "string" ? body.action : method === "POST" ? "create" : "update";
  if (action === "create") {
    const fields = await cleanTransaction(ctx, (body.transaction ?? body) as Row),
      id = makeId("transaction");
    const row = { id, version: 0, ...fields, created_at: ctx.now };
    return {
      statements: [
        ctx.stmt(
          `INSERT INTO transactions(id,owner_id,${COLUMNS.join(",")},created_at,updated_at) VALUES(?,?,${COLUMNS.map(() => "?").join(",")},?,?)`,
          id,
          ctx.owner,
          ...COLUMNS.map((c) => fields[c] ?? null),
          ctx.now,
          ctx.now,
        ),
        ctx.audit({ recordType: "transaction", recordId: id, action: "create", after: row }),
      ],
      response: { outcome: "saved", id, message: "Recorded." },
    };
  }
  const id = recordId(body.id, "Transaction", true)!;
  const original = await first(ctx.db, "SELECT * FROM transactions WHERE id=? AND owner_id=?", id, ctx.owner);
  if (!original) throw new ManageError("Transaction not found.", 404);
  if (original.superseded_at)
    throw new ManageError("This entry was already replaced by a newer version. Reload to see the current one.", 409, "conflict");
  if (action === "void" || action === "unvoid") {
    const statements = setVoided(ctx, "transaction", original, action, text(body.reason, "Reason", 300));
    return {
      statements,
      response: {
        outcome: "saved",
        id,
        message:
          action === "void"
            ? "Reversed. It no longer counts toward totals, and you can restore it."
            : "Restored. It counts toward totals again.",
      },
    };
  }
  if (action !== "update") throw new ManageError("Unknown action.");
  checkVersion(original, body, "entry");
  if (original.voided_at) throw new ManageError("This entry was reversed. Restore it before editing.", 409);
  const changes = (body.changes ?? {}) as Row;
  for (const k of Object.keys(changes)) if (!(k in INPUT_KEYS)) throw new ManageError(`${k} can’t be edited.`);
  const fields = await cleanTransaction(ctx, { ...editable(original), ...changes });
  if (!Object.keys(diff(original, fields, COLUMNS)).length) throw new ManageError("Nothing changed.");
  const replacementId = makeId("transaction");
  const statements = await replaceRecord(ctx, "transaction", original, replacementId, {
    columns: { ...fields, related_event_id: original.related_event_id },
    reason: text(body.reason, "Reason", 300) ?? "Edited by hand",
  });
  return {
    statements,
    response: { outcome: "saved", id: replacementId, replacedId: id, message: "Saved. The earlier version is kept in the history." },
  };
}
