# Stage 2: reliable recording

## Write-path audit

All active rescue mutations originate in `app/api/assistant/route.ts` POST and PATCH. There are no direct client database writes. `examples/d1/` is an unused starter example, not a rescue API.

| Operation | Atomic records |
| --- | --- |
| Cat creation | Cat, optional colony/person, events, input audit, receipt |
| Event creation / adoption | Event, cat current fields/status, optional person, input audit, receipt |
| Financial/resource recording | Transaction, optional person/cat/events, input audit, receipt |
| Photo recording | Validated image and photo association, cat/event changes, audit, receipt |
| AI multi-operation recording | All interpreted changes together |
| Activity correction | Replacements, linked cat/person updates, photo/transaction event relinking, original activity deletion, original record preserved in audit, receipt |
| Questions / social / clarification | Input audit and receipt only; generated mutations ignored |

## Commit and retry protocol

D1 `batch()` is the only write execution boundary. During preparation, statements are queued and locally created cat/person/colony IDs resolve without prematurely inserting rows. Any constraint, ownership, version, photo, or later-statement failure rolls back the entire batch, including audit and receipt. No application `BEGIN`/`COMMIT` calls are used against D1.

Each UI save sends a UUID `requestKey`. Retries of the same payload retain that key. The owner/key primary key and payload SHA-256 prevent duplicate commits and key reuse for different payloads. The response is stored in the same batch; receipt replay precedes interpretation and correction target lookup. A lost response after commit can therefore be recovered even when the replaced activity no longer exists. Older callers without a key use a content digest, deduplicating identical payloads indefinitely; callers intentionally recording an identical new occurrence must supply a fresh key.

An owner-wide revision, maintained by database triggers for all rescue tables, is checked before snapshot collection, after snapshot collection, and inside the commit batch. Concurrent distinct writes using the same revision yield one commit and one conflict. This conservative strategy also protects changes during slow AI calls and relationship changes/deletions. Unrelated simultaneous writes for the same owner may conflict and need review/retry. Activity version tokens prevent corrections opened in stale UI from overwriting newer edits. Query results return the version alongside each activity.

Questions, social drafts and clarification plans cannot mutate rescue records. Correction plans must contain a replacement of the requested record type. Basic plan/reference/amount checks run before commit; database ownership constraints remain authoritative.

## Photo recovery

New images are validated before interpretation, capped at 1,800,000 data-URL characters (approximately 1.3 MB binary), and stored directly in the photo row. This deliberately removes the distributed R2/D1 commit problem for new recordings: there is no separate uploaded object to orphan, no dangling reference when upload/database fails, and no asynchronous processing after a successful commit. Photo failure prevents all rescue changes. Successful photo records appear in audit `records_created` and have a cat or event association. Existing R2 photos remain readable and are relinked rather than deleted by corrections.

Browser images are decoded/resized before submission; read/decode/canvas failures are shown without saving. Original speech transcription and AI interpretation remain in `ai_inputs`; submitted image bytes are preserved in the photo record referenced by that input's audit. Clarification retains the selected image in the UI for the next attempt. Failed operations retain unsaved words/photos in the UI, rather than creating a partial database audit.

Definitive success is returned only after commit or receipt replay. If the connection fails or commit acknowledgement and receipt lookup are unavailable, the UI reports unknown save status and invites a safe retry; it never claims that nothing changed in that situation. Server rejections/conflicts display their actual message. Receipt keys are retained in memory while retrying; reloading the page discards unsaved UI input and its key.

## Migration and verification

Apply `drizzle/0003_reliable_recording.sql` after Stage 1 and before running this code. It adds version columns/triggers, revision tracking, retry receipts and batch assertion guards. Deployment was not performed in this stage. Existing R2 orphan objects predating Stage 2 are not automatically deleted; there is no historical object inventory/migration in scope.

`tests/reliability.test.mjs` exercises full multi-record success, failure at every batch step, invalid/oversized/photo-provider failures, response loss after commit, identical retries, simultaneous duplicate requests, simultaneous distinct adoption edits, late invalid AI references, failed and successful corrections with linked photos/transactions, stale UI versions, and nonmutating plans. Tests use real SQLite with foreign keys and all migrations, and a serialized D1-compatible batch adapter. Existing ownership and MVP tests also run.

`node tests/d1-runtime-check.mjs` is a separate local Miniflare/workerd D1 check (requires permission to bind localhost). It verified all four migrations, revision/version triggers, trigger-based conflict rejection, and real D1 batch rollback. The application build succeeds. Repository lint still reports existing `any`, hook, accessibility, and test-regex issues; standalone TypeScript checking still lacks the pre-existing Cloudflare environment type declarations. These are not readiness claims or Stage 3 work.
