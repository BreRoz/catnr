import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/assistant/route.ts", import.meta.url), "utf8") + await readFile(new URL("../app/api/assistant/reliability.ts", import.meta.url), "utf8") + await readFile(new URL("../app/api/assistant/validation.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/rescue-client.tsx", import.meta.url), "utf8");
const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");

test("uses structured AI extraction instead of scripted demo sentences", () => {
  assert.match(route, /openrouter\.ai\/api\/v1\/chat\/completions/);
  assert.match(route, /OPENROUTER_API_KEY/);
  assert.match(route, /json_schema/);
  assert.match(route, /rescue_action_plan/);
  assert.doesNotMatch(route, /female gray kitten/);
  assert.doesNotMatch(route, /pepper\.\*adopt/i);
});

test("requires ambiguity handling and validates identifiers before writes", () => {
  assert.match(route, /intent:"record"\|"query"\|"clarify"/);
  assert.match(route, /Nothing was silently changed/);
  assert.match(route, /SELECT id FROM \$\{table\} WHERE id=\? AND owner_id=\?/);
});

test("supports the MVP record types and audit links", () => {
  for (const table of ["cats", "colonies", "events", "photos", "people", "transactions", "ai_inputs"]) {
    assert.match(schema, new RegExp(`sqliteTable\\(\"${table}\"`));
  }
  assert.match(schema, /recordsCreated:text\("records_created"\)/);
  assert.match(schema, /ownerId:text\("owner_id"\)/);
  assert.match(route, /source_input_id/);
});

test("renders database-backed cat history and operational metrics", () => {
  assert.match(page, /CAT HISTORY/);
  assert.match(page, /Vaccinated/);
  assert.match(page, /Cash received/);
  assert.match(page, /Operational records only/);
});

test("supports photo thumbnails, readable activity dates, and AI corrections", () => {
  assert.match(route, /photoId/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /Complete corrected version from Ari/);
  assert.match(page, /formatActivityDate/);
  assert.match(page, /Save correction/);
  assert.match(page, /SPEAK AN UPDATE/);
  assert.match(route, /created_at createdAt/);
  assert.match(page, /Records added/);
});
