# Stage 4 — Validate AI decisions before applying them

Provider/LLM output is untrusted input. Nothing it returns reaches the database unless it passes local validation.

## Pipeline
1. **Question** — read-only. `ask` mode, `query`, `social` and `clarify` plans may not contain any cats/events/people/transactions; a plan that does is rejected (422), not trimmed.
2. **Validated plan** (`app/api/assistant/validation.ts`) — `parseProviderJson` + `validateProviderPlan`: exact field sets (unknown fields such as `delete`, `merge`, `owner_id` are rejected), enums (intent, event type, transaction type, direction, sex, age class, status, currency, query kind), real calendar dates (not before 1990, not >1 day ahead), amounts (finite, positive, ≤ 2 decimals, ≤ 1,000,000, direction must agree with type), ID format, length/control-character limits, and `checkReferences` (every cat/person/query cat must belong to the signed-in owner). Any failure rejects the **whole** plan; nothing is partially applied.
3. **Ambiguity gate** (`ambiguity`) — medical/death/adoption/lost events with no cat, a new cat sharing an existing cat's name, low-confidence matches, or very low confidence turn into a clarification question. No records change.
4. **Proposed action** (`consequences`) — marking deceased/adopted/lost, recording an adoption, renaming an existing cat, financial corrections and amounts ≥ $1,000 are stored in `proposed_actions` (inert, 24h expiry, plan immutable by trigger) and returned as `needs_confirmation`.
5. **Approved action** — `POST {confirmProposalId}` (or `DELETE {rejectProposalId}` to dismiss). The stored plan is re-validated against current data; the interpreter is **not** called again. A correction proposal also re-checks the record version. A photo must be re-attached and match the stored digest.
6. **Executed action** — one atomic D1 batch (same receipt/revision guard as Stage 2). `proposal_executions` (primary key) makes a second approval fail the whole batch.

## Not expressible by design
Deleting records, merging cats and changing ownership are not operations in the plan schema, so a provider cannot request them; attempts are rejected as unknown fields and the prompt tells the model to ask instead.

## Limitations
- Rejected provider output is not stored in `ai_inputs` (nothing is written for a rejected plan); only the HTTP response says it was rejected.
- Confirmation is per plan, not per field: Ari approves or dismisses the whole change.
- Ambiguity detection is rule-based (names/confidence/missing cat). The stored-record snapshot given to the model is capped at 150 cats.
- The $1,000 threshold and the consequential list are constants in `validation.ts`.
- `npm run lint` already failed before this stage (`no-explicit-any`, a11y in the client); the new files are lint-clean.
