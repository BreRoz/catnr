// Exact money handling. Amounts are stored and summed as integer minor units (cents) with an
// explicit currency; floating point is never used for stored or summed money. A decimal number is
// accepted only when it is exactly representable in the currency (no silent rounding).

// Must match the seed rows of the `currencies` table (migration 0007); schema tests enforce it.
export const CURRENCY_MINOR_UNITS = { USD: 2, CAD: 2, EUR: 2, GBP: 2, MXN: 2, AUD: 2 } as const;
export type CurrencyCode = keyof typeof CURRENCY_MINOR_UNITS;
export const CURRENCIES = Object.keys(CURRENCY_MINOR_UNITS) as CurrencyCode[];
export const DEFAULT_CURRENCY: CurrencyCode = "USD";

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

export function minorUnitExponent(currency: string): number {
  const exponent = (CURRENCY_MINOR_UNITS as Record<string, number>)[currency];
  if (exponent === undefined) throw new MoneyError(`Unsupported currency ${currency}`);
  return exponent;
}

/** 19.99 -> 1999. Throws instead of rounding when the value has more precision than the currency. */
export function toMinorUnits(value: number, currency: string = DEFAULT_CURRENCY): number {
  const exponent = minorUnitExponent(currency);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new MoneyError("Amount must be a non-negative number");
  const match = /^(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) throw new MoneyError("Amount is not a plain decimal number");
  const fraction = match[2] ?? "";
  if (fraction.length > exponent) throw new MoneyError(`Amount has more than ${exponent} decimal places`);
  const minor = Number(match[1]) * 10 ** exponent + Number(fraction.padEnd(exponent, "0") || "0");
  if (!Number.isSafeInteger(minor)) throw new MoneyError("Amount is too large");
  return minor;
}

/** 1999 -> "19.99" (string arithmetic only, so nothing is rounded). */
export function minorToDecimalString(minor: number, currency: string = DEFAULT_CURRENCY): string {
  const exponent = minorUnitExponent(currency);
  if (!Number.isSafeInteger(minor)) throw new MoneyError("Minor units must be an integer");
  const sign = minor < 0 ? "-" : "";
  if (exponent === 0) return `${sign}${Math.abs(minor)}`;
  const digits = String(Math.abs(minor)).padStart(exponent + 1, "0");
  return `${sign}${digits.slice(0, -exponent)}.${digits.slice(-exponent)}`;
}

/** Display text such as "$129.50" or "CA$5.00"; the currency is always explicit. */
export function formatMoney(minor: number, currency: string = DEFAULT_CURRENCY): string {
  const decimal = minorToDecimalString(minor, currency);
  const exponent = minorUnitExponent(currency);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: exponent,
      maximumFractionDigits: exponent,
    }).format(Number(decimal));
  } catch {
    return `${decimal} ${currency}`;
  }
}

export type MoneyTotal = { currency: string; minor: number };

/** "$10.00 + CA$5.00"; totals in different currencies are never added together. */
export function formatTotals(totals: MoneyTotal[]): string {
  const shown = totals.filter((t) => t.minor !== 0);
  return shown.length ? shown.map((t) => formatMoney(t.minor, t.currency)).join(" + ") : formatMoney(0);
}
