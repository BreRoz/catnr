import { EVENT_ALIASES } from "../reports/definitions";

// The weekly "Roll Call" share image: everything that decides WHAT the image says lives here as pure
// functions (no DOM, no network), so it can be tested against sample data. roll-call-image.ts only draws.

export type RollCallCat = {
  id: string;
  name?: string | null;
  appearance?: string | null;
  distinguishing_characteristics?: string | null;
  current_status?: string | null;
  archived_at?: string | null;
};
export type RollCallEvent = {
  id?: string;
  cat_id?: string | null;
  event_type: string;
  occurred_at: string;
  created_at?: string | null;
  superseded_at?: string | null;
  voided_at?: string | null;
};
export type RollCallPhoto = { id: string; cat_id?: string | null; taken_at?: string | null; archived_at?: string | null };
export type RollCallData = { cats: RollCallCat[]; events: RollCallEvent[]; photos?: RollCallPhoto[] };
export type RollCallRange = { start: string; end: string };

export type RollCallTile = { label: string; status: string; photoUrl: string | null };
export type RollCallStat = { value: number; label: string };
export type RollCall = {
  dateLabel: string;
  headline: [string, string];
  cats: RollCallTile[];
  stats: RollCallStat[];
  needVet: number;
};

const blank = (v: string | null | undefined) => v == null || v === "";
const live = (row: { archived_at?: string | null; superseded_at?: string | null; voided_at?: string | null }) =>
  blank(row.archived_at) && blank(row.superseded_at) && blank(row.voided_at);

/** "Neuter: mild swelling" → "neuter", "Capture" → "captured": the same normalisation the Reports screen uses. */
export function eventKind(type: string): string {
  const raw = type.trim().toLowerCase();
  const kind = raw.split(":")[0].trim().replaceAll(" ", "_");
  return EVENT_ALIASES[kind] ?? kind;
}

// ---- time frames -------------------------------------------------------------------------------

export type TimeFrame = "7d" | "30d" | "month" | "custom";
const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const realDay = (v: string) => DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && isoDay(new Date(`${v}T00:00:00Z`)) === v;

/** Turns the chosen time frame into an inclusive day range. `today` is the user's local day (YYYY-MM-DD). */
export function resolveRange(frame: TimeFrame, today: string, custom?: { start: string; end: string }): RollCallRange {
  if (frame === "7d") return { start: addDays(today, -6), end: today };
  if (frame === "30d") return { start: addDays(today, -29), end: today };
  if (frame === "month") return { start: `${today.slice(0, 8)}01`, end: today };
  if (!custom || !realDay(custom.start) || !realDay(custom.end)) throw new Error("Pick a start and end date.");
  if (custom.start > custom.end) throw new Error("The start date is after the end date.");
  return { start: custom.start, end: custom.end };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const parts = (day: string) => ({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) - 1, d: Number(day.slice(8, 10)) });

/** Same month → "Oct 1–9, 2026"; different months → "Sep 28 – Oct 4, 2026"; different years show both years. */
export function dateLabel({ start, end }: RollCallRange): string {
  const a = parts(start),
    b = parts(end);
  if (start === end) return `${MONTHS[a.m]} ${a.d}, ${a.y}`;
  if (a.y !== b.y) return `${MONTHS[a.m]} ${a.d}, ${a.y} – ${MONTHS[b.m]} ${b.d}, ${b.y}`;
  if (a.m === b.m) return `${MONTHS[a.m]} ${a.d}–${b.d}, ${a.y}`;
  return `${MONTHS[a.m]} ${a.d} – ${MONTHS[b.m]} ${b.d}, ${a.y}`;
}

/** The README fixes the headline copy, and "this week" would be wrong for a longer window. */
function headline(range: RollCallRange): [string, string] {
  const days = (Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86_400_000 + 1;
  const when = days <= 7 ? "this week" : days <= 31 ? "this month" : "lately";
  return ["Meet the cats", `we're helping ${when}.`];
}

// ---- labels and statuses -----------------------------------------------------------------------

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_, sep, c) => sep + c.toUpperCase());
const firstClause = (s: string) => s.split(/[;,(]|\swith\s/i)[0].trim();

/** A short word or two for telling look-alike cats apart: "missing one leg (three-legged)" → "3-leg". */
function trait(c: RollCallCat): string | null {
  const text = (c.distinguishing_characteristics ?? "").trim();
  if (!text) return null;
  if (/(three|3)[\s-]*leg/i.test(text)) return "3-leg";
  const clause = text
    .split(/[;,]/)[0]
    .replace(/\(.*?\)/g, "")
    .trim();
  return clause ? clause.split(/\s+/).slice(0, 2).join(" ") : null;
}

function baseLabel(c: RollCallCat): string {
  if (!blank(c.name?.trim())) return c.name!.trim();
  const clause = firstClause(c.appearance ?? "");
  return clause ? titleCase(clause) : "Unnamed cat";
}

/** Label rule from the README. Cats that would share a label get their first distinguishing trait added. */
export function catLabels(cats: RollCallCat[]): Map<string, string> {
  const base = new Map(cats.map((c) => [c.id, baseLabel(c)]));
  const counts = new Map<string, number>();
  for (const l of base.values()) counts.set(l, (counts.get(l) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const c of cats) {
    const label = base.get(c.id)!;
    const t = (counts.get(label) ?? 0) > 1 && blank(c.name?.trim()) ? trait(c) : null;
    out.set(c.id, t ? `${label}, ${t}` : label);
  }
  return out;
}

const STATUS_NAMES: Record<string, { text: string; rank: number }> = {
  adopted: { text: "Adopted", rank: 0 },
  "available for adoption": { text: "Up for adoption", rank: 1 },
  spayed: { text: "Spayed/neutered", rank: 2 },
  neutered: { text: "Spayed/neutered", rank: 2 },
  "awaiting vet": { text: "Awaiting vet", rank: 3 },
  captured: { text: "Trapped", rank: 4 },
};
const statusOf = (raw: string | null | undefined) => {
  const key = (raw ?? "").trim().toLowerCase();
  return STATUS_NAMES[key] ?? { text: key ? titleCase(key) : "Seen", rank: 5 };
};

// ---- grid --------------------------------------------------------------------------------------

export type Grid = { cols: number; rows: number; cells: number; variant: string; shown: number; more: number };
const GRIDS: Array<[number, number, number, string]> = [
  [2, 2, 1, "2a"],
  [4, 2, 2, "2b"],
  [6, 3, 2, "2c"],
  [8, 4, 2, "2d"],
  [10, 5, 2, "1c"],
  [15, 5, 3, "5x3"],
];

/** Grid for a cat count (README "Grid rules by cat count"). 0 cats has no grid. 16+ shows 14 cats and a "+N more" tile. */
export function pickGrid(count: number): Grid | null {
  if (!Number.isInteger(count) || count < 1) return null;
  const hit = GRIDS.find(([max]) => count <= max);
  if (hit) return { cols: hit[1], rows: hit[2], cells: hit[1] * hit[2], variant: hit[3], shown: count, more: 0 };
  return { cols: 5, rows: 3, cells: 15, variant: "5x3", shown: 14, more: count - 14 };
}

// ---- the report --------------------------------------------------------------------------------

/** All numbers and tiles for the image, from the owner's rows. `cats` is empty when nothing happened in the range. */
export function buildRollCall(data: RollCallData, range: RollCallRange): RollCall {
  const events = data.events.filter(
    (e) => live(e) && e.cat_id && e.occurred_at.slice(0, 10) >= range.start && e.occurred_at.slice(0, 10) <= range.end,
  );
  const catsById = new Map(data.cats.filter(live).map((c) => [c.id, c]));
  // Events on archived or unknown cats are ignored entirely, so they cannot inflate any stat.
  const inRange = events.filter((e) => catsById.has(e.cat_id!));

  const latest = new Map<string, string>();
  for (const e of inRange) {
    const stamp = `${e.occurred_at}|${e.created_at ?? ""}`;
    if (stamp > (latest.get(e.cat_id!) ?? "")) latest.set(e.cat_id!, stamp);
  }
  const shown = [...latest.keys()].map((id) => catsById.get(id)!);

  const photo = new Map<string, RollCallPhoto>();
  for (const p of data.photos ?? [])
    if (live(p) && p.cat_id && (p.taken_at ?? "") >= (photo.get(p.cat_id)?.taken_at ?? "")) photo.set(p.cat_id, p);

  const labels = catLabels(shown);
  const tiles = shown
    .map((c) => ({ c, st: statusOf(c.current_status), stamp: latest.get(c.id)! }))
    .sort((a, b) => a.st.rank - b.st.rank || (a.stamp < b.stamp ? 1 : a.stamp > b.stamp ? -1 : a.c.id.localeCompare(b.c.id)))
    .map(({ c, st }) => ({
      label: labels.get(c.id)!,
      status: st.text,
      photoUrl: photo.has(c.id) ? `/api/manage/photos?image=${encodeURIComponent(photo.get(c.id)!.id)}` : null,
    }));

  const kinds = inRange.map((e) => ({ cat: e.cat_id!, kind: eventKind(e.event_type) }));
  const count = (...want: string[]) => kinds.filter((k) => want.includes(k.kind)).length;
  const stats: RollCallStat[] = [
    { value: new Set(kinds.filter((k) => k.kind === "captured").map((k) => k.cat)).size, label: "cats trapped" },
    { value: count("spay", "neuter"), label: "spayed/neutered" },
    { value: count("vet_visit"), label: "vet visits" },
    { value: count("adoption"), label: "adopted" },
  ].filter((s) => s.value > 0);

  const needVet = shown.filter((c) => ["captured", "awaiting vet"].includes((c.current_status ?? "").trim().toLowerCase())).length;
  return { dateLabel: dateLabel(range), headline: headline(range), cats: tiles, stats, needVet };
}

export const vetLine = (n: number) => (n <= 0 ? null : n === 1 ? "1 still needs a vet." : `${n} still need a vet.`);
