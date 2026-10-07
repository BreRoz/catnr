# Stage 7 — Everyday record management (no AI required)

Ari can now find, add, edit, archive, restore, reverse and merge cats, colonies, people and money **by hand**, from the new **Records** tab. None of it calls the AI; none of it needs the provider to be up.

## What was inspected first

- Every write went through `/api/assistant` (AI plan → validation → one atomic D1 batch with retry receipt + revision guard). The only manual action was correcting an event/transaction, and that also went through the AI.
- Cats, colonies and people had no archive state, no search, no pagination (home list capped at 50). Photos had a bare per-cat list and `no-store` images.
- Constraints that shaped the design: every link is an owner-scoped `RESTRICT` FK; superseded events are frozen (including `cat_id`/`person_id`); colony/person names were unique including archived rows; `colonies` had no `version`.

## Schema (migration `0008_everyday_records`)

- `archived_at` (+ `archive_reason`) on cats, colonies, people; `archived_at` on photos; `voided_at`/`void_reason` on events and transactions. `active_events`/`active_transactions` now also hide voided rows, so totals and histories exclude them automatically.
- Colonies gain `version` (one trigger keeps `version` + `updated_at`, replacing `colonies_touch`), `latitude`, `longitude`; people gain `notes`.
- Colony and person name uniqueness now applies only to **non-archived** rows, so an archived or merged-away name never blocks reuse. (Microchips stay unique across all cats.)
- New tables: `record_changes` (immutable before/after history of every manual change; photo bytes are never copied into it), `merges` (immutable; who/what/when, ids moved, conflicts, full before-snapshots), `duplicate_dismissals` ("these are different").
- Triggers: audit/merge/dismissal rows cannot be updated or deleted; a cat/colony/person with audit or merge history cannot be deleted; ownership of every audited record is checked.
- Search/paging indexes: `(owner_id, updated_at)` on cats/people/colonies, `(owner_id, date)` on transactions.

## API (`/api/manage/*`, all owner-scoped from the verified identity)

| Resource | Reads | Writes (`action`) |
|---|---|---|
| `cats` | list (`q, status, colonyId, sex, ageClass, hasPhoto, archived, sort, page, pageSize`), `?id=` detail with paged history, change log, merged-from | create, update, archive, restore |
| `colonies`, `people` | list + filters + `?id=` detail (cats / money / relevant history) | create, update, archive, restore |
| `events` | via the cat | create, update, void, unvoid |
| `transactions` | list (`q, type, direction, category, currency, personId, catId, colonyId, from, to, status`) with per-currency totals of the filtered counted entries | create, update, void (reverse), unvoid |
| `photos` | gallery metadata (never image data), `?image=<id>` one image (ETag, private cache) | upload, caption, archive (hide), restore |
| `duplicates` | `?type=cat|person|colony` | `dismiss` |
| `merges` | `GET` = read-only preview | `POST` = merge |

Every write: validated server-side; ids and ownership never trusted from the client; planned without writing, then committed as **one D1 batch** with the retry receipt, the revision guard and its audit rows (so a retry never duplicates and a concurrent change is refused). Edits carry the `version` the user saw; a stale version is refused with "reload and try again".

## Behaviour

- **Cats**: a name is optional (an entirely empty cat is refused). Status follows the history when an event implies one (adopted, foster…), only if that event is now the latest. Microchip uniqueness gives a friendly "X already has that chip — merge instead".
- **Events/transactions are never edited in place.** An edit inserts a replacement, supersedes the original and writes a `corrections` row (`made_by='user'`), the same mechanism the assistant uses, so the chain is visible and the assistant's undo works on it. **Reversing** (void) hides an entry from totals without replacing it and can be undone. Money is exact integer cents (same module as the AI path); decimals with extra places are refused, never rounded.
- **Search** is case-insensitive, every word must match somewhere, LIKE wildcards are literal. **Pagination** is page/pageSize (max 100) with totals; tested over 1,500 cats.
- **Photos**: list queries never select `storage_location`; images load one at a time with `ETag`/`max-age`; thumbnails are lazy. Hidden photos are archived, never deleted.
- **Duplicates** (deterministic, no AI): cats by name and by description within a colony; people by name order, near-identical names, shared email/phone; colonies by name ignoring small words, near-identical names, same location. Cats with different microchips or different known sexes are never suggested and can never be merged. "Not the same" is remembered; Ari can still merge any two records by hand.
- **Merge** (preview first, explicit confirm, both versions checked): active events, photos, money and relationships move to the record Ari keeps; blank fields are filled from the other; different values are **never overwritten** and are written into the merge record and (for cats) a history entry; the other record is archived, not deleted, and can't be restored or merged again. Superseded events stay on the archived record (they are frozen history); the survivor's history view includes everything merged into it.
- **The assistant** now ignores archived records (snapshot, plan validation, answers), and a name that belongs to a merged-away colony/person resolves to the survivor instead of recreating a duplicate.

## UI

New **Records** tab (`app/records/*`, separate small components): Cats (filters, detail with edit, history add/edit/remove, photo gallery, change log, archive/restore, merge), Colonies, People, Money (filters, date range, totals, add/edit/reverse), Duplicates. Retry keys are reused for a retry of the same request, so a lost connection can't double-save.

## Tests

`tests/records.test.mjs` (12), `tests/merge.test.mjs` (12), plus a Stage 7 test in `tests/reliability.test.mjs` and new assertions in `tests/d1-runtime-check.mjs`: CRUD for each record type, validation, version conflicts, owner isolation, atomic rollback (failure injected at every merge statement), idempotent retries, search/filter/paging over 1,500 rows, exact money, void/restore, status repair, photo gallery, duplicate detection (incl. 2,000-record scale), merging of cats/people/colonies preserving events, photos, money, relationships and audit, refusal of unsafe merges, immutability of audit/merge history, and the assistant's treatment of archived/merged records. Helpers: `tests/helpers/load-ts.mjs` (loads TypeScript modules for tests), `tests/helpers/records.mjs` (D1-shaped adapter).

## Limits and risks

- **`0008` is not applied to production** (nor is `0007` yet). Run `npm run db:migrate` immediately before `npm run deploy`; deploying the code first breaks reads of the new columns. Verified on the real D1 engine (`npm run test:d1`) and on a local dev D1.
- Merges are not undoable from the UI (everything needed to reverse one is stored in `merges.summary`; no unmerge tool yet).
- Editing a transaction/event creates a new record id; the assistant's old correction chain remains valid. A voided event's status repair covers the status-implying events only.
- Manually-created events can't exist without a cat; people/colony changes have no timeline entry beyond the change log.
- The AI correction flow now refuses to correct an activity if the plan references an archived cat (edit it by hand instead).
- Photos are still stored inline in D1 (≤1.3 MB each) and not resized server-side; the gallery is paged at 24 and lazy-loaded, which is fine for hundreds of photos per cat set, not for tens of thousands.
- Search is a substring scan within one owner's rows: fine for thousands of records; at tens of thousands move to SQLite FTS.
- Nothing in the new UI is covered by an automated browser test; it was exercised by hand against the dev server (Records tab, merge flow, cat detail) and by API tests.
- Pending AI proposals/clarifications that mention a cat which is merged/archived afterwards are rejected on approval rather than redirected.
