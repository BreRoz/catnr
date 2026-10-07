# Stage 8 — Consistent reports

Every number the app reports now comes from one module, `app/reports/` (`definitions.ts` = what each metric means, `queries.ts` = the SQL), used by the Reports screen (`GET /api/manage/reports`), the home-page totals and the assistant's answers. Nothing is cached or kept in a counter, so any figure can be reproduced from the database. **No migration was needed.**

## Rules that apply to every metric

- Only **active** records count: not voided, not replaced by a correction. Scoped to the signed-in rescue.
- Event types are compared after trimming, lower-casing, `" "`→`"_"` and dropping a `:detail` suffix (`"Neuter: mild swelling"` is a neuter).
- Period metrics use the event/transaction **day**, inclusive at both ends (`?year=2026`, or `?from=&to=`; neither = all time). "Right now" metrics ignore the period.
- **Nothing is inferred.** A spay does not imply a vaccination, a status of "adopted" does not imply an adoption event, and a missing surgery event does not mean surgery is needed.

## Definitions

| Metric | Counts | Does not count |
|---|---|---|
| Cats assisted | distinct cats with an event of type captured, intake, transport, vet_visit, spay, neuter, vaccination, testing, medication, foster, adoption, returned_to_colony | sightings, observations, illness/injury notes, adoption interest/application/meet-and-greet, lost, deceased |
| Cats captured | distinct cats with a `captured` event | intake |
| Cats sterilized | distinct cats with a spay or neuter event | previously sterilized cats; unknown history |
| Cats vaccinated | distinct cats with a vaccination event | anything implied by another event |
| Cats adopted | distinct cats with an `adoption` event | a status typed in without the event |
| Cats returned to colony | distinct cats with a `returned_to_colony` event | |
| Currently in foster / available for adoption | non-archived cats whose **current status** is `foster` / `available for adoption`, now | past fostering |
| Colonies served | distinct origin colonies of the cats assisted | cats with no colony |
| Veterinary procedures | spay, neuter, vaccination, testing, medication events (one each); vet visits are reported separately | |
| Cash received / spent | transactions with an amount, per currency (donations, fundraisers, merchandise, other in; expenses, supplies, other out) | in-kind donations |
| In-kind resources | in-kind donation count, quantities by item/unit, estimated value per currency | never added to income |

Money is integer minor units with an explicit currency; USD and CAD are reported side by side and never added. Net = cash in − cash out per currency.

### Surgery status ("unknown" ≠ "needs surgery")

Each cat in care (not archived; not adopted / returned / lost / deceased) is in exactly one group:

- **sterilized** — a `spay`, `neuter` or `previously_sterilized` event exists;
- **needs surgery** — no sterilization evidence **and** an explicit `surgery_needed` event exists (a confirmed finding);
- **unknown** — everything else, including "nothing on file".

Two event types were added so these facts can be recorded: `surgery_needed` and `previously_sterilized` (e.g. an ear-tipped cat found already fixed). The assistant is told never to guess either. The assistant's "which cats need surgery" answer now lists only confirmed needs and separately says how many are unknown.

## What changed

- New: `app/reports/definitions.ts`, `app/reports/queries.ts`, `app/manage/reports.ts`, `app/api/manage/reports/route.ts`, `app/records/reports-panel.tsx` (a **Reports** tab under Records with the definitions beside the numbers).
- Assistant (`route.ts`): `impact`, `income_expenses` and `cats_needing_surgery` answers and the home-page totals use the shared report. The `transactions` answer no longer adds cash and in-kind estimates together.
- Behaviour changes to be aware of: "Found homes" and "Spayed/neutered" on the home page now mean *adoption events* and *spay/neuter events* (previously a status of adopted, and a `LIKE '%spay%'` match); cats whose only event is a sighting no longer count as "assisted".
- Tests: `tests/reports.test.mjs` (14, hand-computed fixture: unknown/confirmed surgery, confirmed need, missing data, cash donations, merchandise income, in-kind, expenses, USD+CAD, voided/superseded entries, period edges, owner isolation, read-only) and an end-to-end assistant-answer test in `tests/validation.test.mjs`.

## Limits

- Cats whose current status was set by hand (not by events) are counted by status for foster/available but not for adopted/returned.
- Events on archived cats still count in historical metrics; archived cats are left out of "right now" metrics.
- A cat whose surgery was recorded only in free-text notes or `reproductive_significance` is "unknown" until an event is recorded.
- Existing data: past "needs surgery" answers were inferred; those cats now show as unknown until a `surgery_needed` event is recorded.
- The Reports tab was not exercised in a browser (needs Cloudflare Access sign-in); it is covered by type/lint/build checks and by tests of the API it reads.
