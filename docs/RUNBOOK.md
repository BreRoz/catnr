# Cat Tracker runbook

For whoever looks after the deployment (today: the account owner, bre999@gmail.com). Everything here has
been run at least once against staging unless marked **(documented, not run on production)**.

| Environment | Worker | Database | AI key | Sign-in |
|---|---|---|---|---|
| production | `catnr` — https://catnr.bre999.workers.dev | `catnr-db` | yes (`OPENROUTER_API_KEY`) | Cloudflare Access |
| staging | `catnr-staging` — https://catnr-staging.bre999.workers.dev | `catnr-staging-db` (starts empty) | **none, on purpose** | closed (503) until you create a separate Access app and fill `ACCESS_*` under `env.staging` in `wrangler.jsonc` |
| local | `npm run dev` | local SQLite in `.wrangler/` | `.dev.vars` | none (dev identity `dev@localhost`) |

Never copy production data into staging or local. Use made-up records (the restore drills below do).

## Everyday commands

| Command | What it does |
|---|---|
| `npm run verify` | Read-only check that production matches the repository (secrets, migrations, schema, constraints, sign-in). `--env staging` for staging. |
| `npm run ops:report` | Plain-language health report from the last 24 h. Exit code 1 = something needs attention. |
| `npm run deploy:staging` | Build for staging, migrate staging, deploy, verify. |
| `npm run deploy` | **The only way to release production**: clean `main` → lint → tests → backup (and proof it restores) → migrate → build → check the build is really for production → deploy → verify. `--dry-run` prints the plan. |
| `npm run backup` | Full backup of production into `backups/`, then proves it restores. |
| `npm run restore:test -- backups/<file>.sql` | Replays a backup into a throwaway database and says PASS/FAIL. |
| `npm run flag -- ai off "reason"` | Emergency switch (see below). `npm run flag -- list` shows them. |
| `https://catnr.bre999.workers.dev/_ops/status` | (signed in) how this deployment is configured, last 24 h counts; never shows secret values. |

Check the report daily for the first weeks, after every release, and whenever something feels off.

## What is monitored (and where to look)

Stored in the `ops_events` table for 90 days and also written to Cloudflare’s Worker logs (Workers → catnr → Logs). No names, emails, cat details, or anything Ari said is recorded; people appear only as a 12-character one-way fingerprint.

| Signal | Recorded as | Looks like trouble when |
|---|---|---|
| API errors | `api_error` (any 5xx) | any |
| Database errors | `db_error` | any |
| Failed AI calls | `ai_failure` (provider down/timeout), `ai_invalid` (unusable answer) | >20 % of calls fail |
| Failed/rejected uploads | `upload_rejected` | repeated from one user |
| Authentication failures | `auth_failure` (requests that reached the worker without a valid Access token) | 5+ a day |
| Latency | `duration_ms` on `ai_call`; `slow_request` for any API call over 5 s | p95 climbing |
| Job failures | `job_ok` / `job_failure` from the daily 04:15 UTC clean-up | no `job_ok` for 26 h, or any failure |
| Repeated retries | `retry_replay` (a retry safely answered from its receipt) | 20+ from one user |
| Limits hit | `limit_hit` | any (is something looping?) |

Cloudflare’s own alerting (dashboard → Notifications) can email on Worker error rate and D1; turning those on is a one-time manual step.

## Usage limits (code: `app/ops/limits.ts`)

| Protection | Limit | What the user sees |
|---|---|---|
| Assistant calls per person | 30 / hour, 150 / day | “…pausing to be safe. Nothing was saved… add this under Records.” |
| Assistant calls, whole service | 400 / day | same, “limit for today” |
| Provider keeps failing | 5 failures in 10 min pauses AI for the window | “The assistant is resting for a few minutes.” |
| Same request retried | replayed from its receipt; never reaches the provider again | nothing — it just works once |
| Photos per person | 100 / day | “…daily limit. Nothing was saved.” |
| One photo | 1.3 MB, JPEG/PNG/WebP checked by content, not name | existing message |
| Request body | 3 MB at the edge of the worker (413) | “That’s too large” |
| Text per assistant message | 2000 characters | existing |
| CSV import | 200 rows, 1.5 M characters | existing |

The limits count in the database, before the provider is called, so a crash or a loop is still counted. Also set a **monthly spend cap in the OpenRouter dashboard** — that is the real ceiling on cost and cannot be set from here.

## Emergency: turn the assistant off

Fastest, no deploy, effective on the next request:

```bash
npm run flag -- ai off "provider outage"
```

Cat Tracker keeps working: Records, photos, reports, exports, and the simple built-in understanding of short updates and questions (the same fallback used when no key is configured). Turn back on with `npm run flag -- ai on`.

If the database itself is the problem, set the environment switch instead (takes a few seconds and survives database trouble): `npx wrangler secret put AI_DISABLED` and enter `true`; remove it with `npx wrangler secret delete AI_DISABLED`.

If the key is exposed: rotate it at OpenRouter first (that stops spend), then `npx wrangler secret put OPENROUTER_API_KEY` with the new key.

Other switches: `photo_uploads` (stops new photos), `imports` (stops CSV imports). Existing records are never touched.

## Releasing

1. `git status` clean on `main`; `npm run deploy:staging` and look at `npm run verify:staging`.
2. `npm run deploy`. It stops at the first problem and tells you why. Read its closing `verify` output.
3. `npm run ops:report`; open the site on the phone and record one test update.

Migrations are applied **before** the new code goes live, so every migration must be additive (new tables/columns/indexes) so the previous code keeps working against the new schema. That is what makes rollback safe.

## Rollback

### Application (code)
```bash
npx wrangler deployments list          # find the previous version id
npx wrangler rollback <version-id> -m "why"
```
Takes effect in seconds. Safe because migrations are additive: the old code runs fine on the newer schema. After a rollback, fix forward and redeploy; do not leave production on an old version unnoticed.

### Database migrations
Migrations are forward-only. There is no “down”. Instead:
- **Before any migration** `npm run deploy` takes and proves a backup.
- A bad *additive* migration (e.g. an extra table) is harmless; roll back the code and fix forward with a new migration.
- A migration that damaged data: restore with **Time Travel** (below) to just before it ran. The deploy output prints the time the migration started.
- Never edit a migration that has been applied anywhere; add a new one.

### A feature
- The assistant: `npm run flag -- ai off`.
- Photos/imports: `npm run flag -- photo_uploads off`, `... imports off`.
- Anything else: roll back the code (above) or ship a fix.

## Backups

| | |
|---|---|
| **Owner** | The Cloudflare account owner (bre999@gmail.com). Ari does not need to do anything. |
| **Layer 1 – Time Travel** | Cloudflare keeps every change to a D1 database, restorable to any minute: 30 days on the Workers Paid plan, 7 days on Free (**confirm which plan the account is on**). Automatic; free. Primary tool for “undo the last bad thing”. |
| **Layer 2 – logical backup** | `npm run backup` → `backups/catnr-production-<time>.sql` + `.manifest.json` (checksum, row counts, applied migrations). Taken automatically before every production deploy. Also run it **weekly** (put a reminder in your calendar, or schedule a local job running `npm run backup` every Sunday) and before any manual database work. |
| **Retention** | Local copies: all from the last 14 days, then the newest of each week for 8 weeks; older are pruned, and only after the new backup has been proven restorable. |
| **Security** | Backups hold real names, locations, photos and money records. Files are mode 600 in a git-ignored folder. Copy `backups/` to somewhere encrypted and off this laptop (an encrypted drive or private cloud folder). Delete copies when the 8-week window passes. Account deletion in the app does **not** remove old backup files — delete those by hand if Ari asks to be forgotten. |

## Restore

A backup counts only if restored. `npm run backup` replays every backup into a scratch database and compares schema, constraints, 98 audit triggers and every table’s row count before calling it good.

### A. Undo recent damage — Time Travel (fastest; used for “someone deleted things”)
```bash
npx wrangler d1 time-travel info catnr-db                       # shows the current bookmark – write it down first
npx wrangler d1 time-travel restore catnr-db --timestamp=2026-10-08T17:35:21Z
```
The command prints the *previous* bookmark; restoring to that undoes the restore. It rewinds the whole database, so anything saved after the chosen time is lost — pick the moment just before the problem. Tested on staging (deleted a cat, its history and photo; restored; all three back). **(documented, not run on production.)**

### B. Rebuild from a backup file into a NEW database (disaster, or the data is older than Time Travel keeps)
```bash
npx wrangler d1 create catnr-db-restored
node scripts/restore-to-d1.mjs backups/<file>.sql --database catnr-db-restored
```
It proves the file first, splits the large photo rows (D1 rejects any single SQL statement over ~100 KB, and its own export writes each photo as one — a plain `d1 execute --file` fails with `SQLITE_TOOBIG`), loads into the empty database, and compares every row count with the manifest. Then point the app at the new database: edit `database_name` / `database_id` under `d1_databases` in `wrangler.jsonc`, `npm run verify`, `npm run deploy`. Keep the old database until you are sure. The script refuses to write into `catnr-db`. Tested on staging, including a 1 MB photo row. 

### C. Look inside a backup without touching anything
`npm run restore:test -- backups/<file>.sql` — or open the `.sql` in any SQLite tool after `sqlite3 new.db < file.sql`.

### Restore drill (do this quarterly, on made-up data)
1. Put a few made-up records in staging (`npx wrangler d1 execute catnr-staging-db --remote --file seed.sql`).
2. `node scripts/backup.mjs --env staging` → expect PASS.
3. Delete the made-up cat; restore with Time Travel (A); confirm it is back.
4. `npx wrangler d1 create scratch-restore`; run (B) against it; expect PASS; `npx wrangler d1 delete scratch-restore`.
5. Remove the made-up records.

## If something is wrong

| Symptom | First move |
|---|---|
| Everyone gets 503 “Sign-in is not configured” | `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` missing from the deployed config. `npm run verify`. |
| Everyone gets 503 “Sign-in is temporarily unavailable” | Cloudflare Access’ key service is unreachable; it fails closed and recovers by itself. Check status.cloudflare.com. |
| “The assistant is unavailable” | `npm run ops:report`; if the provider is down the pause is automatic; if it is stuck, switch AI off. |
| Costs rising | `npm run flag -- ai off`, rotate the key, then `npm run ops:report` to see which person/hour. |
| Records look wrong | Do not restore yet. In the app use History/Undo; if that is not enough, take `npm run backup` first, then Time Travel. |
| Site broken after a release | Roll back the code (above), then investigate. |
