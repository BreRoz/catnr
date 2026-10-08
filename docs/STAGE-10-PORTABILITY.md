# Stage 10 — Portability and account controls

Migration `0009_portability.sql`. Code lives in `app/portability/` (logic), `app/api/manage/{export,import,account}/` (routes) and `app/records/{data-panel,import-flow,delete-account}.tsx` (the **My data** tab).

## Export
`GET /api/manage/export` (summary) and `?download=zip|json|csv&profile=full|shareable[&table=…]`.

* **ZIP** (recommended): `README.txt`, `export.json`, `csv/{cats,colonies,people,events,transactions,photos}.csv`, and `photos/<id>.<ext>` (the real image bytes). Streamed one photo at a time, so memory stays flat.
* **JSON** holds every owned table: colonies, people, cats, events, photos (metadata + file name), transactions, ai_inputs (what Ari said and what the AI understood), corrections, record_changes, merges, proposed_actions, clarifications (+answers), duplicate_dismissals. Archived, voided, superseded and merged-away rows are included. Money is integer minor units + currency. Ownership ids are stripped.
* Left out on purpose: `owners`, `write_requests`, `write_guards`, `rescue_revisions`, `proposal_executions`, `clarification_resolutions` (technical bookkeeping), and queued photo bytes inside `clarifications`.
* CSV cells that start with `= + - @` get a leading `'` (spreadsheet formula injection); a UTF-8 BOM is written so Excel reads accents.
* Responses are `no-store`, `attachment`, `nosniff`. Every download is logged in `data_exports` (profile, format, counts — never content).
* The **shareable** profile is an allow-list: cats, colonies, events and transactions only, with no colony address/coordinates/notes, no people or contacts, no descriptions or notes, no health or location text, no microchips, no photos and no audit trail. New columns stay private until someone adds them to the list.

## Import
`POST /api/manage/import` with `mode: "preview"` (writes nothing) or `"commit"`. Kinds: cats, colonies, people, events, transactions.

* Input is CSV (also `;`/tab separated, BOM, quoted line breaks) — saved from Excel/Sheets or pasted. Columns are matched by forgiving names; unmatched columns are listed, not guessed.
* Every row goes through the **same planner as manual entry** (`write()` in `app/manage/*`), so imported records obey identical vocabularies, uniqueness, owner-scoped links and money rules; audit rows say `Imported from <file>`.
* Preview returns per-row `ready | duplicate | error` with the reason, the column mapping, and a downloadable "rows to fix" CSV.
* Commit is one atomic batch through `applyWrite` (retry-key replay, revision guard). Any problem row blocks the import unless Ari ticks “skip the ones with problems”. Rows already present (same name / microchip / cat+type+day / date+type+amount+description) are skipped, so re-importing a file is safe.
* Imported history **does not change a cat's current status** (`keepStatus`), and links (cat, colony, person) must already exist — import people, colonies and cats first.
* Limits: 200 rows / 1.5 MB per file (each row costs a few D1 lookups; a Worker request has a lookup budget).
* **Evaluated, not built:** *XLSX* (needs a parser dependency; Excel/Sheets export CSV in two clicks). *Photo metadata*: photos are shrunk in the browser before upload, which already removes EXIF (date, GPS), and carrying GPS in would put a colony's location inside pictures. Dates can be set per photo; bulk photo import is not offered.

## Account deletion
`GET /api/manage/account` (what will happen), `POST` with `action: request | cancel | confirm`.

1. **Ask** — nothing changes. 2. **Wait 24 hours** (cancel any time; records stay usable). 3. **Confirm** — type `DELETE MY RESCUE DATA`; the request must carry the revision Ari last saw, otherwise it is refused (“your records changed”).
* Deletion is one D1 batch: a write-guard insert, a `deletion_in_progress` marker, deletes in dependency order (corrections one layer at a time because undo → corrected), the owner row, the marker removal and a receipt. Any failure rolls the whole thing back.
* The immutable-history triggers (`record_changes`, `corrections`, `merges`, `duplicate_dismissals`, `*_keep_*_history`) were recreated to stand down **only** while that owner's marker exists. Application code inserts the marker in exactly one place (tested).
* `deletion_receipts` keeps date + row counts only. Cross-site POSTs are refused (Origin check in `serve`).
* After deletion the next sign-in starts an empty account.

## Retention (`app/portability/retention.ts`, shown in the UI)
| Data | Kept |
|---|---|
| Voice recordings | Never stored (browser speech-to-text; only text is uploaded) |
| Transcripts and AI interpretation | Until account deletion |
| Photos (incl. hidden) | Until account deletion |
| Photo queued with an unanswered AI question | 7 days after answered/expired, then wiped (automatic) |
| Audit logs (change history, corrections, merges) | Until account deletion |
| Archived / removed / replaced / merged records | Until account deletion; hidden, never destroyed |
| Money records | Until account deletion (UI warns charities may need to keep them for years) |
| Retry-safety cache (`write_requests`) | 30 days (automatic) |
| Download log | Until account deletion |
| Deletion receipt | Kept; no personal data |

Automatic rules run daily from the worker's `scheduled` handler (cron `15 4 * * *` in `wrangler.jsonc`). The immutability trigger on `clarifications` now allows `photo_data` to be wiped to NULL, never replaced.

## Privacy
No public endpoint or public report exists; every route needs Access identity. Report queries never select locations, coordinates, contacts or notes (tested). Colony locations and contact details only leave the app in a **full** export that Ari downloads herself, and the UI says so.

## Tests
`tests/portability.test.mjs` (25) plus the real-D1 check `npm run test:d1` (whole-account deletion on workerd). `tests/schema.test.mjs` updated for the new tables.

## Not done / remaining risks
* No restore-from-export: the export is complete and standard, and CSV can be re-imported as *new* records, but there is no one-click rebuild of history (ids, audit trail, corrections) from `export.json`.
* Transactions/events import cannot create the people or cats they reference; they must exist first.
* Backups at Cloudflare may retain deleted rows briefly; Access sign-in is not removed by deleting data (separate admin step).
* A request in flight at the moment of deletion could re-register an empty owner (harmless, but not blocked).
* Photos stored outside D1 (legacy R2 keys; none are created today) are counted and warned about but not deleted — there is no R2 binding.
* Cron wiring was verified by config/tests only; it has not yet run in production. `npm run db:migrate` must be run on the remote D1 before deploying.
* The UI was checked in the in-app browser at phone width (import preview/commit, delete request/cancel, ZIP download); not tested on a real phone, and the final "type phrase → delete" click-through was covered by tests, not the browser, to avoid wiping dev data.
