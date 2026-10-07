// Vocabularies for manual entry. The AI path validates against the same lists (validation.ts), so a
// record created by hand and one created by voice look identical.
export { AGE_CLASSES, EVENT_TYPES, PERSON_TYPES, SEXES, TRANSACTION_TYPES } from "../api/assistant/validation";
export { CURRENCIES } from "../money";

export const CAT_STATUSES = ["observed", "captured", "awaiting vet", "recovering", "foster", "available for adoption", "adoption pending", "adopted", "returned to colony", "lost", "deceased"] as const;
export const COLONY_STATUSES = ["active", "inactive"] as const;


export { INFLOW_TYPES, OUTFLOW_TYPES } from "../api/assistant/validation";
