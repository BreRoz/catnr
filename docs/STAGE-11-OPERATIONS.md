# Stage 11 — Production operations

How the deployment is checked, watched, limited, backed up and rolled back. Day-to-day procedures are in
[RUNBOOK.md](RUNBOOK.md); this page records what is built, what was verified, and what is still open.

## What was verified on the deployed service (2026-10-08, `npm run verify`)

| Area | Result |
|---|---|
| Sign-in | Anonymous requests to `/`, `/api/*`, the photo URL and `/_ops/status` all get a 302 to the team’s Access login; requests with forged `x-catnr-user-*` headers and a fake token are refused the same way. The worker also verifies the Access JWT itself (signature, issuer, audience, expiry), so a request that bypasses Access (a preview URL, a future custom domain) still gets a 401. Tokens are never trusted from the client; the identity headers are stripped and re-set by the worker. |
| Redirect URLs / session length / who is allowed in | **Cannot be read from here** (needs the Zero Trust dashboard). Listed as `CONFIRM` items by `npm run verify`: policy allows only the intended emails, session duration, app domain, usage alert. |
| Database | Right database (`catnr-db`, id pinned in config); migrations 0000–0009 applied in order; the live schema (tables, indexes, constraints, triggers) matched the migrations exactly; no foreign-key violations; no placeholder or dev-identity owners; 33 named indexes. |
| RLS | D1/SQLite has no row-level security. Isolation is `owner_id NOT NULL` + composite foreign keys on every owned table, owner-scoped queries, and triggers that make history immutable (all covered by `tests/ownership.test.mjs` / `schema.test.mjs`). This is the closest equivalent; it is enforced in the application, with the database refusing orphaned or cross-owner links. |
| Storage | There is **no bucket**: photos are stored inline in D1 (the `PHOTOS` R2 hook in `app/manage/photos.ts` is unused). Access policy = the same owner scoping, served through an authenticated route with `nosniff` and private caching. Upload limits/validation: 1.3 MB, JPEG/PNG/WebP verified by magic bytes (no SVG), 100/day, 3 MB request cap. |
| AI/provider secrets | `OPENROUTER_API_KEY` exists as a Worker secret and is read only on the server (`app/api/assistant/route.ts`). The key appears nowhere in git history, in `wrangler.jsonc`, in the build output, or in the browser bundle (all checked by `verify`; also by a test that fails if client code references server secrets). `.dev.vars`/`.env*` are git-ignored and not uploaded by `wrangler deploy`. **Problem found:** the account also has a secret whose *name* is a pasted copy of an API key (see Remaining risks). |
| Production vs development | `ENVIRONMENT` is `production` in the deployed config and `development` in `.dev.vars`; the localhost dev identity only exists when Access is unconfigured *and* the host is localhost, and `verify` fails if any `@localhost` owner has data in a deployed database. |

## What changed

* **Migration `0010_operations`** (additive): `ops_events` (operational log, no rescue content, no emails, CHECK-limited kinds, 300-char detail, indexed for the counts) and `ops_flags` (emergency switches `ai`, `photo_uploads`, `imports`). Not applied to production yet — see below.
* **`app/ops/`**: `log.ts` (scrubbing, one-way owner fingerprint, never-throwing recorder), `limits.ts` (AI/photo limits, circuit breaker, switches), `observe.ts` (classifies API responses; caps stored auth failures at 50 / 10 min so a flood cannot fill the DB), `status.ts` (`/_ops/status`).
* **Assistant route**: every provider call passes through `monitoredAgent` — switch/limits checked first, the attempt is recorded *before* the call, duration and outcome after. Over limit → clear “nothing was saved” message (HTTP 429/503, handled by the existing client). Switched off → behaves exactly as with no key configured. Rejected/oversize photos, invalid plans and database errors are recorded.
* **Worker**: times and classifies every API request; refuses bodies over 3 MB; adds `nosniff`, `X-Frame-Options`, referrer and permissions policies (microphone/camera still allowed for voice and photos) and `no-store` on API responses; an Access-key outage now fails closed with a retryable 503 instead of crashing; the daily job records `job_ok` / `job_failure`.
* **Retention**: `ops_events` older than 90 days are deleted by the existing daily job; listed on the My data screen.
* **Staging**: `env.staging` in `wrangler.jsonc` — separate worker `catnr-staging`, empty database `catnr-staging-db` (created, migrated, deployed), no AI key, no cron, closed until its own Access app exists.
* **Scripts** (`scripts/`): `verify-deploy`, `ops-report`, `backup` (+ proof + pruning), `restore-test`, `restore-to-d1` (+ `lib/split.mjs`), `flag`, `deploy` (guarded; `npm run deploy` now goes through it).
* **Docs**: `RUNBOOK.md`, this file.

## Tests

`tests/ops.test.mjs` (29 tests): scrubbing and fingerprinting; every limit and its recovery; per-person isolation; circuit breaker; both kill switches; the assistant route end-to-end (counts, failures, invalid answers, runaway loop stopped before the provider, same-key retry never calls the provider twice, switched-off fallback, bad/over-limit uploads); request classification and the auth-failure cap; status page reveals no secrets; retention; backup → restore round trip and five kinds of damaged backup; oversize-row splitting; deploy-script guards; no key in source or client code.

Also run for real against Cloudflare: deploy to staging, `verify` (26 checks), unauthenticated probes, a real `d1 export` replayed by `restore-test`, a Time Travel restore, and a restore of a backup containing a 1 MB photo into a fresh D1 database (see the Report).

## Remaining risks / open items

1. **Migration 0010 and the new code are not deployed to production.** Deploying is your call (`npm run deploy`, which backs up first). Until then production has no monitoring, limits or switches, and `npm run verify` reports the 0010 gap by design. Production backup/restore *was* tested (read-only export, 48 rows, restored cleanly).
2. **A secret named like an API key exists on the production worker.** Its name is visible to anyone with dashboard access. Rotate that OpenRouter key, then `npx wrangler secret delete "<that name>"`. I did not delete it (it was not mine to remove).
3. **Whether `OPENROUTER_API_KEY` holds a working key is unproven** — no live AI call has been made from the deployed site. After deploying, send one real update and check `npm run ops:report`.
4. **Access policy, session length and who is allowed** cannot be verified from here (`CONFIRM` items).
5. **D1 logical restore and photos:** D1 refuses any SQL statement over ~100 KB, so its own export can’t be re-imported with `d1 execute --file` once photos exist. `restore-to-d1` works around it (tested), but it’s a symptom of storing photos inline; moving photos to R2 would shrink backups and the 2 MB row ceiling. Not done (outside Stage 11).
6. **Backups are local files on one laptop** and contain personal data. Off-machine encrypted copy and a weekly schedule are your action; nothing is scheduled automatically. Time Travel retention depends on the Cloudflare plan.
7. **Monitoring is pull, not push.** `npm run ops:report` must be run; there is no email/SMS alert. Cloudflare Notifications (Worker errors, D1) can be turned on in the dashboard.
8. Request bodies are capped on `Content-Length`; a chunked upload without one is still bounded by the app’s own checks and Cloudflare’s edge limit, not by the 3 MB cap.
9. OpenRouter spend cap must be set in their dashboard; the in-app limits are a second line, not a replacement.
10. Staging cannot be used in a browser until a second Access application is created for `catnr-staging` and its `ACCESS_*` values are filled in.
