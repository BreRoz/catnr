// Deleting the whole account: deliberate, explained, and atomic. It happens in three steps so it cannot
// be done by accident: ask (nothing changes), wait 24 hours (records stay fully usable, and the request
// can be cancelled), then confirm by typing a phrase. The confirmation only works if the records are
// exactly as they were when Ari last looked at them, and the deletion is one database batch: either every
// row is gone, or none is.
import { ManageError, all, first, makeId, now, type D1, type Row } from "../manage/common";
import type { Resource } from "../manage/http";
import { DELETION_WAIT_HOURS, RETENTION_RULES } from "./retention";

export const CONFIRM_PHRASE = "DELETE MY RESCUE DATA";

const COUNTED = [
  ["cats", "cats"], ["colonies", "colonies"], ["people", "people and contacts"], ["events", "history entries (including replaced and removed ones)"],
  ["transactions", "money and donation records (including reversed ones)"], ["photos", "photos"], ["ai_inputs", "things you told the assistant, with what it understood"],
  ["record_changes", "change-history entries"], ["corrections", "correction records"], ["merges", "merge records"],
] as const;

const WILL_DELETE = [
  "Every cat, colony, person, history entry, photo and money record in your account, including archived, removed, replaced and merged ones.",
  "Everything you told the assistant (the words you spoke or typed, what it understood, the questions it asked and your answers).",
  "The complete change history, corrections and merge records, and the log of your downloads.",
];
const WILL_REMAIN = [
  "Your sign-in. Cat Tracker never held your password: sign-in is handled by Cloudflare Access, and removing your access there is a separate step for whoever manages it.",
  "A receipt saying that an account was deleted, with the date and how many records were removed. It holds no names, email addresses or content.",
  "Files you have already downloaded. They are yours; keep or delete them yourself.",
  "Backups: Cloudflare keeps short-lived database backups, so copies of deleted rows can persist there briefly before they age out.",
];

export async function status(db: D1, owner: string, at = new Date()) {
  const counts: Record<string, number> = {};
  for (const [table] of COUNTED) counts[table] = Number((await first<{ n: number }>(db, `SELECT COUNT(*) n FROM ${table} WHERE owner_id=?`, owner))?.n ?? 0);
  const [request, revision, lastExport, outside] = await Promise.all([
    first<{ requested_at: string; execute_after: string }>(db, "SELECT requested_at,execute_after FROM deletion_requests WHERE owner_id=?", owner),
    first<{ version: number }>(db, "SELECT version FROM rescue_revisions WHERE owner_id=?", owner),
    first<{ created_at: string }>(db, "SELECT created_at FROM data_exports WHERE owner_id=? AND profile='full' ORDER BY created_at DESC LIMIT 1", owner),
    first<{ n: number }>(db, "SELECT COUNT(*) n FROM photos WHERE owner_id=? AND storage_location NOT LIKE 'data:image/%'", owner),
  ]);
  const wait = request ? Math.max(0, Date.parse(request.execute_after) - at.getTime()) : null;
  return {
    counts, countLabels: Object.fromEntries(COUNTED), revision: Number(revision?.version ?? 0),
    lastFullExport: lastExport?.created_at ?? null, waitHours: DELETION_WAIT_HOURS, confirmPhrase: CONFIRM_PHRASE,
    willDelete: WILL_DELETE, willRemain: WILL_REMAIN, retention: RETENTION_RULES, photosStoredElsewhere: Number(outside?.n ?? 0),
    request: request ? { requestedAt: request.requested_at, executeAfter: request.execute_after, canConfirm: wait === 0, hoursLeft: Math.ceil((wait ?? 0) / 3_600_000) } : null,
  };
}

// Children before parents; every table here is owner-scoped. Corrections can point at each other
// (an undo points at the correction it reverts), so they are removed one layer at a time.
const FIRST = ["clarification_resolutions", "clarification_answers", "clarifications", "proposal_executions", "proposed_actions", "photos", "transactions", "events"];
const THEN = ["record_changes", "merges", "duplicate_dismissals", "cats", "colonies", "people", "ai_inputs", "data_exports", "deletion_requests", "write_requests"];

async function correctionDepth(db: D1, owner: string) {
  const links = new Map<string, string | null>((await all(db, "SELECT id,reverts_id FROM corrections WHERE owner_id=?", owner)).map((r): [string, string | null] => [r.id, r.reverts_id]));
  let deepest = 0;
  for (const id of links.keys()) { let depth = 0, at: string | null | undefined = id; const seen = new Set<string>(); while (at && links.get(at) && !seen.has(at)) { seen.add(at); at = links.get(at); depth++; } deepest = Math.max(deepest, depth); }
  return deepest;
}

async function execute(db: D1, owner: string, body: Row) {
  const request = await first<{ execute_after: string }>(db, "SELECT execute_after FROM deletion_requests WHERE owner_id=?", owner);
  if (!request) throw new ManageError("Ask to delete your account first. Nothing has been requested.", 409, "conflict");
  if (Date.parse(request.execute_after) > Date.now()) throw new ManageError(`You can confirm after ${request.execute_after}. Until then nothing changes and you can cancel.`, 409, "conflict");
  if (body.confirm !== CONFIRM_PHRASE) throw new ManageError(`Type ${CONFIRM_PHRASE} exactly to confirm.`);
  const current = await status(db, owner);
  if (!Number.isInteger(body.revision) || body.revision !== current.revision) throw new ManageError("Your records changed since you last looked. Review what will be deleted, then confirm again. Nothing was deleted.", 409, "conflict");
  const depth = await correctionDepth(db, owner), t = now();
  const own = (table: string) => db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).bind(owner);
  const leaves = "DELETE FROM corrections WHERE owner_id=? AND id NOT IN (SELECT reverts_id FROM corrections WHERE owner_id=? AND reverts_id IS NOT NULL)";
  const receiptId = makeId("deletion");
  await db.batch([
    // Fails the whole batch if anything was written since the revision above was read.
    db.prepare("INSERT INTO write_guards(owner_id,expected_version) VALUES(?,?)").bind(owner, current.revision),
    db.prepare("INSERT INTO deletion_in_progress(owner_id) VALUES(?)").bind(owner),
    ...FIRST.map(own),
    ...Array.from({ length: depth + 1 }, () => db.prepare(leaves).bind(owner, owner)),
    own("corrections"),
    ...THEN.map(own),
    // Removing records bumps the revision counter, so these go last.
    own("write_guards"), own("rescue_revisions"),
    db.prepare("DELETE FROM owners WHERE id=?").bind(owner),
    db.prepare("DELETE FROM deletion_in_progress WHERE owner_id=?").bind(owner),
    db.prepare("INSERT INTO deletion_receipts(id,completed_at,counts) VALUES(?,?,?)").bind(receiptId, t, JSON.stringify(current.counts)),
  ]);
  return { outcome: "deleted", receiptId, deletedAt: t, counts: current.counts, message: "Your account and all of its records have been deleted. You can sign out now." };
}

export const resource: Resource = {
  read: (db, owner) => status(db, owner),
  async post(db, owner, body) {
    const action = body.action;
    if (action === "request") {
      const t = new Date(), after = new Date(t.getTime() + DELETION_WAIT_HOURS * 3_600_000).toISOString();
      if (!await first(db, "SELECT id FROM owners WHERE id=?", owner)) throw new ManageError("There is nothing to delete.", 404);
      await db.prepare("INSERT OR IGNORE INTO deletion_requests(owner_id,requested_at,execute_after) VALUES(?,?,?)").bind(owner, t.toISOString(), after).run();
      return { outcome: "requested", ...await status(db, owner), message: `Request recorded. Nothing has been deleted. You can confirm in ${DELETION_WAIT_HOURS} hours, and cancel any time before then.` };
    }
    if (action === "cancel") {
      await db.prepare("DELETE FROM deletion_requests WHERE owner_id=?").bind(owner).run();
      return { outcome: "cancelled", ...await status(db, owner), message: "Cancelled. Your records were not touched." };
    }
    if (action === "confirm") return execute(db, owner, body);
    throw new ManageError("Unknown action.");
  },
};
