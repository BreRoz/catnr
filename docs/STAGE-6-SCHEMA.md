# Stage 6 — One authoritative database schema

Migrations in `drizzle/` are now the only thing that creates or changes tables. Migration `0007_standard_schema` brings every environment to the same shape.

## What was inspected first

| Database | Finding |
|---|---|
| Migrations 0000–0006 | Correct as history, but columns added later were nullable (`owner_id`), links were only partly foreign keys, ownership/links were checked by triggers alone, and money was `REAL`. |
| Runtime schema creation | The old `ensureSchema` (`CREATE TABLE IF NOT EXISTS` on every request) was already removed from application code in earlier stages; the audit still described it. Its leftover was a database shape (below) and a stale statement in the audit. No request path runs DDL or schema pragmas (a test scans `app/`, `worker/`, `db/`). |
| Production D1 | Migrated through 0006, schema matches the migrations (no drift). Almost empty: 1 `ai_inputs` row and 1 `write_requests` row (owner `bre999@gmail.com`), no money rows. **Not changed by this stage** — `0007` has not been applied to production. |
| Development D1 (`.wrangler`) | Built by the old runtime path: no foreign keys, no triggers, no `d1_migrations`, nullable `owner_id`, 4 demo cats owned by `local-owner`. It could not be migrated in place. |
| Test databases | In-memory; built from migrations. The tests now build from *every* file in `drizzle/` (`tests/helpers/migrations.mjs`) so a new migration is always exercised. |

## The migration (`0007`)

All 16 data tables are rebuilt beside the old ones (`*__n`), data is copied, the old tables are dropped child-first, and the new ones are renamed. No foreign key is ever violated mid-way and the whole file runs as one atomic batch (verified on the real D1 engine: `npm run test:d1`). Nothing is dropped without being copied.

- **Ownership**: new `owners` table. Every owned table's `owner_id` is `NOT NULL` and a foreign key to `owners` (`RESTRICT`). Owners are registered by the database the first time a *verified* identity writes (`*_register_owner` triggers); empty, `local-owner` and `legacy:*` identities are never registered. Existing legacy rows keep the `legacy:quarantine` owner with status `quarantined`.
- **Foreign keys**: every record link is a composite `(link_id, owner_id) → parent(id, owner_id)` key, so a record can only point at a record of the *same* owner even if a trigger were removed. All deletes and updates are `RESTRICT`; nothing cascades, so history cannot vanish. The two `superseded_by` columns (they hold a correction id) are `DEFERRABLE INITIALLY DEFERRED` because the existing correction batch sets them just before inserting the correction row.
- **Uniqueness**: colony and person names are unique per owner, case-insensitively (the app already looked them up that way); a microchip is unique per owner; photos may share `storage_location` (the same inline image can be attached twice).
- **Nullability / vocabularies**: names, statuses, event and transaction types must be non-blank; `sex`, `age_class`, person `type`, `direction`, `colonies.status` are `CHECK`ed; a photo must belong to a cat or an event; `confidence` is 0–1.
- **Indexes**: owner-leading indexes for every link column (partial where the link is optional) plus the existing query indexes.
- **Timestamps / audit**: `created_at` has a default everywhere; `updated_at` added to colonies, people, events and transactions and kept current by the existing version/touch triggers. `photos.created_at` added. Provenance is unchanged: `source_input_id` links records to the original input, and corrections keep who/when/why.
- **Triggers/views**: all earlier triggers and the `active_*` views are recreated (the frozen-transaction trigger now guards `amount_minor`, `currency`, `estimated_value_minor`).

## Money

- `transactions.amount_minor` and `estimated_value_minor` are `INTEGER` minor units (cents), with a `CHECK` that the stored type is really an integer and ≥ 0. A fractional or text value cannot be stored.
- `currency` is `NOT NULL` and a foreign key to the new `currencies` table (`code`, `minor_unit`, name): USD, CAD, EUR, GBP, MXN, AUD. Adding a currency is a data migration. A currency in use cannot change its `minor_unit`.
- `app/money.ts` converts decimal input to minor units **exactly**: `19.99 → 1999`; `10.005`, `0.1 + 0.2`, `1e-7`, negatives and unsupported currencies are rejected, never rounded. Validation applies it to `amount` and `estimatedValue` and rejects the whole AI plan otherwise. The MVP default is explicit: no currency stated → `USD`, stored in the row.
- Totals are `SUM` of integers grouped by currency. The API returns `stats.cashIn` / `cashOut` as `[{currency, minor}]` plus display text (`"CA$5.00 + $149.49"`); currencies are never added together. The home screen shows the text.
- **Upgrade**: `amount REAL → round(amount*100)` only after a guard proves every legacy amount is a whole number of cents; otherwise the migration aborts with `legacy amount is not a whole number of cents` and nothing changes. A legacy `NULL` currency becomes `USD`; an unknown one aborts. `quantity` stays `REAL` (a count of items, not money).

## Reconciling existing databases

- **Production**: already migrated through 0006 → `npm run db:migrate` applies `0007`. Rehearsed first on an export of the real production database loaded into the real D1 engine: applied as one batch, 0 foreign-key violations, owner and rows intact, no leftover `__n` tables.
- **Development**: `npm run db:reset:local` detects a database that predates migrations, copies it to `.wrangler/state/v3/d1-backup-<timestamp>/`, and rebuilds from migrations. It was run: the 4 demo cats are in the backup; the rebuilt database has a schema identical to a fresh install. A second run is a no-op. Legacy data is intentionally not imported (it predates ownership and would be quarantined).
- **Tests**: always built from migrations.

## Tests

`tests/schema.test.mjs` (17): fresh install is consistent; every owned table has a mandatory owner FK; every link is an owner-scoped `RESTRICT` FK; FKs hold with the ownership triggers dropped; parent deletes and owner removal are refused; owner registration rules; uniqueness; nullability/defaults/timestamps/vocabularies; exact money in the database (integers only, unknown currency rejected, per-currency sums); money module (conversion, rejection, formatting, 100k round trips); currencies table equals the module; **upgraded schema == fresh schema** with legacy data converted; half-cent and unknown-currency aborts roll back; `db/schema.ts` columns equal the migrated database; no DDL/schema pragmas in application code; tooling cannot generate divergent migrations. `tests/reliability.test.mjs` adds an end-to-end money test (POST exact cents, rejects 10.005 / float noise / exponent / negative / too large / `JPY`, per-currency totals, nothing written on rejection). `npm run test:d1` repeats upgrade, fresh install, constraints and rollback on the real D1 engine.

Full suite: `npm test` (build + 88 tests) passes; `npm run test:d1` passes.

## Other changes

- `db/schema.ts` rewritten as a readable typed description of all 18 tables (was a compressed, partial file); a test keeps its columns identical to the database.
- Removed `db:generate` and `drizzle.config.ts`: `drizzle-kit generate` works from snapshots that stop at 0001 and would emit a migration that conflicts with the real schema. Added `db:migrate:local`, `db:reset:local`, `test:d1`.
- `person()` now binds `null` instead of `undefined` for optional fields (a D1 binding error waiting to happen).

## Limits and risks

- **`0007` is not applied to production.** Run `npm run db:migrate` (ideally right before `npm run deploy`, since the new code reads `amount_minor` and the old code reads `amount`; deploying one without the other breaks money reads/writes). Production currently holds no money rows.
- New uniqueness can now make a write fail where it used to create a duplicate: renaming a person/colony to an existing name, or recording a microchip already used by another cat. The action fails as a whole and nothing is half-saved; the message to Ari is the generic retry text, not a friendly "that chip already belongs to Milo".
- Quarantined legacy rows are copied but stay frozen (as before); there is still no tool to claim them.
- Drizzle's own migration snapshots (`drizzle/meta/*_snapshot.json`) stop at 0001 and are not used; `drizzle-kit` is now an unused dev dependency.
- Money formatting is `en-US`; all six supported currencies have two decimals, and the SQL/JS paths assume the table's `minor_unit` (a zero-decimal currency would need `app/money.ts` and its test updated together).
- The UI change (cash totals text) is covered by build and API tests, not a browser test.
