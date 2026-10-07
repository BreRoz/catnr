# Cat Tracker product readiness audit

Audited October 6, 2026. Scope: application source, database schema and migrations, worker, hosting configuration, dependency manifest, documentation, and existing tests. No production database or secrets were inspected; production access policies, deployed migrations, provider availability, backup configuration, and live browser behavior remain unverified. This is a code audit, not a penetration test or legal review.

## Readiness assessment

This is a working early prototype with real persistence and AI integration. It is not yet ready for a public multi-user launch. The central blockers are authentication enforcement, reliable and reversible mutations, complete record-management workflows, and operational verification. Keep the current stack initially; a rewrite is not required to address these gaps.

Existing capabilities:
- Mobile-oriented interface with home, cat list, activity, and lifetime dashboard.
- Text entry and browser speech recognition with a typed fallback.
- Structured AI extraction through OpenRouter or direct OpenAI, with a limited keyword fallback.
- Persistent cats, colonies, people, events, financial/resource transactions, original inputs, and photo metadata in D1.
- R2 photo upload and owner-filtered retrieval, cat timelines, and AI-based activity corrections.
- Owner filtering in many queries, parameterized SQL, source-input links, migrations, and hosting binding declarations.

Verification:
- `npm test`: production build succeeds; all five tests pass.
- Those tests match source strings; they do not execute API/database/browser workflows.
- `npm run lint`: fails with 64 errors and six warnings.
- `npx tsc --noEmit`: fails with six errors, including missing Cloudflare worker types and an implicit-any callback.

## P0 — before real users depend on their records

### 1. Enforce account isolation and authentication
Evidence: `app/api/assistant/route.ts:29–30`; all three handlers call these helpers. Missing identity becomes the shared `local-owner`. `claimLegacy` assigns every ownerless row to the current requester. The sign-in helpers exist in `app/chatgpt-auth.ts` but are unused by the application.

Required work:
- Require authenticated identity for every private read, photo read, and mutation; reject anonymous requests.
- Permit a development identity only behind an explicit local-development setting.
- Verify production identity headers are injected by trusted infrastructure and cannot be supplied directly by visitors.
- Remove automatic ownership claiming from request handlers. Run a controlled one-time migration assigning legacy records to a known account.
- Decide whether ownership belongs to an individual or rescue organization; add memberships/roles before shared access.
- Audit every relationship and join for tenant ownership, including transaction cat references, which currently lack the cat ownership check used for events.
- Add sign-in, sign-out, real profile display, and session-expiry handling. The avatar currently has no action and the greeting is hardcoded to Ari.

Acceptance: anonymous requests cannot read/write records; user A cannot read, link, modify, or retrieve user B's data/photos; legacy assignment cannot happen through normal traffic.

### 2. Make writes atomic, retry-safe, and concurrency-safe
Evidence: `execute` at route lines 57–59 performs sequential writes; POST and PATCH add more operations afterward. A later error leaves earlier operations committed. POST's failure message says nothing changed, but that is not guaranteed. PATCH can similarly leave linked records changed after a failure.

Required work:
- Validate the entire proposed change before any domain write.
- Commit related database statements atomically using the database's supported transactional batch mechanism.
- Coordinate R2 and database writes with explicit pending/completed states and cleanup; they cannot share a database transaction.
- Add idempotency keys so retries/double submissions do not duplicate cats, events, expenses, or photos.
- Add record versions or equivalent conflict detection for simultaneous edits.
- Return a structured operation status with an operation ID; distinguish pending, rejected, committed, and failed changes accurately.

Acceptance: simulated failure at any step cannot leave unexplained partial records; repeating the same request produces one logical update.

### 3. Replace destructive correction behavior
Evidence: PATCH at route line 66 executes a new AI plan and then deletes the selected event/transaction. It does not require a valid replacement of the same record type; non-record plans can reach deletion. It does not reverse previous cat-field changes or other records created by the original input. Photo references may be left dangling under runtime-created tables or block deletion under migration-created foreign keys.

Required work:
- Build explicit edits for cat fields, events, and transactions, with AI optionally preparing the draft.
- Require correction intent, target, expected record version, and valid replacement fields before applying.
- Preserve versions/before-and-after values; support undo or restore.
- Keep attachments and relationships intact when correcting an event.
- Recompute derived cat state when history is changed, or make state/history consistency explicit.
- Show the proposed changes before consequential medical, disposition, or financial updates.

Acceptance: correcting an adoption or spay event produces consistent history, current status, metrics, and attachments; a query/social/clarification result cannot delete an activity.

### 4. Treat AI output as untrusted input
Evidence: `callAgent` parses provider JSON and returns it as `AgentPlan`; execution relies on these compile-time types. Status checks and amount checks cover only part of the plan. Provider schema requests do not replace local validation.

Required work:
- Add runtime request and plan validation: intent, mode, recordType, enums, lengths, references, date formats, currency, finite amounts/quantities, and array counts.
- Enforce that ask/query/social modes cannot mutate records regardless of what the model returns.
- Require known-owner references for every existing entity and reject unknown temporary references.
- Restrict sensitive changes when identification is ambiguous; never rely solely on a prompt or model-reported confidence.
- Make missing-provider mode explicit and disable automatic sensitive changes in the keyword fallback. Currently an `adopt` substring can mark a matched cat adopted.
- Add an AI evaluation set covering negation, similar cats, relative dates, multiple entities, prompt injection, and corrections.

Acceptance: malformed or contradictory plans have zero domain writes; “not adopted” cannot become an adoption through fallback parsing.

### 5. Complete clarification and draft handling
Evidence: each submission is interpreted independently; the UI displays a clarification but has no pending-plan ID or linked follow-up. Opening an input resets its contents.

Required work:
- Persist a pending draft and return its ID, candidates, and specific missing fields.
- Let users select the correct cat and supply missing information without losing the original statement/photo.
- Carry prior context into the follow-up, then commit the resolved draft once.
- Preserve unsaved text and attachments across modal dismissal, errors, and reloads.
- Expose saved-but-unprocessed inputs with retry/review controls.

Acceptance: a user can resolve “which cat?” and record the complete original update exactly once.

### 6. Establish one authoritative database schema
Evidence: `ensureSchema` at route lines 15–28 runs DDL and PRAGMA scans on every GET/POST/PATCH. Its CREATE statements omit foreign keys declared by Drizzle migrations; the direction check also differs. Databases initialized by different paths can have different integrity constraints.

Required work:
- Apply versioned migrations during provisioning/deployment, not user requests.
- Reconcile existing database shape with checked-in schema and migrations.
- Make tenant ownership mandatory for owned records, with explicit referential integrity and deletion behavior.
- Add validated status/event categories and appropriate relationship indexes.
- Replace floating-point money with integer minor units or an exact representation; preserve currency in calculations.
- Normalize optional bindings to null; `person()` currently passes optional properties that may be undefined to D1 bindings.
- Specify event dates, timestamps, user timezone, and imported-record provenance.

Acceptance: a fresh install and an upgraded existing database have identical schema and constraints; invalid links and amounts are rejected.

### 7. Bound resource usage and protect the API
Evidence: provider requests have no explicit timeout; body/photo size limits and rate limits are absent from app code. JSON parsing and schema setup occur outside handler error boundaries.

Required work:
- Set body/image/text limits before expensive processing and validate decoded image type, dimensions, and bytes on the server.
- Add per-user request limits, AI usage quotas, execution timeouts, and cost accounting.
- Handle invalid JSON, unavailable D1/R2, provider throttling, refusals, and malformed provider output consistently.
- Review same-origin/CSRF protection for authenticated mutations and private response caching.
- Minimize the records/contact information sent to AI providers; establish retention and provider disclosure.

Acceptance: oversized, unauthenticated, malformed, and over-quota requests fail predictably without expensive work or data changes.

## P1 — make the core product complete

### 8. Manual record management
- Create/edit/archive cats without AI, including unnamed cats and stable IDs.
- Add structured medical/status events and manual transactions.
- Manage colonies and people directly; expose contact and location fields appropriately.
- Merge duplicates with history and attachment preservation.
- Provide clear field removal: current COALESCE updates cannot clear existing values.
- Show all meaningful cat fields, not only status/location and a timeline.
- Add confirmation/undo for deletion or archival, including retention choices.

### 9. Find and navigate records at realistic scale
- Add cat/activity search, colony/status/date filters, sorting, and pagination.
- Remove silent list limits: UI displays only 50 entries; activity API returns 50; AI context includes only 150 cats, 100 people, and 120 events.
- Retrieve relevant candidate records server-side instead of treating a truncated snapshot as the entire database.
- Deep-link cats and views so refresh/back/share navigation works; tabs currently live only in React state.
- Add clear empty, loading, unavailable, and permission states. `refresh` currently swallows failures, making outages look like no records.

### 10. Finish photo workflows
- Select or confirm the target cat/event; current upload attaches to the first created/updated cat or may remain unlinked.
- Support a gallery, captions, deletion, reassignment, and upload recovery.
- Include photo IDs in operation audit/results. `photoSaved` is returned but not used by the UI; photo-only success may appear as no change.
- Keep photos pending during clarification rather than losing upload context.
- Add server-side normalization, thumbnail generation, privacy/metadata handling, and orphan cleanup.

### 11. Make dashboards and finance trustworthy
- Define whether “found homes” means currently adopted cats or historical adoptions; existing lifetime/dashboard and yearly-query methods differ.
- Standardize event enums rather than relying on substring matching for surgery/vaccination counts.
- Distinguish unknown surgery status from verified need for surgery.
- Separate cash, expenses, donations, and in-kind valuation; do not sum different currencies as dollars.
- Preserve cents in the dashboard; current display rounds to whole dollars.
- Add transaction list/detail/edit, date filters, category summaries, and export.
- Link answers to supporting records and dates. Combined transaction totals currently mix directions and estimated values.

### 12. Support field use and accessible interaction
- Test phone camera, microphone permissions, unsupported browsers, slow networks, and interrupted submissions on real devices.
- Allow voice transcript editing before save and stop/clean up recognition when views close or unmount.
- Decide whether offline capture is a launch requirement; if so add a local pending queue and conflict-safe sync.
- Convert clickable article rows into keyboard-operable controls.
- Add labeled inputs, dialog semantics, focus trapping/restoration, Escape dismissal, status announcements, and reduced-motion behavior.
- Test at phone, tablet, desktop, zoomed text, and screen-reader sizes. Current shell is capped at 480px even on desktop.

### 13. Data portability and account control
- Import CSV/spreadsheets with mapping, preview, duplicate detection, and rollback.
- Export complete cats, history, transactions, and photo references/files.
- Offer account deletion and documented retention, including original AI inputs and R2 files.
- Provide organization transfer and role controls if teams are supported.

## P1 — make deployment and operation repeatable

### 14. Verify production configuration
- Confirm the Sites access policy, D1/R2 bindings, migrations, provider secrets, model settings, and trusted identity injection in the actual deployment.
- Separate development, staging, and production data/secrets.
- Add a repeatable release checklist and rollback procedure, including backward-compatible migrations.
- Verify hostname, metadata, brand assets, HTTPS, and a custom domain if desired. Current metadata/provider referer are tied to a specific personal site.
- Record the intended deployment runtime and dependency upgrade policy; package.json currently uses vinext 1.0.0-beta.2.

### 15. Add operational visibility and recovery
- Structured server logs with request/operation IDs and redaction.
- Track failed writes, pending inputs, AI latency/errors/cost, D1 errors, R2 failures, and orphaned uploads.
- Add health checks, uptime/error alerts, and an operator dashboard for failed work.
- Configure database and photo backups, retention, and a tested restore procedure; define acceptable data loss/recovery time.
- Document incident response, support contact, and recovery from a provider outage.
- Do not expose other users' private records through support tooling.

### 16. Replace placeholder verification and documentation
- Fix current lint and TypeScript errors; generate/include worker binding types.
- Add behavioral tests for tenant isolation, cross-owner references, atomic failure, retries, corrections, photo linking, and migrations.
- Add browser tests for sign-in, text capture, clarification, manual editing, and error recovery.
- Test providers with mocks/fixtures plus a small staging integration check; test migrations against real D1-compatible local databases.
- Run build, lint, typecheck, and behavioral tests in CI before release.
- Replace starter README with product setup, environment settings, architecture, schema/migration instructions, test commands, deployment, backups, and support procedures.
- Split compressed page/API files into readable components and services with typed contracts. Current page is 22 lines and route 66 lines containing substantial logic.
- Keep environment example documented/tracked intentionally; `.gitignore` currently ignores `.env*`.

## P2 — expand beyond a dependable single-user tool

Choose these based on pilot feedback; they are not all prerequisites for a single-user launch:
- Team organizations, invitations, owner/admin/volunteer roles, assignments, and restricted colony locations.
- Surgery/vet appointments, medication/reminder tasks, follow-up dates, and notifications.
- Foster placements, adoption applications, adopter records, and transfer workflows.
- Receipts, donor/resource management, and external accounting exports.
- Public adoptable-cat profiles with explicit publishing consent and privacy controls.
- Social content drafts backed by source records and reviewed before publishing.
- Subscription billing, plan entitlements, metered usage, cancellation, and payment webhooks only if a paid product is chosen.
- Customer onboarding, help content, feedback/support, product analytics, and accessibility review.

## Suggested delivery order and completion gates

1. **Secure foundation:** authentication, tenant checks, controlled ownership migration, schema reconciliation, and request validation. Gate: two-user isolation tests pass.
2. **Reliable recording:** atomic plans, idempotency, safe corrections, drafts/clarification, photo coordination, provider failure handling. Gate: retries and injected failures do not corrupt records.
3. **Complete daily workflow:** manual CRUD, search/pagination, galleries, consistent dashboard/finance, import/export, accessible errors and navigation. Gate: a user can record, locate, correct, and export work without relying on AI availability.
4. **Production pilot:** staging/production separation, CI, monitoring, backup/restore, privacy/account controls, onboarding, and real-device verification. Gate: restore drill and end-to-end pilot checklist pass.
5. **Commercial expansion:** choose organization/team workflows and monetization based on actual usage. Gate: scope and costs are validated before widening release.

Recommended first launch scope: authenticated individual rescuers, reliable text/manual capture, cat history/photos, basic finance, corrections, search, and export. Add team collaboration and paid plans after this core is dependable.

Before implementation, settle: individual versus organization ownership; invited versus public signup; supported sign-in method; offline needs; geographic/timezone/currency scope; and paid versus free launch. These affect design but do not prevent fixing the P0 issues now.
