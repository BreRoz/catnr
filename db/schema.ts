// Typed description of the database. The checked-in migrations in ./drizzle are the single source of
// truth for the schema: they alone create and change tables (the app never runs DDL), and they also
// carry what these definitions cannot express - foreign keys (composite, owner-scoped), CHECK
// constraints, triggers and views. tests/schema.test.mjs fails if the columns below drift from the
// migrated database. Do not run drizzle-kit generate; write the next migration by hand.
import { sql } from "drizzle-orm";
import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const owners = sqliteTable("owners", {
  id: text("id").notNull().primaryKey(),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(nowIso),
});

export const currencies = sqliteTable("currencies", {
  code: text("code").notNull().primaryKey(),
  minorUnit: integer("minor_unit").notNull(),
  name: text("name").notNull(),
});

export const colonies = sqliteTable("colonies", {
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  generalLocation: text("general_location"),
  notes: text("notes"),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
  version: integer("version").notNull().default(0),
  latitude: real("latitude"),
  longitude: real("longitude"),
  archivedAt: text("archived_at"),
  archiveReason: text("archive_reason"),
});

export const people = sqliteTable("people", {
  version: integer("version").notNull().default(0),
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  type: text("type"),
  generalLocation: text("general_location"),
  contact: text("contact"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
  notes: text("notes"),
  archivedAt: text("archived_at"),
  archiveReason: text("archive_reason"),
});

export const aiInputs = sqliteTable("ai_inputs", {
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  transcription: text("transcription").notNull(),
  inputType: text("input_type").notNull(),
  interpretation: text("interpretation"),
  confidence: real("confidence"),
  clarification: text("clarification"),
  correction: text("correction"),
  recordsCreated: text("records_created"),
  recordsUpdated: text("records_updated"),
  createdAt: text("created_at").notNull().default(nowIso),
});

export const cats = sqliteTable("cats", {
  version: integer("version").notNull().default(0),
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  name: text("name"),
  sex: text("sex"),
  ageClass: text("age_class"),
  appearance: text("appearance"),
  distinguishingCharacteristics: text("distinguishing_characteristics"),
  healthObservations: text("health_observations"),
  reproductiveSignificance: text("reproductive_significance"),
  originColonyId: text("origin_colony_id"),
  currentStatus: text("current_status").notNull().default("observed"),
  currentLocation: text("current_location"),
  microchipNumber: text("microchip_number"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
  archivedAt: text("archived_at"),
  archiveReason: text("archive_reason"),
});

export const events = sqliteTable("events", {
  version: integer("version").notNull().default(0),
  supersededAt: text("superseded_at"),
  supersededBy: text("superseded_by"),
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  catId: text("cat_id"),
  eventType: text("event_type").notNull(),
  occurredAt: text("occurred_at").notNull(),
  location: text("location"),
  personId: text("person_id"),
  notes: text("notes"),
  sourceInputId: text("source_input_id"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
  voidedAt: text("voided_at"),
  voidReason: text("void_reason"),
});

export const photos = sqliteTable("photos", {
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  catId: text("cat_id"),
  eventId: text("event_id"),
  storageLocation: text("storage_location").notNull(),
  takenAt: text("taken_at").notNull(),
  caption: text("caption"),
  createdAt: text("created_at").notNull().default(nowIso),
  archivedAt: text("archived_at"),
});

// Money is an integer count of minor units (cents) plus an explicit currency code. Never floating point.
export const transactions = sqliteTable("transactions", {
  version: integer("version").notNull().default(0),
  supersededAt: text("superseded_at"),
  supersededBy: text("superseded_by"),
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  transactionType: text("transaction_type").notNull(),
  direction: text("direction").notNull(),
  date: text("date").notNull(),
  amountMinor: integer("amount_minor"),
  currency: text("currency").notNull().default("USD"),
  personId: text("person_id"),
  category: text("category"),
  description: text("description").notNull(),
  item: text("item"),
  quantity: real("quantity"),
  unit: text("unit"),
  estimatedValueMinor: integer("estimated_value_minor"),
  relatedCatId: text("related_cat_id"),
  relatedEventId: text("related_event_id"),
  relatedColonyId: text("related_colony_id"),
  sourceInputId: text("source_input_id"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
  voidedAt: text("voided_at"),
  voidReason: text("void_reason"),
});

export const corrections = sqliteTable("corrections", {
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  recordType: text("record_type").notNull(),
  originalId: text("original_id").notNull(),
  replacementId: text("replacement_id").notNull(),
  revertsId: text("reverts_id"),
  status: text("status").notNull().default("applied"),
  madeBy: text("made_by").notNull(),
  actorId: text("actor_id").notNull(),
  reason: text("reason"),
  sourceInputId: text("source_input_id"),
  originalSnapshot: text("original_snapshot").notNull(),
  replacementSnapshot: text("replacement_snapshot"),
  catChanges: text("cat_changes").notNull().default("[]"),
  relinked: text("relinked").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(nowIso),
  undoneAt: text("undone_at"),
  undoneBy: text("undone_by"),
});

export const proposedActions = sqliteTable("proposed_actions", {
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  inputId: text("input_id").notNull(),
  kind: text("kind").notNull(),
  plan: text("plan").notNull(),
  reasons: text("reasons").notNull(),
  correctionTarget: text("correction_target"),
  photoDigest: text("photo_digest"),
  status: text("status").notNull().default("proposed"),
  createdAt: text("created_at").notNull().default(nowIso),
  expiresAt: text("expires_at").notNull(),
  decidedAt: text("decided_at"),
  decidedBy: text("decided_by"),
});

export const proposalExecutions = sqliteTable("proposal_executions", {
  proposalId: text("proposal_id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  executedAt: text("executed_at").notNull(),
});

export const clarifications = sqliteTable("clarifications", {
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  inputId: text("input_id").notNull(),
  sessionId: text("session_id"),
  mode: text("mode").notNull(),
  originalText: text("original_text").notNull(),
  question: text("question").notNull(),
  candidates: text("candidates").notNull().default("[]"),
  proposedPlan: text("proposed_plan").notNull(),
  context: text("context"),
  photoName: text("photo_name"),
  photoData: text("photo_data"),
  attempts: integer("attempts").notNull().default(0),
  status: text("status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(nowIso),
  updatedAt: text("updated_at").notNull().default(nowIso),
  expiresAt: text("expires_at").notNull(),
  decidedAt: text("decided_at"),
});

export const clarificationAnswers = sqliteTable("clarification_answers", {
  id: text("id").notNull().primaryKey(),
  clarificationId: text("clarification_id").notNull(),
  ownerId: text("owner_id").notNull(),
  inputId: text("input_id").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  outcome: text("outcome").notNull(),
  createdAt: text("created_at").notNull().default(nowIso),
});

export const clarificationResolutions = sqliteTable("clarification_resolutions", {
  clarificationId: text("clarification_id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  resolvedAt: text("resolved_at").notNull(),
});

export const writeRequests = sqliteTable("write_requests", {
  ownerId: text("owner_id").notNull(),
  requestKey: text("request_key").notNull(),
  requestHash: text("request_hash").notNull(),
  response: text("response").notNull(),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => [primaryKey({ columns: [t.ownerId, t.requestKey] })]);

export const rescueRevisions = sqliteTable("rescue_revisions", {
  ownerId: text("owner_id").notNull().primaryKey(),
  version: integer("version").notNull().default(0),
});

export const writeGuards = sqliteTable("write_guards", {
  ownerId: text("owner_id").notNull().primaryKey(),
  expectedVersion: integer("expected_version").notNull(),
});

// Merging never deletes: the duplicate is archived and this row says where its records went.
export const merges = sqliteTable("merges", {
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  recordType: text("record_type").notNull(),
  survivorId: text("survivor_id").notNull(),
  mergedId: text("merged_id").notNull(),
  actorId: text("actor_id").notNull(),
  summary: text("summary").notNull().default("{}"),
  conflicts: text("conflicts").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(nowIso),
});

// Immutable before/after history of every manual change.
export const recordChanges = sqliteTable("record_changes", {
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  recordType: text("record_type").notNull(),
  recordId: text("record_id").notNull(),
  action: text("action").notNull(),
  madeBy: text("made_by").notNull().default("user"),
  actorId: text("actor_id").notNull(),
  reason: text("reason"),
  beforeSnapshot: text("before_snapshot"),
  afterSnapshot: text("after_snapshot"),
  mergeId: text("merge_id"),
  createdAt: text("created_at").notNull().default(nowIso),
});

// "These are different records": remembered so a pair is not suggested as a duplicate again.
export const duplicateDismissals = sqliteTable("duplicate_dismissals", {
  ownerId: text("owner_id").notNull(),
  recordType: text("record_type").notNull(),
  firstId: text("first_id").notNull(),
  secondId: text("second_id").notNull(),
  actorId: text("actor_id").notNull(),
  createdAt: text("created_at").notNull().default(nowIso),
}, (t) => [primaryKey({ columns: [t.ownerId, t.recordType, t.firstId, t.secondId] })]);

// Download log: when personal data left the app, in which form. Counts only, never content.
export const dataExports = sqliteTable("data_exports", {
  id: text("id").notNull().primaryKey(),
  ownerId: text("owner_id").notNull(),
  profile: text("profile").notNull(),
  format: text("format").notNull(),
  counts: text("counts").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(nowIso),
});

// A pending, cancellable request to delete the whole account.
export const deletionRequests = sqliteTable("deletion_requests", {
  ownerId: text("owner_id").notNull().primaryKey(),
  requestedAt: text("requested_at").notNull(),
  executeAfter: text("execute_after").notNull(),
});

// Exists only inside the one atomic batch that deletes an account; lets that batch pass the history guards.
export const deletionInProgress = sqliteTable("deletion_in_progress", {
  ownerId: text("owner_id").notNull().primaryKey(),
});

// Proof an account was deleted. No owner id, name or email: dates and row counts only.
export const deletionReceipts = sqliteTable("deletion_receipts", {
  id: text("id").notNull().primaryKey(),
  completedAt: text("completed_at").notNull(),
  counts: text("counts").notNull().default("{}"),
});

// Operational log and emergency switches (Stage 11). Not owner-scoped on purpose: no rescue content.
export const opsEvents = sqliteTable("ops_events", {
  id: text("id").notNull().primaryKey(),
  at: text("at").notNull().default(nowIso),
  kind: text("kind").notNull(),
  ownerHash: text("owner_hash"),
  route: text("route"),
  status: integer("status"),
  durationMs: integer("duration_ms"),
  detail: text("detail"),
});

export const opsFlags = sqliteTable("ops_flags", {
  name: text("name").notNull().primaryKey(),
  enabled: integer("enabled").notNull(),
  reason: text("reason"),
  updatedAt: text("updated_at").notNull().default(nowIso),
});
