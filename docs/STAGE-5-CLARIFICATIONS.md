# Stage 5 — Complete clarification workflows

When the system must ask Ari a question, the half-finished update is kept as a **pending clarification** (`clarifications`, migration `0006`). Ari's short reply ("the thinner one") finishes the *original* update; she never repeats it.

## What is stored
Original words (`original_text` + the `ai_inputs` row), mode, the question, candidate cats (id, description, version), the interpreter's proposed plan, any photo (`photo_data`), session id, owner, `created_at`/`expires_at` (3 days) and `status`: `pending → resolved | cancelled | expired | stale`. Original fields are immutable and a finished clarification cannot be reopened (triggers). Every reply is kept in `clarification_answers` (question asked, answer, outcome, its own `ai_inputs` row).

## Flow
- **Ask**: an ambiguity (or an interpreter `clarify`) writes nothing to rescue records; it stores the clarification and returns `clarificationId`.
- **List**: `GET /api/assistant?clarifications=1` (pending only; overdue ones are expired first). This is how the home screen restores questions after a reload.
- **Answer**: `POST {clarificationId, input}`. The answer is bound to that id and owner only; it is never matched to a question by guessing. The interpreter sees the original update, the question, candidates and the answer, and the result goes through the same validation, ambiguity gate and approval rules as any update (an adoption still becomes a proposal needing OK).
  - Answer still unclear, or naming a cat outside the candidates → the question stays pending with a new question, `attempts` +1, nothing changes.
  - Resolved → records, `clarification_answers`, `clarification_resolutions` (primary key) and the status change commit in one atomic batch, so a second answer can't apply twice.
  - The stored photo is used (a photo sent with the answer is ignored) and is also kept for a follow-on approval, so Ari need not re-add it.
- **Cancel**: `DELETE {cancelClarificationId}`. History is kept; nothing else changes.
- **Expired**: after 3 days. **Stale**: a candidate cat was changed or removed since the question; the answer is refused and Ari is asked to restate the update.
- **Multiple**: each pending question has its own card and answer box. A message sent without a `clarificationId` is a new update, never a guessed answer.

## Tests (`tests/clarifications.test.mjs`)
One pending (full Ari example incl. approval), immediate apply and double answer, multiple pending and cross-owner, photo (direct and via approval), reload + 2-day delay, cancelled, expired (listed and on answer), stale, ambiguous answers (twice, then resolved), DB triggers, no-AI case. Full suite: 70/70 pass; `npm run build` succeeds.

## Limitations
- A clarification created because the interpreter replied `clarify` with no cats has no narrowed candidate list; the answer is interpreted against all stored cats (the ambiguity gate and approval rules still apply).
- No clarification is stored when no AI provider is configured (nothing was interpreted).
- Staleness only watches candidate cats, not other records.
- The UI is exercised by build only, not browser-tested. There is no cap on open questions per owner.
- `D1` migration `0006` has not been applied remotely (`npm run db:migrate`).
