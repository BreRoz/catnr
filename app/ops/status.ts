// The deployment's own report of how it is configured. Shown to a signed-in user at /_ops/status and used
// by docs/RUNBOOK.md. It reports whether secrets EXIST, never what they are.
import { flags } from "./limits";
type D1 = D1Database;

export type OpsEnv = {
  ENVIRONMENT?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  OPENROUTER_API_KEY?: string;
  OPENAI_API_KEY?: string;
  AI_DISABLED?: string;
};

export async function opsStatus(db: D1, env: OpsEnv, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
  const [counts, migrations, lastJob, lastFailure, switches] = await Promise.all([
    db.prepare("SELECT kind, COUNT(*) n FROM ops_events WHERE at>=? GROUP BY kind").bind(since).all<{ kind: string; n: number }>(),
    db
      .prepare("SELECT COUNT(*) n, MAX(name) latest FROM d1_migrations")
      .first<{ n: number; latest: string }>()
      .catch(() => null),
    db.prepare("SELECT MAX(at) at FROM ops_events WHERE kind='job_ok'").first<{ at: string | null }>(),
    db.prepare("SELECT MAX(at) at FROM ops_events WHERE kind='job_failure'").first<{ at: string | null }>(),
    flags(db),
  ]);
  return {
    environment: env.ENVIRONMENT || "unset",
    signIn: { configured: !!(env.ACCESS_TEAM_DOMAIN?.trim() && env.ACCESS_AUD?.trim()) },
    database: { reachable: true, migrationsApplied: migrations?.n ?? null, latestMigration: migrations?.latest ?? null },
    ai: {
      providerConfigured: !!(env.OPENROUTER_API_KEY || env.OPENAI_API_KEY),
      switchedOffByEnvironment: String(env.AI_DISABLED ?? "").toLowerCase() === "true",
      switches,
    },
    lastDailyJob: { succeeded: lastJob?.at ?? null, failed: lastFailure?.at ?? null },
    last24Hours: Object.fromEntries(counts.results.map((r: { kind: string; n: number }) => [r.kind, r.n])),
  };
}
