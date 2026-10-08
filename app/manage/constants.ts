// Vocabularies for manual entry. The AI path validates against the same lists (validation.ts), so a
// record created by hand and one created by voice look identical.
export { AGE_CLASSES, EVENT_TYPES, PERSON_TYPES, SEXES, TRANSACTION_TYPES } from "../api/assistant/validation";
export { CURRENCIES } from "../money";

export { CAT_STATUSES } from "../vocabulary";
export const COLONY_STATUSES = ["active", "inactive"] as const;

export { INFLOW_TYPES, OUTFLOW_TYPES } from "../api/assistant/validation";
