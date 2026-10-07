# Stage 1 ownership

## Authentication
The worker (`worker/index.ts`) is the only place identity is established. It strips any incoming `x-catnr-user-id` / `x-catnr-user-email` headers, verifies the Cloudflare Access JWT (`cf-access-jwt-assertion`, signature, issuer, audience `ACCESS_AUD`, expiry; `worker/access.ts`) and sets the identity headers itself. Missing/invalid token => 401. If Access is not configured on a non-localhost host, the worker fails closed with 503. Only on `localhost`/`127.0.0.1`/`[::1]` does it substitute `dev@localhost`. The API (`ownerFrom`) rejects requests lacking identity or carrying reserved owners (`local-owner`, `legacy:*`). Owner IDs are never read from JSON bodies or AI output.

## Authorization
- Every read/write query is scoped `owner_id = <authenticated user>`, including joins, photo reads, corrections, and AI context (the AI only sees the caller's records).
- D1 has no per-request row-level security identity, so migration 0002 adds triggers: owner required and not reserved, `owner_id` immutable, and every foreign link (cat->colony, event->cat/person/ai_input, photo->cat/event, transaction->person/cat/event/colony/ai_input) must have the same owner as the child. These hold even for buggy application code.
- Photos live in `photos.storage_location` (data URL in D1) and are served only via `GET /api/assistant?photoId=` scoped by owner, `cache-control: private, no-store`. Legacy R2 keys (`cats/<owner>/...`) are served only if an R2 `PHOTOS` binding exists and the key matches the caller's prefix; otherwise 404.

## Legacy `local-owner` data
Migration 0002 retains all rows and moves NULL, empty and `local-owner` ownership to `legacy:quarantine`. No authenticated identity can equal that value, no request can claim it, and triggers reject it on insert/update. Legacy rows are therefore invisible to everyone until an administrator reassigns them. They are never assigned to whoever requests them first.

Recovery (administrator only, no web endpoint):
1. Back up D1. Inventory quarantined rows per table.
2. Establish ownership from independent evidence (e.g. Ari confirms her rows are hers); write a manifest: table, id, target Access email, evidence, connected records. Each connected graph must have a single owner.
3. In one transactional script: drop the 0002 `*_owner_immutable` and `*_ownership_*` triggers, `UPDATE ... SET owner_id=<email> WHERE id IN (manifest) AND owner_id='legacy:quarantine'`, verify no cross-owner links remain, recreate the triggers, commit. Roll back on any mismatch.
4. Rows not in the manifest stay quarantined.

## Tests
`tests/ownership.test.mjs` (anonymous/reserved identity rejected, cross-user reads, photos, corrections denied, body owner spoofing ignored, DB triggers reject reassignment and cross-owner links, AI cannot attach to another user's cat, legacy remains quarantined) and `tests/access.test.mjs` (JWT validation). Run with `npm test`.

## Limits
Triggers do not constrain a database administrator. Ownership is per single user; sharing between volunteers is out of scope. The Access-bypass on localhost is for development only.
