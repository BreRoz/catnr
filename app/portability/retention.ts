// How long each kind of data is kept, in one place. The plain-language list is shown to Ari on the Data
// screen and the two time-limited rules are enforced by purgeExpired() (run daily by the worker's cron).
import type { D1 } from "../manage/common";

/** A photo uploaded with an unanswered question is only a temporary copy; the answer decides what is kept. */
export const CLARIFICATION_PHOTO_DAYS = 7;
/** The retry cache that makes a re-sent request safe. Nothing reads it after a few minutes. */
export const REPLAY_CACHE_DAYS = 30;
/** How long a deletion request waits, and can be cancelled, before it can be carried out. */
export const DELETION_WAIT_HOURS = 24;
/** The operational log (errors, usage counts). It holds no rescue content and no email addresses. */
export const OPS_LOG_DAYS = 90;

export type RetentionRule = { id: string; what: string; keptFor: string; why: string; automatic: boolean };

export const RETENTION_RULES: RetentionRule[] = [
  { id: "voice", what: "Voice recordings", keptFor: "Never stored", why: "Your phone or browser turns speech into words. Only the words reach Cat Tracker; the audio is not uploaded or saved anywhere.", automatic: true },
  { id: "transcripts", what: "What you said or typed, and what the assistant understood", keptFor: "Until you delete your account", why: "It is the record of why each change was made, and lets you check or undo the assistant's work.", automatic: false },
  { id: "photos", what: "Photos of cats", keptFor: "Until you delete your account", why: "They are part of each cat's history. Hiding a photo keeps it; only deleting the account removes it.", automatic: false },
  { id: "pending-photos", what: "A photo waiting on a question from the assistant", keptFor: `${CLARIFICATION_PHOTO_DAYS} days after the question is answered or expires`, why: "After that the temporary copy is wiped. If the photo was saved to a cat, that saved photo is separate and stays.", automatic: true },
  { id: "audit", what: "Change history, corrections and merge records", keptFor: "Until you delete your account", why: "It cannot be edited, so the history of your records can be trusted.", automatic: false },
  { id: "removed", what: "Archived, removed, replaced and merged records", keptFor: "Until you delete your account", why: "They are hidden, never destroyed, so mistakes can be undone and old totals still explain themselves.", automatic: false },
  { id: "money", what: "Donations, purchases and other money records", keptFor: "Until you delete your account", why: "Download them before deleting. If the rescue is a registered charity, tax and grant rules may require you to keep financial records for several years.", automatic: false },
  { id: "retry", what: "Short-lived technical records that make a retry safe", keptFor: `${REPLAY_CACHE_DAYS} days`, why: "They only exist so a double tap or a dropped connection does not save something twice.", automatic: true },
  { id: "ops", what: "Technical log of errors and assistant usage", keptFor: `${OPS_LOG_DAYS} days`, why: "It lets problems be diagnosed and keeps the assistant from running up costs. It contains no names, emails, or anything you said.", automatic: true },
  { id: "exports", what: "A log of when you downloaded your data", keptFor: "Until you delete your account", why: "It shows when personal information left the app. The downloaded files themselves are yours to look after.", automatic: false },
  { id: "receipt", what: "Proof that an account was deleted", keptFor: "Kept", why: "It holds only the date and how many records were removed. No names, emails or content.", automatic: false },
];

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
const changes = (result: unknown) => { const r = result as { meta?: { changes?: number }; changes?: number }; return Number(r.meta?.changes ?? r.changes ?? 0); };

/** Applies the two automatic rules to every account. Safe to run any number of times. */
export async function purgeExpired(db: D1, now = new Date()) {
  const photoCut = daysAgo(now, CLARIFICATION_PHOTO_DAYS), cacheCut = daysAgo(now, REPLAY_CACHE_DAYS);
  const photos = await db.prepare(
    `UPDATE clarifications SET photo_data=NULL WHERE photo_data IS NOT NULL AND
     ((status<>'pending' AND COALESCE(decided_at,updated_at)<?) OR (status='pending' AND expires_at<?))`).bind(photoCut, photoCut).run();
  const cache = await db.prepare("DELETE FROM write_requests WHERE created_at<?").bind(cacheCut).run();
  const ops = await db.prepare("DELETE FROM ops_events WHERE at<?").bind(daysAgo(now, OPS_LOG_DAYS)).run();
  return { clarificationPhotosWiped: changes(photos), retryRecordsRemoved: changes(cache), opsEventsRemoved: changes(ops) };
}
