// The single written definition of every number the app reports. The same module feeds the Reports
// screen, the home-page totals and the assistant's answers, so a figure cannot mean one thing in one
// place and something else in another. Every metric is computed from the database by queries.ts
// (nothing is cached or kept in a counter), so it can always be reproduced.

/** Event types are compared after trimming, lower-casing, turning spaces into "_" and dropping any ":detail" suffix. */
export const EVENT_ALIASES: Record<string, string> = { capture: "captured", adopted: "adoption", neutered: "neuter", spayed: "spay" };

/** Work the rescue did for a cat. Sightings, observations, illness/injury notes, interest and lost/deceased are not "assisting". */
export const ASSISTANCE_EVENTS = ["captured", "intake", "transport", "vet_visit", "spay", "neuter", "vaccination", "testing", "medication", "foster", "adoption", "returned_to_colony"] as const;
/** A veterinary procedure is one performed treatment. A vet_visit is a visit, counted separately, so a visit that also logs a spay is not counted twice. */
export const PROCEDURE_EVENTS = ["spay", "neuter", "vaccination", "testing", "medication"] as const;
/** Rescue-performed sterilization surgery. */
export const STERILIZATION_PROCEDURES = ["spay", "neuter"] as const;
/** Evidence a cat is already sterilized: surgery done by the rescue, or confirmed fixed when found (for example an ear-tipped cat). */
export const STERILIZED_EVIDENCE = ["spay", "neuter", "previously_sterilized"] as const;
/** A confirmed finding that the cat still needs surgery. */
export const SURGERY_NEEDED_EVENT = "surgery_needed";
/** Cats in these statuses are no longer waiting on the rescue, so they are left out of the surgery-status breakdown. */
export const NOT_IN_CARE_STATUSES = ["adopted", "returned to colony", "deceased", "lost"] as const;

export const CASH_TYPE_LABELS: Record<string, string> = {
  cash_donation: "Cash donations", fundraiser_income: "Fundraisers", merchandise_income: "Merchandise sales", cash_inflow: "Other money in",
  operating_expense: "Operating expenses", supply_purchase: "Supply purchases", cash_outflow: "Other money out", other: "Other",
};

export type MetricDefinition = { key: string; label: string; period: boolean; counts: string; excludes: string };

/** Shown on the Reports screen and returned by the API next to the numbers. */
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { key: "catsAssisted", label: "Cats assisted", period: true, counts: "Distinct cats with at least one active event in the period of type: captured, intake, transport, vet visit, spay, neuter, vaccination, testing, medication, foster, adoption or returned to colony.", excludes: "Sightings, observations, illness/injury notes, adoption interest/applications/meet-and-greets, lost, deceased and anything removed or replaced by a correction." },
  { key: "catsCaptured", label: "Cats captured", period: true, counts: "Distinct cats with an active “captured” event in the period.", excludes: "Intake (a cat handed in, not trapped) and cats that were only seen." },
  { key: "catsSterilized", label: "Cats sterilized", period: true, counts: "Distinct cats with an active spay or neuter event in the period (surgery the rescue arranged).", excludes: "Cats found already sterilized, and cats whose surgery history is unknown." },
  { key: "catsVaccinated", label: "Cats vaccinated", period: true, counts: "Distinct cats with an active vaccination event in the period.", excludes: "Vaccination is never inferred from a spay, neuter or vet visit." },
  { key: "catsAdopted", label: "Cats adopted", period: true, counts: "Distinct cats with an active adoption event in the period.", excludes: "A cat whose status was typed in as “adopted” without an adoption event, and adoption interest or applications." },
  { key: "catsReturned", label: "Cats returned to colony", period: true, counts: "Distinct cats with an active returned-to-colony event in the period.", excludes: "Cats merely marked as living at a colony." },
  { key: "inFoster", label: "Cats currently in foster", period: false, counts: "Cats that are not archived and whose current status is “foster”, right now.", excludes: "Cats that were fostered in the past (this is a snapshot, so the period filter does not apply)." },
  { key: "availableForAdoption", label: "Cats available for adoption", period: false, counts: "Cats that are not archived and whose current status is “available for adoption”, right now.", excludes: "Adoption pending, and cats that were available in the past." },
  { key: "coloniesServed", label: "Colonies served", period: true, counts: "Distinct origin colonies of the cats assisted in the period.", excludes: "Colonies with no assisted cat, and cats with no recorded colony." },
  { key: "veterinaryProcedures", label: "Veterinary procedures", period: true, counts: "Active spay, neuter, vaccination, testing and medication events in the period, one per event.", excludes: "Vet visits (reported as visits), illness/injury notes, and events on no cat." },
  { key: "cashIn", label: "Cash received", period: true, counts: "Money-in transactions with an amount, by currency: cash donations, fundraisers, merchandise sales and other money in.", excludes: "In-kind donations and their estimated value. Currencies are never added together." },
  { key: "cashOut", label: "Cash spent", period: true, counts: "Money-out transactions with an amount, by currency: operating expenses, supply purchases and other money out.", excludes: "Supplies that were donated rather than bought." },
  { key: "inKind", label: "In-kind resources", period: true, counts: "In-kind donations: how many were received, the quantities by item and unit, and the estimated value by currency where one was given.", excludes: "Estimated value is a guess, kept apart from cash and never included in income." },
  { key: "surgeryStatus", label: "Surgery status of cats in care", period: false, counts: "Cats in care (not archived; not adopted, returned, lost or deceased), each placed in exactly one group. Sterilized: a spay, neuter or previously-sterilized event exists. Needs surgery: no sterilization evidence and a surgery-needed event exists. Unknown: neither.", excludes: "A cat is never “needs surgery” just because no spay or neuter is on file; missing information is “unknown”." },
];

export type Period = { from: string | null; to: string | null };

/** A calendar year as an inclusive date range. */
export const yearPeriod = (year: number): Period => ({ from: `${year}-01-01`, to: `${year}-12-31` });
