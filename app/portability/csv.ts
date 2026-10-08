// Plain CSV in and out. No dependencies; handles what spreadsheets really produce: a UTF-8 byte-order
// mark, comma / semicolon / tab separators, quoted fields with embedded commas and line breaks.

export type ParsedTable = { header: string[]; rows: string[][]; delimiter: string };

const DELIMITERS = [",", ";", "\t"];

/** Picks the separator that appears most in the first line outside quotes. */
function sniff(text: string): string {
  const counts = new Map(DELIMITERS.map((d) => [d, 0]));
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ",";
}

export class CsvError extends Error {}

export function parseCsv(input: string): ParsedTable {
  const text = input.replace(/^\uFEFF/, "");
  const delimiter = sniff(text);
  const records: string[][] = [];
  let field = "", row: string[] = [], quoted = false, i = 0, touched = false;
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); if (touched || row.some((c) => c !== "")) records.push(row); row = []; touched = false; };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === "") { quoted = true; touched = true; i++; continue; }
    if (ch === delimiter) { touched = true; endField(); i++; continue; }
    if (ch === "\r" || ch === "\n") { if (ch === "\r" && text[i + 1] === "\n") i++; endRow(); i++; continue; }
    field += ch; touched = true; i++;
  }
  if (quoted) throw new CsvError("A quoted value is never closed. Check for a stray \" character.");
  if (field !== "" || row.length || touched) endRow();
  // Drop blank lines (a lone empty cell) so trailing newlines and spacer rows don't become records.
  const table = records.filter((r) => r.some((c) => c.trim() !== ""));
  if (!table.length) throw new CsvError("The file is empty.");
  const header = table[0].map((h) => h.trim());
  if (header.every((h) => !h)) throw new CsvError("The first row must be column names.");
  return { header, rows: table.slice(1), delimiter };
}

/** A cell a spreadsheet would treat as a formula. Prefixed so opening the file can never run anything. */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  // Numbers are written as numbers; only text that could be read as a formula gets the guard.
  if (typeof value === "string" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(","));
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
