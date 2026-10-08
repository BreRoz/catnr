import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

// The pieces of the assistant API that can be tested without a database: configuration, the identity rule, the
// shape of the AI request, the built-in fallback, and the shared vocabulary.
const { aiConfig, aiConfigured, OPENROUTER_URL } = await loadTs('app/config.ts');
const { ownerFrom } = await loadTs('app/identity.ts');
const { fallbackPlan } = await loadTs('app/api/assistant/fallback.ts');
const { planSchema } = await loadTs('app/api/assistant/plan-schema.ts');
const { buildInstructions } = await loadTs('app/api/assistant/agent.ts');
const { CAT_STATUSES } = await loadTs('app/vocabulary.ts');
const { CAT_STATUS_SET, display, isCatStatus } = await loadTs('app/api/assistant/cats.ts');
const validation = await loadTs('app/api/assistant/validation.ts');
const constants = await loadTs('app/manage/constants.ts');

const asked = (email, id) => new Request('https://x.test', { headers: { ...(id ? { 'x-catnr-user-id': id } : {}), ...(email ? { 'x-catnr-user-email': email } : {}) } });

test('configuration: defaults, overrides and "is a provider configured"', () => {
  const none = aiConfig({});
  assert.equal(none.openRouterModel, 'openai/gpt-5-mini');
  assert.equal(none.openAIModel, 'gpt-5-mini');
  assert.equal(aiConfigured(none), false);
  const set = aiConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm', ENVIRONMENT: 'staging', AI_DISABLED: 'true' });
  assert.equal(set.openRouterModel, 'm');
  assert.equal(set.environment, 'staging');
  assert.equal(set.disabled, 'true');
  assert.equal(aiConfigured(set), true);
  assert.equal(aiConfigured(aiConfig({ OPENAI_API_KEY: 'k' })), true);
  assert.match(OPENROUTER_URL, /^https:\/\/openrouter\.ai\//);
});

test('identity: only a verified Access identity counts; reserved ids never do', () => {
  assert.equal(ownerFrom(asked('a@x.test', 'user-1')), 'user-1');
  assert.equal(ownerFrom(asked('a@x.test', null)), null);
  assert.equal(ownerFrom(asked(null, 'user-1')), null);
  assert.equal(ownerFrom(asked('a@x.test', '   ')), null);
  assert.equal(ownerFrom(asked('a@x.test', 'local-owner')), null);
  assert.equal(ownerFrom(asked('a@x.test', 'legacy:quarantine')), null);
});

test('the AI request schema is strict: every field required, nothing extra, enums match the validator', () => {
  const walk = (node, path) => {
    if (node && typeof node === 'object' && node.type === 'object') {
      assert.equal(node.additionalProperties, false, path);
      assert.deepEqual(node.required, Object.keys(node.properties), `${path}: required lists exactly the properties`);
      for (const [key, child] of Object.entries(node.properties)) walk(child, `${path}.${key}`);
    }
    if (node?.type === 'array') walk(node.items, `${path}[]`);
  };
  walk(planSchema, 'plan');
  assert.deepEqual(planSchema.properties.query.properties.kind.enum, [...validation.QUERY_KINDS]);
  assert.deepEqual(planSchema.properties.transactions.items.properties.transactionType.enum, [...validation.TRANSACTION_TYPES]);
});

test('the instructions carry the safety rules and every allowed vocabulary', () => {
  const text = buildInstructions();
  assert.match(text, /Never infer surgery status/);
  assert.match(text, /intent=clarify/);
  assert.match(text, new RegExp(`Today is ${new Date().toISOString().slice(0, 10)}`));
  for (const status of CAT_STATUSES) assert.ok(text.includes(status), status);
  for (const type of validation.EVENT_TYPES) assert.ok(text.includes(type), type);
});

test('one list of cat statuses is shared by the screens, manual records and the AI', () => {
  assert.deepEqual([...constants.CAT_STATUSES], [...CAT_STATUSES]);
  assert.deepEqual([...CAT_STATUS_SET].sort(), [...CAT_STATUSES].sort());
  assert.equal(isCatStatus('foster'), true);
  assert.equal(isCatStatus('made up'), false);
  assert.equal(isCatStatus(null), false);
});

test('display name prefers the name, then describes the cat', () => {
  assert.equal(display({ name: 'Pepper' }), 'Pepper');
  assert.equal(display({ name: null, appearance: 'gray', sex: 'female', age_class: 'kitten' }), 'gray female kitten');
  assert.equal(display({}), 'Unnamed cat');
});

const snapshot = (cats) => ({ cats, people: [], recentEvents: [] });
const milo = { id: 'c1', name: 'Milo', sex: null, age_class: null, appearance: null, distinguishing_characteristics: null, current_status: 'observed', origin: null, origin_colony_id: null };

test('fallback: a short update about one named cat becomes events, never a guess about surgery', () => {
  const plan = fallbackPlan('Milo got his rabies shot at the vet', 'text', snapshot([milo]));
  assert.equal(plan.intent, 'record');
  assert.deepEqual(plan.events.map((e) => e.eventType), ['vaccination: rabies', 'vet_visit']);
  assert.equal(plan.events[0].catRef, 'c1');
  assert.equal(plan.cats[0].existingId, 'c1');
  assert.equal(plan.cats[0].currentStatus, null);
  assert.equal(fallbackPlan('Milo was adopted', 'text', snapshot([milo])).cats[0].currentStatus, 'adopted');
});

test('fallback: two possible cats are a question, and no cat is a request for the interpreter', () => {
  const two = fallbackPlan('the gray one was sick', 'text', snapshot([{ ...milo, id: 'a', name: null, appearance: 'gray' }, { ...milo, id: 'b', name: null, appearance: 'gray' }]));
  assert.equal(two.intent, 'clarify');
  assert.match(two.clarification, /2 possible cats/);
  assert.deepEqual([two.cats, two.events], [[], []]);
  const none = fallbackPlan('something happened', 'text', snapshot([]));
  assert.equal(none.intent, 'clarify');
  assert.match(none.clarification, /AI interpreter/);
});

test('fallback: simple questions map to read-only queries', () => {
  const ask = (text) => fallbackPlan(text, 'ask', snapshot([])).query;
  assert.equal(ask('Which cats are waiting for adoption?').kind, 'cats_by_status');
  assert.equal(ask('Which cats are waiting for adoption?').status, 'available for adoption');
  assert.deepEqual([ask('income and expenses for 2025').kind, ask('income and expenses for 2025').year], ['income_expenses', 2025]);
  assert.equal(ask('how many cats did we help').kind, 'impact');
  assert.equal(ask('which cats need surgery').kind, 'cats_needing_surgery');
  assert.equal(fallbackPlan('which cats need surgery', 'ask', snapshot([])).intent, 'query');
});
