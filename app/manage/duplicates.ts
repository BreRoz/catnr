import { ManageError, all, first, oneOf, recordId, type Ctx, type D1, type Row, type Write } from "./common";
import { displayName } from "./cats";

export type RecordType = "cat" | "person" | "colony";
export type Pair = { recordType: RecordType; aId: string; bId: string; score: number; reasons: string[] };

// ---------- text helpers (pure) ----------
export const normalize = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s: unknown) => normalize(s).split(" ").filter(Boolean);
const STOP = new Set(["a", "an", "the", "and", "with", "of", "on", "his", "her", "cat", "kitten", "colored", "color", "coloured"]);
const FILLER = new Set(["colony", "the", "cats", "cat", "tnr", "area", "site"]);
const words = (s: unknown) => tokens(s).filter((t) => !STOP.has(t));

/** Edit distance, giving up (returning max+1) once it must exceed `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row[j] = v; if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

const jaccard = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); let n = 0; for (const x of A) if (B.has(x)) n++; return { shared: n, score: n / (A.size + B.size - n || 1) }; };
const pairKey = (a: string, b: string) => (a < b ? [a, b] : [b, a]) as [string, string];

/** Group rows by key, then compare only inside groups (and cap group size so a huge group can't stall a request). */
function eachPair<T extends Row>(rows: T[], keys: (r: T) => string[], visit: (a: T, b: T) => void, cap = 400) {
  const groups = new Map<string, T[]>();
  for (const r of rows) for (const k of new Set(keys(r))) { if (!k) continue; const g = groups.get(k) ?? []; g.push(r); groups.set(k, g); }
  const seen = new Set<string>();
  for (const g of groups.values()) {
    const list = g.slice(0, cap);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const key = pairKey(list[i].id, list[j].id).join("|");
      if (!seen.has(key)) { seen.add(key); visit(list[i], list[j]); }
    }
  }
}

const known = (v: unknown) => v != null && v !== "" && v !== "unknown";

/** Facts that make two cat records impossible to be the same cat. Used by detection and by merging. */
export function catBlockers(a: Row, b: Row): string[] {
  const out: string[] = [];
  if (a.microchip_number && b.microchip_number && a.microchip_number !== b.microchip_number) out.push("They have different microchip numbers, so they are different cats.");
  if (known(a.sex) && known(b.sex) && a.sex !== b.sex) out.push(`One is ${a.sex} and the other is ${b.sex}, so they are different cats.`);
  return out;
}

export function findCatPairs(cats: Row[]): Pair[] {
  const out = new Map<string, Pair>();
  const add = (a: Row, b: Row, score: number, reason: string) => {
    if (catBlockers(a, b).length) return;
    const [x, y] = pairKey(a.id, b.id), key = `${x}|${y}`, found = out.get(key);
    if (found) { found.score = Math.max(found.score, score); found.reasons.push(reason); } else out.set(key, { recordType: "cat", aId: x, bId: y, score, reasons: [reason] });
  };
  const nameKey = (c: Row) => (normalize(c.name).length >= 2 ? [normalize(c.name)] : []);
  eachPair(cats, nameKey, (a, b) => add(a, b, 0.9, `Same name “${a.name}”`));
  const description = (c: Row) => words(`${c.appearance ?? ""} ${c.distinguishing_characteristics ?? ""}`);
  eachPair(cats, (c) => [c.origin_colony_id || "no-colony"], (a, b) => {
    // Two cats with different names are different cats, whatever they look like.
    if (normalize(a.name) && normalize(b.name) && normalize(a.name) !== normalize(b.name)) return;
    const { shared, score } = jaccard(description(a), description(b));
    if (shared < 2 || score < 0.6) return;
    const sameColony = !!a.origin_colony_id && a.origin_colony_id === b.origin_colony_id;
    add(a, b, Math.min(0.85, 0.5 + score * 0.3 + (sameColony ? 0.1 : 0)), sameColony ? "Similar description in the same colony" : "Similar description");
  });
  return [...out.values()];
}

const contactKeys = (c: unknown) => {
  const text = String(c ?? ""), keys = new Set<string>();
  for (const m of text.toLowerCase().matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)) keys.add(`email:${m[0]}`);
  for (const m of text.matchAll(/\+?\d[\d\s().-]{6,}\d/g)) { const d = m[0].replace(/\D/g, ""); if (d.length >= 7) keys.add(`phone:${d.slice(-10)}`); }
  return [...keys];
};

export function findPersonPairs(people: Row[]): Pair[] {
  const out = new Map<string, Pair>();
  const add = (a: Row, b: Row, score: number, reason: string) => {
    const [x, y] = pairKey(a.id, b.id), key = `${x}|${y}`, found = out.get(key);
    if (found) { found.score = Math.max(found.score, score); found.reasons.push(reason); } else out.set(key, { recordType: "person", aId: x, bId: y, score, reasons: [reason] });
  };
  const sorted = (p: Row) => tokens(p.name).sort().join(" ");
  eachPair(people, (p) => [sorted(p)], (a, b) => add(a, b, 0.95, "Same name, possibly written in a different order"));
  eachPair(people, (p) => [...contactKeys(p.contact)], (a, b) => add(a, b, 0.9, "Same email or phone number"));
  eachPair(people, (p) => [sorted(p).slice(0, 1)], (a, b) => {
    const x = tokens(a.name).join(""), y = tokens(b.name).join("");
    if (x.length >= 6 && y.length >= 6 && x !== y && editDistance(x, y, 2) <= 2) add(a, b, 0.7, "Very similar names");
  }, 600);
  return [...out.values()];
}

const colonyKey = (c: Row) => tokens(c.name).filter((t) => !FILLER.has(t)).join(" ");
export function findColonyPairs(colonies: Row[]): Pair[] {
  const out = new Map<string, Pair>();
  const add = (a: Row, b: Row, score: number, reason: string) => {
    const [x, y] = pairKey(a.id, b.id), key = `${x}|${y}`, found = out.get(key);
    if (found) { found.score = Math.max(found.score, score); found.reasons.push(reason); } else out.set(key, { recordType: "colony", aId: x, bId: y, score, reasons: [reason] });
  };
  eachPair(colonies, (c) => [colonyKey(c)], (a, b) => add(a, b, 0.9, "Same name apart from small words like “colony”"));
  eachPair(colonies, (c) => [colonyKey(c).slice(0, 1)], (a, b) => {
    const x = colonyKey(a), y = colonyKey(b);
    if (x.length >= 5 && y.length >= 5 && x !== y && editDistance(x, y, 2) <= 2) add(a, b, 0.7, "Very similar names");
  }, 600);
  eachPair(colonies, (c) => (normalize(c.general_location).length >= 8 ? [normalize(c.general_location)] : []), (a, b) => add(a, b, 0.6, "Same location"));
  return [...out.values()];
}

// ---------- loading ----------
const CAP = 3000;
const LOADERS: Record<RecordType, { sql: string; find: (rows: Row[]) => Pair[]; label: (r: Row) => string; richness: (r: Row) => number }> = {
  cat: {
    sql: `SELECT c.*,co.name colony_name,(SELECT COUNT(*) FROM active_events e WHERE e.owner_id=c.owner_id AND e.cat_id=c.id) event_count,
      (SELECT COUNT(*) FROM photos p WHERE p.owner_id=c.owner_id AND p.cat_id=c.id) photo_count FROM cats c LEFT JOIN colonies co ON co.id=c.origin_colony_id AND co.owner_id=c.owner_id
      WHERE c.owner_id=? AND c.archived_at IS NULL ORDER BY c.created_at LIMIT ${CAP}`,
    find: findCatPairs, label: displayName, richness: (r) => r.event_count + r.photo_count,
  },
  person: {
    sql: `SELECT p.*,(SELECT COUNT(*) FROM active_events e WHERE e.owner_id=p.owner_id AND e.person_id=p.id) event_count,
      (SELECT COUNT(*) FROM active_transactions t WHERE t.owner_id=p.owner_id AND t.person_id=p.id) transaction_count FROM people p WHERE p.owner_id=? AND p.archived_at IS NULL ORDER BY p.created_at LIMIT ${CAP}`,
    find: findPersonPairs, label: (r) => r.name, richness: (r) => r.event_count + r.transaction_count,
  },
  colony: {
    sql: `SELECT c.*,(SELECT COUNT(*) FROM cats k WHERE k.owner_id=c.owner_id AND k.origin_colony_id=c.id AND k.archived_at IS NULL) cat_count FROM colonies c WHERE c.owner_id=? AND c.archived_at IS NULL ORDER BY c.created_at LIMIT ${CAP}`,
    find: findColonyPairs, label: (r) => r.name, richness: (r) => r.cat_count,
  },
};

export async function findDuplicates(db: D1, owner: string, type: RecordType, limit = 50) {
  const loader = LOADERS[type];
  const [rows, dismissed] = await Promise.all([
    all(db, loader.sql, owner),
    all(db, "SELECT first_id,second_id FROM duplicate_dismissals WHERE owner_id=? AND record_type=?", owner, type),
  ]);
  const hidden = new Set(dismissed.map((d) => `${d.first_id}|${d.second_id}`)), byId = new Map(rows.map((r) => [r.id, r]));
  const pairs = loader.find(rows).filter((p) => !hidden.has(`${p.aId}|${p.bId}`)).sort((x, y) => y.score - x.score || x.aId.localeCompare(y.aId)).slice(0, limit);
  const side = (id: string) => { const r = byId.get(id)!; return { id, label: loader.label(r), richness: loader.richness(r), createdAt: r.created_at, record: r }; };
  return {
    pairs: pairs.map((p) => {
      const a = side(p.aId), b = side(p.bId);
      // Suggest keeping the record with more history (older on a tie); Ari can swap it.
      const keepA = a.richness !== b.richness ? a.richness > b.richness : a.createdAt <= b.createdAt;
      return { recordType: type, score: Math.round(p.score * 100) / 100, reasons: [...new Set(p.reasons)], suggestedSurvivorId: keepA ? a.id : b.id, a: summarize(type, a), b: summarize(type, b) };
    }),
    truncated: rows.length >= CAP,
  };
}

function summarize(type: RecordType, s: { id: string; label: string; richness: number; record: Row }) {
  const r = s.record;
  const details = type === "cat" ? [r.sex !== "unknown" && r.sex, r.age_class !== "unknown" && r.age_class, r.appearance, r.distinguishing_characteristics, r.colony_name, r.current_status].filter(Boolean)
    : type === "person" ? [r.type, r.contact, r.general_location].filter(Boolean) : [r.general_location, `${r.cat_count} cats`].filter(Boolean);
  return { id: s.id, version: r.version, label: s.label, details, richness: s.richness };
}

export async function read(db: D1, owner: string, url: URL) {
  const type = oneOf(url.searchParams.get("type"), ["cat", "person", "colony"] as const, "type", true)!;
  return findDuplicates(db, owner, type);
}

/** "These are different": remember the pair so it isn't suggested again. Records are untouched. */
export async function write(ctx: Ctx, body: Row): Promise<Write> {
  if (body.action !== "dismiss") throw new ManageError("Unknown action.");
  const type = oneOf(body.recordType, ["cat", "person", "colony"] as const, "recordType", true)!;
  const a = recordId(body.aId, "First record", true)!, b = recordId(body.bId, "Second record", true)!;
  if (a === b) throw new ManageError("Choose two different records.");
  const [first_, second_] = pairKey(a, b);
  const table = { cat: "cats", person: "people", colony: "colonies" }[type];
  const found = await first<{ n: number }>(ctx.db, `SELECT COUNT(*) n FROM ${table} WHERE owner_id=? AND id IN (?,?)`, ctx.owner, a, b);
  if (Number(found?.n) !== 2) throw new ManageError("One of those records doesn’t exist.", 404);
  return {
    statements: [ctx.stmt("INSERT OR IGNORE INTO duplicate_dismissals(owner_id,record_type,first_id,second_id,actor_id,created_at) VALUES(?,?,?,?,?,?)", ctx.owner, type, first_, second_, ctx.owner, ctx.now)],
    response: { outcome: "saved", message: "Okay, I won’t suggest that pair again. You can still merge them by hand." },
  };
}
