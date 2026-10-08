# Cat Tracker (TNR Assistant)

A voice-first memory for TNR (trap-neuter-return) and cat rescue work. Ari tells the assistant what happened — by
voice, text or photo — and it records it accurately, asks when it is unsure, and lets her correct or undo anything.

> **"I tell the rescue what happened, and it remembers."**

This README is the map. The detailed design decisions, test evidence and procedures are in [`docs/`](docs/); the day-to-day
operating guide is [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## What it does

- **Record by talking.** A spoken or typed update ("Milo got neutered at Dr. Lee's, Sarah donated $100") becomes cats,
  events, people and money records. Photos attach to the right cat or event.
- **Ask questions.** "Which cats are waiting for adoption?" "What did we spend in 2025?" Questions never change records.
- **Careful by design.** The AI's answer is untrusted: it is validated field by field, ambiguous or consequential changes
  wait for Ari's OK, and an unclear "which cat?" becomes a question that survives a closed app.
- **Nothing is silently lost.** Corrections supersede (never overwrite) the original; every change links back to the
  words that caused it; undo restores the original.
- **Works without the AI.** Records, photos, reports, exports and simple built-in understanding keep working if the
  provider is down or switched off.
- **Manage by hand too.** The **Records** tab is a form-based editor for cats, colonies, people, events and money, with
  duplicate detection and merging, reports, CSV/ZIP export and import, and whole-account deletion.
- **Phone-first.** Designed for a phone in one hand; installable to the home screen (see [PWA](#installing-on-a-phone)).

## Architecture

```
 phone / browser
      │  HTTPS
      ▼
 Cloudflare Access ── verifies the person, signs every request with a JWT
      │
      ▼
 Cloudflare Worker  (worker/index.ts)
   1. verifies the Access JWT (worker/access.ts) and sets the trusted identity headers
   2. security headers, body-size cap, usage observation (app/ops)
   3. hands the request to the app ─────────────┐
      │                                          ▼
      │                          vinext app (Next.js App Router on Workers)
      │                            • pages and components   app/*.tsx, app/home, app/records
      │                            • assistant API           app/api/assistant
      │                            • manual-records API      app/api/manage → app/manage
      ▼
 Cloudflare D1 (SQLite)  — all records, audit trail, retry receipts, ops log
      + the AI provider (OpenRouter, or OpenAI) — called only by app/api/assistant/agent.ts
```

**Key rules** (see [`docs/`](docs/) for the reasoning behind each):

1. **Identity comes only from the Worker.** `worker/index.ts` strips any client-supplied identity headers and sets
   `x-catnr-user-id` / `x-catnr-user-email` only after verifying Cloudflare Access. Every query is limited to that owner;
   the database also enforces ownership with composite foreign keys. A request body can never name its owner.
2. **The AI never touches the database.** It returns a *plan*; `validation.ts` checks it; `record-writer.ts` is the only
   code that turns a validated plan into writes.
3. **Writes are atomic and retry-safe.** All the statements for one request (audit record, records, receipt, revision
   guard) go into one D1 batch (`reliability.ts`). A retried request is answered from its stored receipt.
4. **Schema changes happen only through migrations** (`drizzle/*.sql`). No request ever creates or alters tables.
5. **Money is integer minor units** (cents), per currency, never floating point (`app/money.ts`).

### Code layout

| Path | What lives there |
|---|---|
| `worker/` | Worker entry (`index.ts`) and Access JWT verification (`access.ts`) |
| `app/identity.ts`, `app/config.ts`, `app/vocabulary.ts` | Who is asking · typed AI settings read from the environment · lists shared by screens, manual records and AI |
| `app/rescue-client.tsx`, `app/home/` | The home screen: a container plus small components (hero, record list, impact summary, nav, banner) |
| `app/capture-sheet.tsx`, `correction-sheet.tsx`, `cat-history-sheet.tsx`, `clarification-cards.tsx`, `confirm-card.tsx`, `dialog.tsx` | Capture, correction, history and confirmation UI |
| `app/records/` | The Records tab (one panel per record type, shared form/list components in `ui.tsx`, data hooks in `hooks.ts`) |
| `app/styles/` | Stylesheets by area, imported in order from `app/globals.css` |
| `app/api/assistant/` | The assistant API — see below |
| `app/api/manage/`, `app/manage/` | Manual record management: thin route files + one module per record type (`serve()` in `manage/http.ts` gives each the same auth, retry and error handling) |
| `app/reports/` | Every reported number, defined once (what it counts, what it does not, and the SQL) |
| `app/portability/` | Export, import, account deletion, retention |
| `app/ops/` | Operational log, usage limits, emergency switches, status |
| `db/schema.ts` | Typed description of the database, checked against the migrations by a test |
| `drizzle/` | The migrations — the only definition of the database |
| `scripts/` | Deploy, verify, backup, restore, flags, report (see [Operations](#backup-and-restore)) |
| `tests/` | API/database tests (`*.test.mjs`) and browser flows (`e2e/`) |

#### The assistant API (`app/api/assistant/`)

`route.ts` only connects the Worker's bindings to the handlers; each module below has one job and takes the database
and settings it needs as arguments (so it can be tested without a Worker).

| Module | Responsibility |
|---|---|
| `read.ts` | `GET`: overview, one cat's history, photos, open questions, correction history |
| `write.ts` | `POST` / `PATCH`: the order of steps for one write request |
| `write-body.ts`, `turn.ts` | Parse and check the request; load the proposal / question / record it refers to; photo checks |
| `interpret.ts` | Ask the interpreter, validate, decide: apply now, ask Ari to approve, or ask a question |
| `persist.ts` | Build (not run) every write for the request, then commit atomically |
| `undo.ts` | `DELETE`: dismiss a proposal, drop a question, undo a correction |
| `agent.ts`, `plan-schema.ts` | Instructions and JSON schema sent to the provider; limits and logging around each call |
| `fallback.ts` | The built-in understanding used with no provider or when AI is switched off |
| `validation.ts` | Validation of the AI's plan; ambiguity and "needs approval" rules |
| `record-writer.ts` | Validated plan → database writes |
| `answer.ts` | Read-only answers to questions |
| `corrections.ts`, `clarifications.ts` | Versioned corrections and undo · durable pending questions |
| `reliability.ts`, `retry.ts` | Atomic batches, receipts, photo validation, provider timeouts, failure messages |
| `types.ts`, `cats.ts`, `ids.ts`, `responses.ts`, `snapshot.ts` | Shared types and small helpers |

Source formatting is enforced by Prettier (`npm run format`, checked in CI).

## Local development

Requirements: **Node.js ≥ 22.13** and npm. No Cloudflare account is needed for local work.

```bash
npm install
npm run db:migrate:local     # create the local database from the migrations
npm run dev                  # http://localhost:3000
```

- The local database lives in `.wrangler/` (git-ignored). `npm run db:reset:local` rebuilds it from the migrations
  (an older database is copied aside first).
- Locally there is no sign-in: requests from `localhost` get the identity `dev@localhost`. A deployed Worker with no
  Access settings refuses every request (503) instead.
- With no AI key, the assistant uses its built-in fallback (short updates about a named cat, simple questions). To try
  the real AI locally, put a key in `.dev.vars` (below).
- Never put real rescue data in a local or staging database.

## Environment variables and secrets

Non-secret settings are in [`wrangler.jsonc`](wrangler.jsonc); secrets are set with `wrangler secret put` (deployed) or
in `.dev.vars` (local, git-ignored). **Never commit a secret.** [`.env.example`](.env.example) lists the names.

| Name | Kind | Purpose |
|---|---|---|
| `ENVIRONMENT` | var | `production`, `staging` or `e2e…`; checked by the deploy and verify scripts |
| `ACCESS_TEAM_DOMAIN` | var | Your Cloudflare Zero Trust team domain (`<team>.cloudflareaccess.com`) |
| `ACCESS_AUD` | var | The Access application's audience tag. Empty = no sign-in (local only; deployed Workers refuse requests) |
| `OPENROUTER_API_KEY` | **secret** | Preferred AI provider key |
| `OPENROUTER_MODEL` | optional | Default `openai/gpt-5-mini` |
| `OPENAI_API_KEY` | **secret** | Optional direct OpenAI fallback (used only if no OpenRouter key) |
| `OPENAI_MODEL` | optional | Default `gpt-5-mini` |
| `AI_DISABLED` | secret, optional | Any value turns the AI off (emergency switch, see runbook) |
| `AI_TEST_BASE_URL` | test only | Honoured only when `ENVIRONMENT` is `e2e`: points the AI at the scripted fake provider |

The settings are read in one place, [`app/config.ts`](app/config.ts). The typed `Env` is generated by `npm run typecheck`
(`wrangler types`) plus [`types/env.d.ts`](types/env.d.ts) for secrets wrangler does not declare.

## Database

Cloudflare **D1** (SQLite). The schema is defined only by the migrations in [`drizzle/`](drizzle/); [`db/schema.ts`](db/schema.ts)
is a typed description kept in step with them by a test. See [`docs/STAGE-6-SCHEMA.md`](docs/STAGE-6-SCHEMA.md) for the
model (ownership, foreign keys, money, audit).

| | Database | Binding |
|---|---|---|
| production | `catnr-db` | `DB` |
| staging | `catnr-staging-db` | `DB` (under `env.staging`) |
| local | `.wrangler/` SQLite | `DB` |
| browser tests | throwaway local databases | `DB` |

### Migrations

- Add a file `drizzle/NNNN_name.sql` (next number) **and** its entry in `drizzle/meta/_journal.json`; update
  `db/schema.ts` to match. Run `npm run migrations:check`.
- Migrations are **forward-only and additive**. History is append-only — never edit a migration that has been applied
  anywhere; add a new one. `migrations:check` enforces this against git, applies every migration to an empty database,
  and runs integrity checks.
- Apply: local `npm run db:migrate:local` · staging `npm run db:migrate:staging` · production happens inside
  `npm run deploy`, after a proven backup and *before* the new code goes live.

## Authentication

Sign-in is **Cloudflare Access** in front of the Worker. Every request must carry an Access JWT; the Worker verifies it
against your team's public keys and rejects anything else (fail closed: 401 without a valid token, 503 if Access is not
configured or its keys are unreachable).

One-time setup, in the Cloudflare dashboard:

1. **Zero Trust → Access → Applications → Add → Self-hosted.** Domain: the Worker's hostname
   (`<worker>.<account>.workers.dev` or your custom domain).
2. Add a policy allowing **only** the people who should have access (by email).
3. Copy the application's **Audience (AUD) tag** and your **team domain**.
4. Put them in `wrangler.jsonc` as `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN` (for the matching environment) and deploy.
5. Set session length and review the policy in the dashboard. `npm run verify` lists these as **CONFIRM** items because
   they cannot be read from code.

The user's identity (`userId`, email) is the owner of every record. Details: [`docs/STAGE-1-OWNERSHIP.md`](docs/STAGE-1-OWNERSHIP.md).

## Storage

- **Records and photos are stored in D1.** Photos are validated by content (JPEG/PNG/WebP, ≤ ~1.3 MB) and stored inline
  in the photo row, so a photo is saved or not saved in the same atomic batch as the record it belongs to. They are
  served only through `GET /api/assistant?photoId=…`, scoped to the owner, never cached.
- **There is no photo bucket.** The optional `PHOTOS` (R2) binding in the code is for legacy keys only; nothing creates them.
- Backups, retention and deletion: see [Backup and restore](#backup-and-restore) and [`docs/STAGE-10-PORTABILITY.md`](docs/STAGE-10-PORTABILITY.md).

## AI provider

- Set `OPENROUTER_API_KEY` (preferred) or `OPENAI_API_KEY`:

  ```bash
  npx wrangler secret put OPENROUTER_API_KEY            # production
  npx wrangler secret put OPENROUTER_API_KEY --env staging   # staging (left empty on purpose)
  ```
  For local use put `OPENROUTER_API_KEY=…` in `.dev.vars`.
- The provider is asked for a strict JSON plan (`plan-schema.ts`); its answer is validated before anything is used.
- **Cost control.** In-app limits (per person per hour/day, whole service per day, a pause after repeated failures) are in
  `app/ops/limits.ts`. Also set a **monthly spend cap in the OpenRouter dashboard** — that is the real ceiling.
- **Emergency off:** `npm run flag -- ai off "reason"` (no deploy needed). See the runbook.
- Without a key the app still works; the assistant uses its built-in fallback.

## Tests and checks

| Command | What it runs |
|---|---|
| `npm run lint` | ESLint (TypeScript, React, hooks, accessibility) |
| `npm run format:check` | Prettier (`npm run format` fixes) |
| `npm run typecheck` | `wrangler types` then `tsc --noEmit` |
| `npm run migrations:check` | Migration history, ordering and integrity |
| `npm test` | Production build, then all API/database tests (`tests/*.test.mjs`) |
| `npm run test:unit` | Just the API/database tests (no build) |
| `npm run test:d1` | Migrations on the real D1 engine (Miniflare) |
| `npm run test:e2e` | Browser flows in a phone-sized Chrome, with a scripted fake AI |
| `npm run ci` | Everything above, in CI order |

GitHub Actions (`.github/workflows/ci.yml`) runs these on every push to `main` and every pull request. What each test
level covers, and what only a real phone can prove: [`docs/STAGE-12-TESTING.md`](docs/STAGE-12-TESTING.md).

## Build and deploy

```bash
npm run build                 # production build (vinext → Cloudflare Worker in dist/)
npm run deploy:staging        # build for staging, migrate staging, deploy, verify
npm run deploy                # production — the only supported way
npm run deploy -- --dry-run   # print the plan without doing it
```

`npm run deploy` refuses to continue unless: the working tree is clean and on `main`; lint and tests pass; a backup was
taken **and proven to restore**; migrations apply; the build is really the production build (right Worker, database and
`ENVIRONMENT`); and, after deploying, `npm run verify` passes. Run `wrangler login` once first.

### Staging and production

| | Production | Staging |
|---|---|---|
| Worker | `catnr` | `catnr-staging` |
| Database | `catnr-db` | `catnr-staging-db` (starts empty) |
| AI key | yes | **none, on purpose** |
| Sign-in | Cloudflare Access | closed (503) until you create a separate Access application and fill `ACCESS_*` under `env.staging` |
| Data | real | made-up only |

Configuration for both is in [`wrangler.jsonc`](wrangler.jsonc) (`env.staging`). Never copy production data to staging.

## Backup and restore

Two layers (full detail, retention and security in [`docs/RUNBOOK.md`](docs/RUNBOOK.md)):

1. **D1 Time Travel** — automatic point-in-time restore for the last 7–30 days (depends on plan).
2. **Logical backups** — `npm run backup` writes `backups/catnr-production-<time>.sql` plus a manifest, then **proves it
   restores** into a scratch database. Taken automatically before every production deploy; also run weekly.

```bash
npm run backup                                          # back up production and prove it restores
npm run restore:test -- backups/<file>.sql              # prove any backup restores (throwaway database)
npx wrangler d1 time-travel info catnr-db               # then:
npx wrangler d1 time-travel restore catnr-db --timestamp=<ISO time just before the problem>
npx wrangler d1 create catnr-db-restored                # rebuild from a file into a NEW database:
node scripts/restore-to-d1.mjs backups/<file>.sql --database catnr-db-restored
```

Backups hold real names, locations and photos: keep them private and off the laptop, and delete old ones.

## Rollback

```bash
npx wrangler deployments list                 # find the previous version id
npx wrangler rollback <version-id> -m "why"   # seconds; safe because migrations are additive
npm run flag -- ai off "reason"               # switch a feature off instead (also: photo_uploads, imports)
```

A migration cannot be "un-run": restore with Time Travel to just before it, or fix forward with a new migration.

## Installing on a phone

The site includes a web app manifest and icons, so it can be added to the Home Screen (Safari: Share → Add to Home
Screen) and opens full-screen with the correct safe areas. There is **no service worker**: the app always needs a
connection, because its value (turning speech into validated records) is server-side. See [`docs/STAGE-9-USABILITY.md`](docs/STAGE-9-USABILITY.md).
The manifest is requested with credentials because the whole site sits behind Cloudflare Access.

## Known limitations

- **Needs a connection.** There is no offline mode; an unsent update is kept on the phone until it can be sent.
- **AI quality is checked by hand.** The automated tests use a scripted AI, so they prove the app handles good, unclear
  and invalid answers correctly — not how well the real model chooses between similar cats. Re-check with real phrases
  periodically.
- **Access policy cannot be verified from code.** Who is allowed, session length and the staging application are set in
  the Zero Trust dashboard (`npm run verify` lists them as CONFIRM items). Staging is unusable in a browser until its
  own Access application exists.
- **Browser tests run Chromium** at phone size, not Safari/WebKit or a real touch device. Manual phone procedures are in
  the testing doc.
- **Photos live in D1**, limited to ~1.3 MB each, so very large photo libraries will need a bucket in future.
- **Limits are deliberately small** (assistant: 30/hour, 150/day per person, 400/day overall; photos 100/day; CSV import
  200 rows). They protect cost and the database; raise them in `app/ops/limits.ts` if real use needs it.
- **Money**: six currencies (USD, CAD, EUR, GBP, MXN, AUD), formatted `en-US`; amounts of different currencies are never
  added together. Operational records, not accounting.
- **Quarantined legacy rows** from before ownership existed are kept but frozen; there is no tool to claim them.
- **Request-size cap** is enforced on `Content-Length`; a chunked upload without one is bounded only by the app's own
  checks and Cloudflare's edge limit.
- **Not an App Store app.** A native wrapper (e.g. Capacitor) is possible later; sign-in through Cloudflare Access would
  need a plan for an in-app web view, and Apple requires real native functionality beyond a website.

## Documentation index

[`docs/RUNBOOK.md`](docs/RUNBOOK.md) (operations) · [`docs/PRODUCT-AUDIT.md`](docs/PRODUCT-AUDIT.md) (original audit) ·
`docs/STAGE-1…12-*.md` (one per build stage: ownership, reliability, corrections, validation, clarifications, schema,
records, reports, usability, portability, operations, testing).
