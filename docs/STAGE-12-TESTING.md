# Stage 12 — Real verification

What is tested, at which level, how to run it, what the tests found, and what only a real phone can prove.

## Run it

| Command | What it runs |
|---|---|
| `npm run lint` | ESLint (TypeScript, React, hooks, a11y, Next rules). No suppressions were added to get it green. |
| `npm run typecheck` | `wrangler types` (generates `worker-configuration.d.ts`, git-ignored) then `tsc --noEmit`. |
| `npm run migrations:check` | Journal matches the files; history is append-only against `$MIGRATIONS_BASE` (default `HEAD`); all migrations apply in order to an empty database; foreign-key and integrity checks pass. |
| `npm test` | Production build, then the API/database tests (`tests/*.test.mjs`, 204 tests, `node:sqlite`). |
| `npm run test:d1` | Migrations on the real D1 engine (workerd via Miniflare): upgrade path = fresh path, FK enforcement, atomic rollback. |
| `npm run test:e2e` | Browser flows in a phone-sized Chrome (see below). Needs Chrome installed locally, or `E2E_BROWSER=chromium npx playwright install chromium`. |
| `npm run ci` | All of the above, in CI order. |

`.github/workflows/ci.yml` runs the first group (`checks` job) and the browser job on every push to `main` and every pull request.

## Coverage map

| Area | Where it is proven |
|---|---|
| Authentication | `access.test.mjs` (Access JWT: missing, malformed, forged, wrong audience/issuer), `ownership.test.mjs` (anonymous and reserved identities get 401 on every method), browser `signin.spec` (a worker with Access configured serves no page and no record, and a forged token or identity header does not help) |
| Authorization / ownership | `ownership.test.mjs`, `corrections`, `merge`, `reports`, `portability`, `records` tests (each includes a second owner who must see and change nothing); browser flow 1 (an invented identity header is ignored) |
| CRUD | `records.test.mjs` (cats, colonies, people, transactions, events, photos: create, edit with version check, archive/restore, void/unvoid); browser flows add / edit / event / photo / money |
| AI operation validation | `validation.test.mjs` (malformed JSON, unknown fields, bad dates/amounts/IDs, foreign IDs, injection, questions never mutate, consequential changes only proposed, tampered/expired proposals) |
| Idempotency | `reliability.test.mjs` (same key replays, lost acknowledgement, legacy requests without keys), `portability` (import twice), `merge` (retries) |
| Concurrency | `reliability.test.mjs` (simultaneous identical requests commit once; simultaneous distinct edits reject the stale plan) |
| Clarification workflows | `clarifications.test.mjs` (survive reload/delay, photo kept, stale/expired/cancelled, owner-bound) and the browser flow that asks, survives a reload, is answered, and applies the update exactly once to the right cat |
| Financial transactions | `schema`, `records`, `reports`, `corrections` and `reliability` tests: exact minor units, per-currency totals, in-kind kept apart from cash, corrections and undo; browser flow records a donation (form) and an expense (assistant) |
| Reports | `reports.test.mjs` (definitions, periods, unknown ≠ needs-surgery, owner scoping, read-only); browser flow checks the numbers on screen equal what was entered |
| Ownership, constraints, foreign keys, "RLS" | `schema.test.mjs`, `ownership.test.mjs`. **D1/SQLite has no row-level security.** The equivalent is enforced in the database: `owner_id NOT NULL`, composite `(id, owner_id)` foreign keys on every relationship, triggers that block owner reassignment and cross-owner links, plus owner-scoped queries. The tests try to break each of these directly in SQL. |
| Migrations | `migrations:check`, `schema.test.mjs` (schema.ts matches the migrated database), `test:d1` (real engine, upgrade vs fresh) |
| Transaction integrity | `reliability.test.mjs` (a failure at every statement of a batch restores the previous state), `merge` (rolls back part-way), `portability` (import and account deletion are all-or-nothing) |
| Browser | `tests/e2e/flows.spec.mjs`: signed in, add cat, record event, upload photo, edit cat, assistant update, clarification, search, donation, expense, report |

### How the browser tests work

`tests/e2e/server.mjs` starts a scripted stand-in for the AI provider (`fake-ai.mjs`), builds a **fresh database from the checked-in migrations only**, and runs the app as the throwaway wrangler environment `e2e` (no Access, localhost identity). The app makes its normal provider request; the stand-in answers with a fixed plan chosen by what Ari "says". The URL override is honoured **only when `ENVIRONMENT` is `e2e`**, so it cannot redirect production AI traffic. A second copy (`e2e-locked`) keeps Access settings to prove the sign-in wall.

What this does **not** prove: the quality of the real model's interpretation, a real Cloudflare Access login, Safari/iOS behaviour, the microphone or the camera. See the manual procedures below.

## What the verification found and fixed

1. **Real bug (found by the browser test): a question from the assistant did not appear until the page was reloaded.** After the assistant asked "which gray cat?", closing the sheet left the Home screen without the question card, and Ari's words were also kept as an "unsent update", so the same update showed up as a draft *and* as a question. Fixed in `app/rescue-client.tsx` (re-read after closing) and `app/capture-sheet.tsx` (once the server holds the question, the phone's copy is released). No input is lost: the server stores the original words with the question.
2. **Type checking never ran clean.** 86 errors: the Cloudflare types were never generated, and untyped JSON was used as typed data. `npm run typecheck` now generates the types first; `types/env.d.ts` declares the secrets and optional bindings; the three client files that read `response.json()` now declare the shape they expect.
3. **43 `any` in `app/api/assistant/route.ts`.** Replaced with real types (`CatRow`, `ProposalRow`, `ClarificationRow`, `TxnRow`, `RequestBody`, provider response shapes). A few `!` assertions remain (`original`, `inputRow`) where earlier code has already refused a missing record and TypeScript cannot follow that across the branches.
4. **Test mocks did not behave like D1.** They returned SQLite's result shape (`changes`), D1 returns `meta.changes`. The mocks now return both.
5. **Lint:** two unused variables in `tests/clarifications.test.mjs`. `@next/next/no-img-element` is switched off with a stated reason (Next's image optimizer does not run on Workers; photos come from the authenticated endpoint).

## Manual test procedures (real phone)

Run these on a real phone, on the deployed staging site (`npm run deploy:staging`) first, then production after a release that touches capture, photos or sign-in. Use the phone's own browser (Safari on iPhone, Chrome on Android) and also "Add to Home Screen" if Ari uses it that way. Note device, OS, browser and the result in the table at the bottom.

**M1 — Sign-in.** Open the site in a private tab: you must reach the Access login, not the app. Sign in; the app opens. Close the tab, reopen: still signed in (session length as configured). Open the site on a different, not-allowed email: refused.

**M2 — Voice.** Home → *Speak an update*. First time: the browser asks for microphone permission; allow it. Say: "The thinner black boy from Jefferson got neutered today, rabies and FVRCP." Expect: the words appear while speaking, and the button reads *I'm listening…*; stop; the text is editable; *Review & record* works. Also test: (a) deny the permission → a plain explanation and the sheet switches to typing, nothing lost; (b) speak, then lock the phone, return → words still there; (c) noisy place (car) → misheard words can be corrected before saving.

**M3 — Camera.** Home → *Add photo* → *Take photo*. Allow camera access. Take a photo of a cat; it appears as a preview; add words; *Save photo*. Then: (a) *Photo library* with an existing photo; (b) a very large photo (12 MP+) → accepted and shrunk, no error; (c) deny camera permission → the hint under the buttons explains where to enable it, and *Photo library* still works; (d) HEIC photo from an iPhone → accepted.

**M4 — Photo on a cat.** Records → Cats → a cat → *+ Add photo*. The photo appears in the gallery; reload; still there; open it, add a caption.

**M5 — Poor connection.** Turn on airplane mode, then try to save an update. Expect a plain message saying it did **not** save (or that it is unsure), and the typed words kept. Turn the network back on and tap *Try again*: it saves once (check Activity: one entry, not two). Repeat with the network dropping *during* the save (start saving, switch airplane mode on).

**M6 — Interrupted work.** Start typing an update, switch to another app for a few minutes, return: the draft is intact. Close the browser tab entirely, reopen: *You have an update that isn't saved yet* offers to continue.

**M7 — Unclear update.** Say something that matches two cats ("The gray one got spayed"). Expect one quick question; close the sheet; the question is on Home; answer it from there; the right cat gets the entry once.

**M8 — Layout.** On the smallest phone available, check Home, a cat sheet, the Money form and Reports: nothing cut off sideways, buttons reachable above the keyboard, the bottom tab bar never covers a button, text readable at the phone's larger-text setting.

| Date | Device / OS / browser | M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |

## Known limits

* The browser tests run Chromium at phone size, not WebKit/Safari and not a real touch device.
* The scripted AI proves the app handles a valid plan, a clarification and an unclear answer correctly; it says nothing about how well the real model chooses between cats. That needs periodic manual checking with real phrases.
* Real Cloudflare Access login and its session settings are not automated (they live in the Zero Trust dashboard); M1 covers them.
* `npm test` and the browser tests share nothing, so a failure in one does not hide the other; they do both depend on `wrangler types` having been generated once (`npm run typecheck` does it).
