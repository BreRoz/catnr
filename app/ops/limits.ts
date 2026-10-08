// Usage limits and emergency switches. The limits are deliberately generous for one busy volunteer and
// tight enough that a stuck retry loop, a stolen session or a bug cannot run up the AI bill.
// AI calls are counted from ops_events, which is written BEFORE the provider is called.
import { fingerprint } from "./log";
type D1 = D1Database;

export const LIMITS = {
  aiPerOwnerPerHour: 30,
  aiPerOwnerPerDay: 150,
  /** A ceiling for the whole service, whoever is asking. */
  aiPerServicePerDay: 400,
  /** This many provider failures within the window pauses AI calls so a struggling provider isn't hammered. */
  breakerFailures: 5,
  breakerWindowMinutes: 10,
  photosPerOwnerPerDay: 100,
} as const;

export type FlagName = "ai" | "photo_uploads" | "imports";
export type Gate = { ok: true } | { ok: false; kind: "disabled" | "limited" | "paused"; status: number; message: string; detail: string };

const minutesAgo = (now: Date, m: number) => new Date(now.getTime() - m * 60_000).toISOString();

/** A flag is on unless a row switches it off. Environment variable AI_DISABLED=true also turns AI off. */
export async function flags(db: D1): Promise<Record<FlagName, { on: boolean; reason: string | null }>> {
  const out = { ai: { on: true, reason: null }, photo_uploads: { on: true, reason: null }, imports: { on: true, reason: null } } as Record<
    FlagName,
    { on: boolean; reason: string | null }
  >;
  const rows = (
    await db.prepare("SELECT name,enabled,reason FROM ops_flags").all<{ name: FlagName; enabled: number; reason: string | null }>()
  ).results;
  for (const r of rows) {
    const name = r.name as FlagName;
    if (name in out) out[name] = { on: r.enabled === 1, reason: r.reason };
  }
  return out;
}

export async function flagOn(db: D1, name: FlagName): Promise<boolean> {
  const row = await db.prepare("SELECT enabled FROM ops_flags WHERE name=?").bind(name).first<{ enabled: number }>();
  return !row || row.enabled === 1;
}

/** Decides whether one more AI call may be made right now. */
export async function checkAi(db: D1, owner: string, envDisabled: unknown, now = new Date()): Promise<Gate> {
  if (String(envDisabled ?? "").toLowerCase() === "true" || !(await flagOn(db, "ai"))) {
    return {
      ok: false,
      kind: "disabled",
      status: 503,
      message: "The assistant is switched off right now, so nothing was saved by it. You can still add records under Records.",
      detail: "ai switched off",
    };
  }
  const me = await fingerprint(owner),
    hour = minutesAgo(now, 60),
    day = minutesAgo(now, 24 * 60),
    window = minutesAgo(now, LIMITS.breakerWindowMinutes);
  const use = await db
    .prepare(
      "SELECT COUNT(*) service_day, COALESCE(SUM(owner_hash=?),0) owner_day, COALESCE(SUM(owner_hash=? AND at>=?),0) owner_hour FROM ops_events WHERE kind='ai_call' AND at>=?",
    )
    .bind(me, me, hour, day)
    .first<{ service_day: number; owner_day: number; owner_hour: number }>();
  if ((use?.owner_hour ?? 0) >= LIMITS.aiPerOwnerPerHour)
    return {
      ok: false,
      kind: "limited",
      status: 429,
      message:
        "That’s a lot of assistant requests in an hour, so I’m pausing to be safe. Nothing was saved. Try again a little later, or add this under Records.",
      detail: "hourly ai limit",
    };
  if ((use?.owner_day ?? 0) >= LIMITS.aiPerOwnerPerDay)
    return {
      ok: false,
      kind: "limited",
      status: 429,
      message: "The assistant’s limit for today has been reached. Nothing was saved. It resets within 24 hours; Records still works.",
      detail: "daily ai limit",
    };
  if ((use?.service_day ?? 0) >= LIMITS.aiPerServicePerDay)
    return {
      ok: false,
      kind: "limited",
      status: 429,
      message: "The assistant has reached its limit for today. Nothing was saved. Records still works.",
      detail: "service ai limit",
    };
  const failures = await db
    .prepare("SELECT COUNT(*) n FROM ops_events WHERE kind='ai_failure' AND at>=?")
    .bind(window)
    .first<{ n: number }>();
  if ((failures?.n ?? 0) >= LIMITS.breakerFailures)
    return {
      ok: false,
      kind: "paused",
      status: 503,
      message:
        "The assistant is having trouble and is resting for a few minutes. Nothing was saved. Try again shortly, or add this under Records.",
      detail: "provider paused after repeated failures",
    };
  return { ok: true };
}

/** Returns a plain-language refusal if another photo may not be stored, otherwise null. */
export async function photoRefusal(
  db: D1,
  owner: string,
  now = new Date(),
): Promise<{ status: number; message: string; detail: string } | null> {
  if (!(await flagOn(db, "photo_uploads")))
    return { status: 503, message: "Adding photos is switched off for now. Nothing was saved.", detail: "photo uploads switched off" };
  const n = await db
    .prepare("SELECT COUNT(*) n FROM photos WHERE owner_id=? AND created_at>=?")
    .bind(owner, minutesAgo(now, 24 * 60))
    .first<{ n: number }>();
  if ((n?.n ?? 0) >= LIMITS.photosPerOwnerPerDay)
    return {
      status: 429,
      message: `That’s ${LIMITS.photosPerOwnerPerDay} photos in a day, which is the daily limit. Nothing was saved. Try again tomorrow.`,
      detail: "daily photo limit",
    };
  return null;
}
