// Shapes shared by the assistant modules. The AI "plan" types describe what the interpreter may ask for;
// everything in a plan is untrusted until validation.ts has checked it.

export type D1 = D1Database;

export type CatRow = {
  id: string;
  name: string | null;
  sex: string | null;
  age_class: string | null;
  appearance: string | null;
  distinguishing_characteristics: string | null;
  current_status: string | null;
  origin: string | null;
  origin_colony_id: string | null;
  [column: string]: string | number | null | undefined;
};
export type ProposalRow = {
  id: string;
  input_id: string;
  kind: string;
  plan: string;
  correction_target: string | null;
  photo_digest: string | null;
  status: string;
  expires_at: string;
};
export type EventOrTxnRow = {
  date?: string;
  occurred_at?: string;
  superseded_at: string | null;
  version: number;
  [column: string]: string | number | null | undefined;
};
export type TxnRow = {
  transaction_type: string;
  direction: string;
  currency: string;
  amount_minor: number | null;
  estimated_value_minor: number | null;
};
export type Snapshot = { cats: CatRow[]; people: Record<string, unknown>[]; recentEvents: Record<string, unknown>[] };

// Untrusted JSON from the client: every field is optional and checked before use.
export type RequestBody = {
  input: string;
  mode?: string;
  sessionId?: string;
  requestKey?: string;
  photoDataUrl?: string;
  photoName?: string;
  confirmProposalId?: string;
  rejectProposalId?: string;
  clarificationId?: string;
  cancelClarificationId?: string;
  correction?: string;
  correctionId?: string;
  id?: string;
  recordType?: "event" | "transaction";
  version: number;
};
export type Correction = { recordType: "event" | "transaction"; id: string; version: number; reason: string };

export type CatDraft = {
  ref: string;
  existingId: string | null;
  name: string | null;
  sex: string | null;
  ageClass: string | null;
  appearance: string | null;
  distinguishingCharacteristics: string | null;
  healthObservations: string | null;
  reproductiveSignificance: string | null;
  origin: string | null;
  currentStatus: string | null;
  currentLocation: string | null;
  microchipNumber: string | null;
};
export type EventDraft = {
  catRef: string | null;
  eventType: string;
  occurredAt: string | null;
  location: string | null;
  personName: string | null;
  notes: string | null;
};
export type PersonDraft = {
  ref: string;
  existingId: string | null;
  name: string;
  type: string | null;
  generalLocation: string | null;
  contact: string | null;
};
export type TransactionDraft = {
  transactionType: string;
  direction: "inflow" | "outflow";
  date: string | null;
  amount: number | null;
  currency: string | null;
  personName: string | null;
  category: string | null;
  description: string;
  item: string | null;
  quantity: number | null;
  unit: string | null;
  estimatedValue: number | null;
  relatedCatRef: string | null;
};
export type QueryKind =
  | "none"
  | "cats_by_status"
  | "cat_history"
  | "impact"
  | "income_expenses"
  | "transactions"
  | "cats_by_colony"
  | "cats_needing_surgery";
export type QueryDraft = { kind: QueryKind; catId: string | null; status: string | null; year: number | null; search: string | null };
export type AgentPlan = {
  intent: "record" | "query" | "clarify" | "social";
  message: string;
  clarification: string | null;
  confidence: number;
  cats: CatDraft[];
  events: EventDraft[];
  people: PersonDraft[];
  transactions: TransactionDraft[];
  query: QueryDraft;
  socialDraft: string | null;
};
