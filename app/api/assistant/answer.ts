import { formatTotals } from "../../money";
import { yearPeriod } from "../../reports/definitions";
import { buildReport, reportSentences, surgeryStatus } from "../../reports/queries";
import { display } from "./cats";
import type { CatRow, D1, QueryDraft, TxnRow } from "./types";

// Answers a question from stored records. Read-only by construction: nothing here writes.

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

async function catsByStatus(db: D1, owner: string, q: QueryDraft) {
  const status = q.status || "available for adoption";
  const rows = (
    await db
      .prepare("SELECT * FROM cats WHERE owner_id=? AND archived_at IS NULL AND current_status=? ORDER BY updated_at DESC")
      .bind(owner, status)
      .all<CatRow>()
  ).results;
  if (!rows.length) return `No cats are currently marked ${status}.`;
  return `${rows.length} cat${plural(rows.length, " is", "s are")} ${status}: ${rows.map(display).join(", ")}.`;
}

async function catHistory(db: D1, owner: string, catId: string) {
  const cat = await db
    .prepare(
      "SELECT c.*,co.name origin FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.id=? AND c.owner_id=?",
    )
    .bind(catId, owner)
    .first<CatRow>();
  if (!cat) return "I couldn’t find that cat.";
  const events = (
    await db
      .prepare("SELECT event_type,occurred_at,notes FROM active_events WHERE owner_id=? AND cat_id=? ORDER BY occurred_at")
      .bind(owner, catId)
      .all<{ event_type: string; occurred_at: string; notes: string | null }>()
  ).results;
  const lines = events.map((e) => `${e.occurred_at.slice(0, 10)}: ${e.event_type}${e.notes ? ` — ${e.notes}` : ""}`).join("\n");
  return `${display(cat)} is currently ${cat.current_status}.\n${lines || "No events recorded yet."}`;
}

async function surgeryNeeds(db: D1, owner: string) {
  const s = await surgeryStatus(db, owner);
  const shown = s.needsSurgeryCatIds.slice(0, 25);
  const rows = shown.length
    ? (
        await db
          .prepare(`SELECT * FROM cats WHERE owner_id=? AND id IN (${shown.map(() => "?").join(",")})`)
          .bind(owner, ...shown)
          .all<CatRow>()
      ).results
    : [];
  const unknown = s.unknown
    ? ` ${s.unknown} more ${plural(s.unknown, "has", "have")} unknown surgery history, which is not the same as needing surgery.`
    : "";
  if (!s.needsSurgery) return `No cats have a recorded need for surgery.${unknown}`;
  const more = s.needsSurgery > shown.length ? ` and ${s.needsSurgery - shown.length} more` : "";
  return `${s.needsSurgery} cat${plural(s.needsSurgery, " has", "s have")} a confirmed need for surgery: ${rows.map(display).join(", ")}${more}.${unknown}`;
}

async function catsByColony(db: D1, owner: string, q: QueryDraft) {
  const like = `%${q.search || ""}%`;
  const rows = (
    await db
      .prepare(
        "SELECT c.* FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id WHERE c.owner_id=? AND c.archived_at IS NULL AND LOWER(co.name) LIKE LOWER(?)",
      )
      .bind(owner, like)
      .all<CatRow>()
  ).results;
  return `${rows.length} cats found: ${rows.map(display).join(", ") || "none"}.`;
}

/** Cash and in-kind value are never added together: cash nets in/out per currency, in-kind is an estimate on its own. */
async function matchingTransactions(db: D1, owner: string, q: QueryDraft) {
  const like = `%${q.search || ""}%`;
  const rows = (
    await db
      .prepare(
        "SELECT t.*,p.name person_name FROM active_transactions t LEFT JOIN people p ON p.id=t.person_id AND p.owner_id=t.owner_id WHERE t.owner_id=? AND (LOWER(t.description) LIKE LOWER(?) OR LOWER(COALESCE(t.category,'')) LIKE LOWER(?) OR LOWER(COALESCE(p.name,'')) LIKE LOWER(?)) ORDER BY t.date DESC LIMIT 50",
      )
      .bind(owner, like, like, like)
      .all<TxnRow>()
  ).results;
  const cash = new Map<string, number>();
  const estimated = new Map<string, number>();
  for (const r of rows) {
    if (r.transaction_type === "in_kind_donation") {
      if (r.estimated_value_minor != null) estimated.set(r.currency, (estimated.get(r.currency) || 0) + Number(r.estimated_value_minor));
    } else if (r.amount_minor != null) {
      const sign = r.direction === "outflow" ? -1 : 1;
      cash.set(r.currency, (cash.get(r.currency) || 0) + sign * Number(r.amount_minor));
    }
  }
  const totals = (m: Map<string, number>) => formatTotals([...m].map(([currency, minor]) => ({ currency, minor })));
  const inKind = estimated.size ? `; in-kind estimated value ${totals(estimated)} (not cash)` : "";
  return `${rows.length} matching resource records. Net cash ${totals(cash)}${inKind}.`;
}

export async function answer(db: D1, owner: string, q: QueryDraft): Promise<string> {
  const year = q.year || new Date().getUTCFullYear();
  switch (q.kind) {
    case "cats_by_status":
      return catsByStatus(db, owner, q);
    case "cat_history":
      if (q.catId) return catHistory(db, owner, q.catId);
      break;
    case "income_expenses":
    case "impact": {
      const sentences = reportSentences(await buildReport(db, owner, yearPeriod(year)), String(year));
      return q.kind === "impact" ? sentences.impact : sentences.money;
    }
    case "cats_needing_surgery":
      return surgeryNeeds(db, owner);
    case "cats_by_colony":
      return catsByColony(db, owner, q);
    case "transactions":
      return matchingTransactions(db, owner, q);
  }
  return "I couldn’t turn that into a database question yet.";
}
