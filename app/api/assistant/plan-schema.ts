import { QUERY_KINDS, TRANSACTION_TYPES } from "./validation";

// The JSON schema the AI provider must answer in (strict mode). It mirrors AgentPlan in types.ts; the answer is
// still checked field by field by validateProviderPlan, because a provider can ignore a schema.
const nullable = { type: ["string", "null"] };
const text = { type: "string" };
const nullableNumber = { type: ["number", "null"] };

/** A strict object: every listed field is required (nullable ones may be null) and nothing else is allowed. */
const strictObject = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

const catDraft = strictObject({
  ref: text,
  existingId: nullable,
  name: nullable,
  sex: nullable,
  ageClass: nullable,
  appearance: nullable,
  distinguishingCharacteristics: nullable,
  healthObservations: nullable,
  reproductiveSignificance: nullable,
  origin: nullable,
  currentStatus: nullable,
  currentLocation: nullable,
  microchipNumber: nullable,
});

const eventDraft = strictObject({
  catRef: nullable,
  eventType: text,
  occurredAt: nullable,
  location: nullable,
  personName: nullable,
  notes: nullable,
});

const personDraft = strictObject({
  ref: text,
  existingId: nullable,
  name: text,
  type: nullable,
  generalLocation: nullable,
  contact: nullable,
});

const transactionDraft = strictObject({
  transactionType: { type: "string", enum: [...TRANSACTION_TYPES] },
  direction: { type: "string", enum: ["inflow", "outflow"] },
  date: nullable,
  amount: nullableNumber,
  currency: nullable,
  personName: nullable,
  category: nullable,
  description: text,
  item: nullable,
  quantity: nullableNumber,
  unit: nullable,
  estimatedValue: nullableNumber,
  relatedCatRef: nullable,
});

const queryDraft = strictObject({
  kind: { type: "string", enum: [...QUERY_KINDS] },
  catId: nullable,
  status: nullable,
  year: { type: ["integer", "null"] },
  search: nullable,
});

export const planSchema: Record<string, unknown> = strictObject({
  intent: { type: "string", enum: ["record", "query", "clarify", "social"] },
  message: text,
  clarification: nullable,
  confidence: { type: "number" },
  cats: { type: "array", items: catDraft },
  events: { type: "array", items: eventDraft },
  people: { type: "array", items: personDraft },
  transactions: { type: "array", items: transactionDraft },
  query: queryDraft,
  socialDraft: nullable,
});
