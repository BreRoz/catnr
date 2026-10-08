import { all, first, type D1 } from "../manage/common";
import { formatTotals, type MoneyTotal } from "../money";
import {
  ASSISTANCE_EVENTS,
  EVENT_ALIASES,
  METRIC_DEFINITIONS,
  NOT_IN_CARE_STATUSES,
  PROCEDURE_EVENTS,
  STERILIZATION_PROCEDURES,
  STERILIZED_EVIDENCE,
  SURGERY_NEEDED_EVENT,
  type Period,
} from "./definitions";

// Every figure is a query over the live (non-superseded, non-voided) records, scoped to one owner.
const ALL_TIME = { from: "0000-01-01", to: "9999-12-31" };
const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(",");
const aliasCase = (expr: string) =>
  `CASE ${expr} ${Object.entries(EVENT_ALIASES)
    .map(([from, to]) => `WHEN '${from}' THEN '${to}'`)
    .join(" ")} ELSE ${expr} END`;
const RAW = "lower(trim(event_type))";
const KIND_RAW = `replace(trim(CASE WHEN instr(${RAW},':')>0 THEN substr(${RAW},1,instr(${RAW},':')-1) ELSE ${RAW} END),' ','_')`;
// One row per active event with a normalized `kind` and the day it happened.
const EVENTS_CTE = `WITH ev AS (SELECT cat_id,${aliasCase(KIND_RAW)} AS kind,substr(occurred_at,1,10) AS day FROM active_events WHERE owner_id=? AND cat_id IS NOT NULL)`;
const IN_PERIOD = "day BETWEEN ? AND ?";

type Count = { n: number };
export type CurrencyTotals = MoneyTotal[];
export type Report = Awaited<ReturnType<typeof buildReport>>;

const byCurrency = (rows: Array<{ currency: string; minor: number | string | null }>): CurrencyTotals =>
  rows
    .filter((r) => r.minor != null)
    .map((r) => ({ currency: r.currency, minor: Number(r.minor) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

/** Integer subtraction per currency; a currency missing on one side counts as zero. */
export function netByCurrency(inflow: CurrencyTotals, outflow: CurrencyTotals): CurrencyTotals {
  const net = new Map<string, number>();
  for (const t of inflow) net.set(t.currency, (net.get(t.currency) ?? 0) + t.minor);
  for (const t of outflow) net.set(t.currency, (net.get(t.currency) ?? 0) - t.minor);
  return [...net].map(([currency, minor]) => ({ currency, minor })).sort((a, b) => a.currency.localeCompare(b.currency));
}

export async function buildReport(db: D1, owner: string, period: Period = { from: null, to: null }) {
  const from = period.from ?? ALL_TIME.from,
    to = period.to ?? ALL_TIME.to;
  const distinctCats = async (kinds: readonly string[]) =>
    (
      await first<Count>(
        db,
        `${EVENTS_CTE} SELECT COUNT(DISTINCT cat_id) n FROM ev WHERE kind IN (${list(kinds)}) AND ${IN_PERIOD}`,
        owner,
        from,
        to,
      )
    )?.n ?? 0;

  const [assisted, captured, sterilized, vaccinated, adopted, returned] = await Promise.all([
    distinctCats(ASSISTANCE_EVENTS),
    distinctCats(["captured"]),
    distinctCats(STERILIZATION_PROCEDURES),
    distinctCats(["vaccination"]),
    distinctCats(["adoption"]),
    distinctCats(["returned_to_colony"]),
  ]);

  const snapshot = await first<{ foster: number; available: number }>(
    db,
    "SELECT COALESCE(SUM(current_status='foster'),0) foster,COALESCE(SUM(current_status='available for adoption'),0) available FROM cats WHERE owner_id=? AND archived_at IS NULL",
    owner,
  );

  const colonies =
    (
      await first<Count>(
        db,
        `${EVENTS_CTE} SELECT COUNT(DISTINCT c.origin_colony_id) n FROM cats c WHERE c.owner_id=? AND c.origin_colony_id IS NOT NULL AND c.id IN (SELECT cat_id FROM ev WHERE kind IN (${list(ASSISTANCE_EVENTS)}) AND ${IN_PERIOD})`,
        owner,
        owner,
        from,
        to,
      )
    )?.n ?? 0;

  const procedureRows = await all<{ kind: string; n: number }>(
    db,
    `${EVENTS_CTE} SELECT kind,COUNT(*) n FROM ev WHERE kind IN (${list([...PROCEDURE_EVENTS, "vet_visit"])}) AND ${IN_PERIOD} GROUP BY kind`,
    owner,
    from,
    to,
  );
  const procedureCount = (kind: string) => procedureRows.find((r) => r.kind === kind)?.n ?? 0;
  const byProcedure = Object.fromEntries(PROCEDURE_EVENTS.map((k) => [k, procedureCount(k)]));

  const surgery = await surgeryStatus(db, owner);

  const cash = await all<{ direction: string; transaction_type: string; currency: string; minor: number; n: number }>(
    db,
    `SELECT direction,transaction_type,currency,SUM(amount_minor) minor,COUNT(*) n FROM active_transactions
     WHERE owner_id=? AND amount_minor IS NOT NULL AND transaction_type<>'in_kind_donation' AND substr(date,1,10) BETWEEN ? AND ?
     GROUP BY direction,transaction_type,currency ORDER BY currency,transaction_type`,
    owner,
    from,
    to,
  );
  const sum = (direction: string): CurrencyTotals => {
    const totals = new Map<string, number>();
    for (const r of cash) if (r.direction === direction) totals.set(r.currency, (totals.get(r.currency) ?? 0) + Number(r.minor));
    return byCurrency([...totals].map(([currency, minor]) => ({ currency, minor })));
  };
  const cashIn = sum("inflow"),
    cashOut = sum("outflow");
  const breakdown = (direction: string) =>
    cash
      .filter((r) => r.direction === direction)
      .map((r) => ({ type: r.transaction_type, currency: r.currency, minor: Number(r.minor), count: r.n }));

  const kind = await all<{ currency: string; value: number | null; n: number; unvalued: number }>(
    db,
    `SELECT currency,SUM(estimated_value_minor) value,COUNT(*) n,SUM(estimated_value_minor IS NULL) unvalued FROM active_transactions
     WHERE owner_id=? AND transaction_type='in_kind_donation' AND substr(date,1,10) BETWEEN ? AND ? GROUP BY currency ORDER BY currency`,
    owner,
    from,
    to,
  );
  const quantities = await all<{ item: string | null; unit: string | null; quantity: number | null; n: number }>(
    db,
    `SELECT COALESCE(item,description) item,unit,SUM(quantity) quantity,COUNT(*) n FROM active_transactions
     WHERE owner_id=? AND transaction_type='in_kind_donation' AND substr(date,1,10) BETWEEN ? AND ? GROUP BY lower(COALESCE(item,description)),lower(COALESCE(unit,'')) ORDER BY 1`,
    owner,
    from,
    to,
  );
  const missingAmount =
    (
      await first<Count>(
        db,
        `SELECT COUNT(*) n FROM active_transactions WHERE owner_id=? AND amount_minor IS NULL AND transaction_type NOT IN ('in_kind_donation','other') AND substr(date,1,10) BETWEEN ? AND ?`,
        owner,
        from,
        to,
      )
    )?.n ?? 0;

  const catsWithoutDate =
    (
      await first<Count>(
        db,
        `${EVENTS_CTE} SELECT COUNT(DISTINCT cat_id) n FROM ev WHERE kind IN (${list(ASSISTANCE_EVENTS)}) AND NOT (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')`,
        owner,
      )
    )?.n ?? 0;

  const estimatedValue = byCurrency(kind.map((r) => ({ currency: r.currency, minor: r.value })));
  const text = (totals: CurrencyTotals) => formatTotals(totals);
  return {
    period: { from: period.from, to: period.to },
    definitions: METRIC_DEFINITIONS,
    cats: { assisted, captured, sterilized, vaccinated, adopted, returnedToColony: returned },
    current: { inFoster: Number(snapshot?.foster ?? 0), availableForAdoption: Number(snapshot?.available ?? 0) },
    coloniesServed: colonies,
    veterinary: {
      procedures: PROCEDURE_EVENTS.reduce((a, k) => a + procedureCount(k), 0),
      byProcedure,
      vetVisits: procedureCount("vet_visit"),
    },
    surgery,
    money: {
      cashIn,
      cashOut,
      net: netByCurrency(cashIn, cashOut),
      cashInText: text(cashIn),
      cashOutText: text(cashOut),
      netText: text(netByCurrency(cashIn, cashOut)),
      cashInByType: breakdown("inflow"),
      cashOutByType: breakdown("outflow"),
      inKind: {
        count: kind.reduce((a, r) => a + r.n, 0),
        withoutEstimate: kind.reduce((a, r) => a + Number(r.unvalued), 0),
        estimatedValue,
        estimatedValueText: estimatedValue.length ? text(estimatedValue) : null,
        quantities: quantities.map((q) => ({ item: q.item, unit: q.unit, quantity: q.quantity, count: q.n })),
      },
    },
    dataQuality: { moneyWithoutAmount: missingAmount, catsWithUndatedEvents: catsWithoutDate },
  };
}

/** Where each cat in care stands on sterilization. Always exactly one of sterilized / needsSurgery / unknown. */
export async function surgeryStatus(db: D1, owner: string) {
  const rows = await all<{ id: string; status: string }>(
    db,
    `${EVENTS_CTE}, evidence AS (SELECT DISTINCT cat_id FROM ev WHERE kind IN (${list(STERILIZED_EVIDENCE)})), need AS (SELECT DISTINCT cat_id FROM ev WHERE kind='${SURGERY_NEEDED_EVENT}')
     SELECT c.id,CASE WHEN c.id IN (SELECT cat_id FROM evidence) THEN 'sterilized' WHEN c.id IN (SELECT cat_id FROM need) THEN 'needs_surgery' ELSE 'unknown' END status
     FROM cats c WHERE c.owner_id=? AND c.archived_at IS NULL AND c.current_status NOT IN (${list(NOT_IN_CARE_STATUSES)}) ORDER BY c.updated_at DESC`,
    owner,
    owner,
  );
  const ids = (status: string) => rows.filter((r) => r.status === status).map((r) => r.id);
  return {
    inCare: rows.length,
    sterilized: ids("sterilized").length,
    needsSurgery: ids("needs_surgery").length,
    unknown: ids("unknown").length,
    needsSurgeryCatIds: ids("needs_surgery"),
    unknownCatIds: ids("unknown"),
  };
}

/** Plain-language lines for the assistant, built from the same report so voice and screen agree. */
export function reportSentences(report: Report, label: string) {
  const c = report.cats,
    v = report.veterinary,
    m = report.money;
  const parts = [
    `${c.assisted} cats assisted`,
    `${c.captured} captured`,
    `${c.sterilized} sterilized`,
    `${c.vaccinated} vaccinated`,
    `${c.adopted} adopted`,
    `${c.returnedToColony} returned to colony`,
    `${report.coloniesServed} colonies served`,
    `${v.procedures} veterinary procedures`,
  ];
  const money = `Cash in ${m.cashInText}, cash out ${m.cashOutText}, net ${m.netText}.`;
  const kind = m.inKind.count
    ? ` In-kind: ${m.inKind.count} donation${m.inKind.count === 1 ? "" : "s"}${m.inKind.estimatedValueText ? `, estimated ${m.inKind.estimatedValueText} (not counted as income)` : ", no estimated value recorded"}.`
    : "";
  return {
    impact: `${label}: ${parts.join(", ")}.`,
    money: `${label}: ${money}${kind} Recorded operational data, not audited accounting.`,
  };
}
