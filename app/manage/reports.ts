import { ManageError, type D1 } from "./common";
import { buildReport } from "../reports/queries";
import { yearPeriod, type Period } from "../reports/definitions";
import type { Resource } from "./http";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (value: string, field: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  if (!DAY.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new ManageError(`${field} must be a real date (YYYY-MM-DD).`);
  return value;
};

/** `?year=2026`, or `?from=&to=` (inclusive days), or neither for all time. */
export function periodFrom(params: URLSearchParams): Period {
  const year = params.get("year"),
    from = params.get("from"),
    to = params.get("to");
  if (year) {
    if (from || to) throw new ManageError("Use either a year or a from/to range, not both.");
    if (!/^\d{4}$/.test(year)) throw new ManageError("Year must be four digits.");
    return yearPeriod(Number(year));
  }
  const period = { from: from ? validDay(from, "From") : null, to: to ? validDay(to, "To") : null };
  if (period.from && period.to && period.from > period.to) throw new ManageError("The start date is after the end date.");
  return period;
}

// Read-only: reports never write, and every number comes from queries over the owner's own records.
export const read: Resource["read"] = (db: D1, owner, url) => buildReport(db, owner, periodFrom(url.searchParams));
