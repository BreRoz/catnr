# Stage 3: versioned, reversible corrections

## What changed
A correction no longer deletes anything. The original activity (event or transaction) is marked **superseded** and linked to its replacement by a row in `corrections`. Reads go through the `active_events` / `active_transactions` views, so lists, cat history, stats and AI context show only current records, while the originals stay in the base tables.

Each `corrections` row keeps: kind (`correction`/`undo`), record type, original and replacement IDs, who (`actor_id`) and what (`made_by`: `assistant` or `user`), Ari's words (`reason`), the AI input that produced it (`source_input_id`, which holds her transcription and the AI interpretation), a full snapshot of the original, the cat fields changed (`cat_changes`, from/to), the photo and transaction IDs relinked, and timestamps. Photos, linked transactions and the new photo follow the replacement; undo moves them back.

## Safety rules
- Replacement is validated before anything is queued: exactly one replacement of the same type, no other events/transactions, no new cats, only the cat tied to the activity may be updated, no colony changes, an event that belonged to a cat must still belong to one. Otherwise the user gets a clarification and nothing is written. Omitted dates keep the original date.
- Cat status: an explicit status in the corrected plan wins. Otherwise the status is recomputed from event history **only if** the cat's status was produced by that history (not set by a later event or by hand).
- Undo (`DELETE /api/assistant {correctionId, requestKey}`) is refused unless it is safe: the correction must be applied and not already undone, the replacement must not have been corrected again (unwind newest first), and every cat field the correction changed must still hold the value the correction gave it. Unrelated later edits are preserved. Undo re-activates the original, retires (does not delete) the replacement, restores the changed cat fields and relinks attachments.
- All of it is queued into the existing single D1 batch with the receipt and revision guard, so corrections and undo are atomic, retry-safe and conflict-checked. A partial unique index allows one applied correction per original.
- Database triggers: superseded/corrected records cannot be deleted or have content rewritten; `corrections` rows cannot be deleted or rewritten (only applied -> undone); ownership of every referenced record is checked.

## API
- `PATCH` (correct) – returns `correctionId`; 409 `clarification`/`conflict` when unsafe or stale.
- `DELETE` (undo).
- `GET ?corrections=1[&recordId=ID]` – audit history (whole chain for a record). Activity items include `correctionId` when they are an undoable replacement.

## Limits
- Undo is single-step and newest-first; there is no redo (correct again instead).
- Only events and transactions are correctable; cat profile edits are not versioned.
- A people/colony record created by a correction's plan is kept after undo.
- Migration `drizzle/0004_versioned_corrections.sql` must be applied before deploying; not deployed in this stage. Existing hard-deleted originals from before this stage survive only in `ai_inputs.correction`.
