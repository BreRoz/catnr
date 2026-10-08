// Stage 11: production operations - monitoring, usage limits, kill switches, backup/restore, deploy safety.
import { migrations } from './helpers/migrations.mjs';
import { loadRoute } from './helpers/assistant.mjs';
import { loadTs } from './helpers/load-ts.mjs';
import { makeD1 } from './helpers/records.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const log = await loadTs('app/ops/log.ts');
const limits = await loadTs('app/ops/limits.ts');
const observe = await loadTs('app/ops/observe.ts');
const status = await loadTs('app/ops/status.ts');
const retention = await loadTs('app/portability/retention.ts');
const { verifyRestore } = await import('../scripts/lib/restore.mjs');

const fresh = () => { const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); for (const sql of migrations) db.exec(sql); return { db, d1: makeD1(db) }; };
const NOW = new Date('2026-06-01T12:00:00.000Z');
const ago = (minutes) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const quiet = async (fn) => { const o = [console.log, console.error]; console.log = console.error = () => {}; try { return await fn(); } finally { [console.log, console.error] = o; } };
const addCalls = async (db, owner, kind, n, minutesAgo) => { const h = await log.fingerprint(owner); for (let i = 0; i < n; i++) db.prepare('INSERT INTO ops_events(id,at,kind,owner_hash) VALUES(?,?,?,?)').run(`e${kind}${owner}${minutesAgo}${i}${Math.random()}`, ago(minutesAgo), kind, h); };

// ---------------------------------------------------------------- logging never leaks
test('scrub removes emails, keys, tokens, images and long text', () => {
  const dirty = 'Failed for ari@rescue.org with Bearer abc.def-123 key sk-or-v1-abcdef1234567890 jwt eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig photo data:image/jpeg;base64,/9j/2QAAAA==';
  const clean = log.scrub(dirty);
  for (const secret of ['ari@rescue.org', 'abc.def-123', 'sk-or-v1', 'eyJhbGci', '/9j/2Q']) assert.ok(!clean.includes(secret), `${secret} leaked: ${clean}`);
  assert.match(clean, /\[email\]/); assert.match(clean, /\[key\]/); assert.match(clean, /\[image\]/);
  assert.equal(log.scrub('x'.repeat(5000)).length, 200);
  assert.equal(log.scrub(null), null);
  assert.equal(log.scrub(new Error('boom ari@x.org')), 'Error: boom [email]');
});

test('the owner fingerprint is stable, short and not reversible to the email', async () => {
  const a = await log.fingerprint('ari@rescue.org');
  assert.equal(a, await log.fingerprint('ari@rescue.org'));
  assert.notEqual(a, await log.fingerprint('bre@rescue.org'));
  assert.match(a, /^[0-9a-f]{12}$/);
});

test('route labels never carry record ids', () => {
  assert.equal(log.routeLabel('/api/manage/cats'), '/api/manage/cats');
  assert.equal(log.routeLabel('/api/manage/photos/cat_8f3a1c2d9e7b4a5f6c1d'), '/api/manage/photos/:id');
});

test('events are stored without personal data, and a failing database never breaks the request', async () => {
  const { db, d1 } = fresh();
  const id = await quiet(() => log.recordEvent(d1, { kind: 'api_error', owner: 'ari@rescue.org', route: '/api/x', status: 500, detail: 'oops ari@rescue.org' }));
  assert.ok(id);
  const row = db.prepare('SELECT * FROM ops_events WHERE id=?').get(id);
  assert.equal(JSON.stringify(row).includes('ari@rescue.org'), false);
  assert.match(row.owner_hash, /^[0-9a-f]{12}$/);
  const broken = { prepare() { throw new Error('D1 down'); } };
  assert.equal(await quiet(() => log.recordEvent(broken, { kind: 'api_error' })), null);
  await quiet(() => log.finishEvent(broken, 'x', 5, 200));
  assert.throws(() => db.prepare("INSERT INTO ops_events(id,kind) VALUES('z','not_a_kind')").run(), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO ops_events(id,kind,detail) VALUES('z','api_error',?)").run('x'.repeat(301)), /CHECK/);
  assert.throws(() => db.prepare("INSERT INTO ops_flags(name,enabled) VALUES('bogus',0)").run(), /CHECK/);
});

// ---------------------------------------------------------------- AI limits and switches
test('AI is allowed until the hourly limit, then refused, per person', async () => {
  const { db, d1 } = fresh();
  assert.deepEqual(await limits.checkAi(d1, 'A', undefined, NOW), { ok: true });
  await addCalls(db, 'A', 'ai_call', limits.LIMITS.aiPerOwnerPerHour - 1, 10);
  assert.equal((await limits.checkAi(d1, 'A', undefined, NOW)).ok, true, 'one below the limit');
  await addCalls(db, 'A', 'ai_call', 1, 11);
  const refused = await limits.checkAi(d1, 'A', undefined, NOW);
  assert.equal(refused.ok, false); assert.equal(refused.kind, 'limited'); assert.equal(refused.status, 429);
  assert.match(refused.message, /Nothing was saved/);
  assert.equal((await limits.checkAi(d1, 'B', undefined, NOW)).ok, true, 'someone else is unaffected');
  assert.equal((await limits.checkAi(d1, 'A', undefined, new Date(NOW.getTime() + 61 * 60_000))).ok, true, 'recovers when the hour passes... if the daily limit allows');
});

test('the daily per-person limit and the whole-service ceiling hold', async () => {
  const { db, d1 } = fresh();
  await addCalls(db, 'A', 'ai_call', limits.LIMITS.aiPerOwnerPerDay, 300);
  const day = await limits.checkAi(d1, 'A', undefined, NOW);
  assert.equal(day.ok, false); assert.equal(day.detail, 'daily ai limit');
  const other = fresh();
  for (let i = 0; i < 8; i++) await addCalls(other.db, `user${i}`, 'ai_call', 50, 300);
  const service = await limits.checkAi(other.d1, 'newcomer', undefined, NOW);
  assert.equal(service.ok, false); assert.equal(service.detail, 'service ai limit');
  const old = fresh(); await addCalls(old.db, 'A', 'ai_call', 500, 25 * 60);
  assert.equal((await limits.checkAi(old.d1, 'A', undefined, NOW)).ok, true, 'calls older than a day do not count');
});

test('repeated provider failures pause the AI, then it recovers by itself', async () => {
  const { db, d1 } = fresh();
  await addCalls(db, 'A', 'ai_failure', limits.LIMITS.breakerFailures - 1, 2);
  assert.equal((await limits.checkAi(d1, 'A', undefined, NOW)).ok, true);
  await addCalls(db, 'A', 'ai_failure', 1, 3);
  const paused = await limits.checkAi(d1, 'B', undefined, NOW);
  assert.equal(paused.ok, false); assert.equal(paused.kind, 'paused'); assert.equal(paused.status, 503);
  assert.equal((await limits.checkAi(d1, 'B', undefined, new Date(NOW.getTime() + 11 * 60_000))).ok, true, 'ten quiet minutes later it tries again');
});

test('the emergency switches work from the environment and from the database, without a deploy', async () => {
  const { db, d1 } = fresh();
  for (const value of ['true', 'TRUE']) assert.equal((await limits.checkAi(d1, 'A', value, NOW)).kind, 'disabled');
  assert.equal((await limits.checkAi(d1, 'A', 'false', NOW)).ok, true);
  db.prepare("INSERT INTO ops_flags(name,enabled,reason) VALUES('ai',0,'provider outage')").run();
  assert.equal((await limits.checkAi(d1, 'A', undefined, NOW)).kind, 'disabled');
  assert.equal((await limits.flags(d1)).ai.reason, 'provider outage');
  db.prepare("UPDATE ops_flags SET enabled=1 WHERE name='ai'").run();
  assert.equal((await limits.checkAi(d1, 'A', undefined, NOW)).ok, true, 're-enabling is immediate');
  db.prepare("INSERT INTO ops_flags(name,enabled) VALUES('photo_uploads',0)").run();
  assert.match((await limits.photoRefusal(d1, 'A', NOW)).message, /switched off/);
  assert.equal(await limits.flagOn(d1, 'imports'), true);
});

test('photo uploads are capped per day', async () => {
  const { db, d1 } = fresh();
  db.exec(`INSERT INTO owners(id,status) VALUES('A','active'); INSERT INTO cats(id,owner_id,created_at,updated_at) VALUES('c1','A','${ago(5)}','${ago(5)}')`);
  assert.equal(await limits.photoRefusal(d1, 'A', NOW), null);
  const insert = db.prepare("INSERT INTO photos(id,owner_id,cat_id,storage_location,taken_at,created_at) VALUES(?,?,'c1',?,?,?)");
  for (let i = 0; i < limits.LIMITS.photosPerOwnerPerDay; i++) insert.run(`p${i}`, 'A', 'data:image/png;base64,AA', ago(5), ago(5));
  const refused = await limits.photoRefusal(d1, 'A', NOW);
  assert.equal(refused.status, 429); assert.match(refused.message, /Nothing was saved/);
});

// ---------------------------------------------------------------- the assistant route, end to end
const env = {};
const route = await loadRoute(env);
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const planFor = (note) => ({ intent: 'record', message: 'Saved.', clarification: null, confidence: 1, cats: [{ ref: 'new', existingId: null, name: 'Milo', sex: null, ageClass: null, appearance: null, distinguishingCharacteristics: null, healthObservations: null, reproductiveSignificance: null, origin: null, currentStatus: 'foster', currentLocation: null, microchipNumber: null }], people: [], events: [{ catRef: 'new', eventType: 'foster', occurredAt: null, location: null, personName: null, notes: note }], transactions: [], query: { kind: 'none', catId: null, status: null, year: null, search: null }, socialDraft: null });
function harness({ provider = 'ok' } = {}) {
  const { db, d1 } = fresh();
  env.DB = d1; env.OPENROUTER_API_KEY = 'test-key'; delete env.AI_DISABLED;
  const state = { providerCalls: 0 };
  globalThis.fetch = async () => {
    state.providerCalls++;
    if (provider === 'down') return new Response('nope', { status: 500 });
    if (provider === 'garbage') return Response.json({ choices: [{ message: { content: 'not json at all' } }] });
    return Response.json({ choices: [{ message: { content: JSON.stringify(planFor('Fostered')) } }] });
  };
  let n = 0;
  const post = (body, owner = 'A') => route.POST(new Request('https://rescue.test/api/assistant', { method: 'POST', headers: { 'x-catnr-user-id': owner, 'x-catnr-user-email': `${owner}@test` }, body: JSON.stringify({ requestKey: `k${++n}`, input: `Milo ${n} fostered`, ...body }) }));
  const events = (kind) => db.prepare('SELECT * FROM ops_events WHERE kind=?').all(kind);
  return { db, state, post, events };
}

test('a successful assistant call is counted once, with its duration, and logs no content', async () => {
  const h = harness();
  const res = await quiet(() => h.post({ input: 'Milo, grey tabby, fostered with Sarah Yunker' }));
  assert.equal(res.status, 200);
  const calls = h.events('ai_call');
  assert.equal(calls.length, 1); assert.equal(calls[0].status, 200); assert.ok(calls[0].duration_ms >= 0);
  assert.equal(JSON.stringify(h.db.prepare('SELECT * FROM ops_events').all()).includes('Sarah'), false, 'nothing Ari said is in the ops log');
});

test('provider failures are recorded, nothing is saved, and the user is told clearly', async () => {
  const h = harness({ provider: 'down' });
  const res = await quiet(() => h.post({}));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).outcome, 'ai_unavailable');
  assert.equal(h.events('ai_failure').length, 1);
  assert.equal(h.events('ai_call')[0].status, 502);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM cats').get().n, 0);
});

test('an unreadable provider answer is recorded as invalid and saves nothing', async () => {
  const h = harness({ provider: 'garbage' });
  const res = await quiet(() => h.post({}));
  assert.notEqual(res.status, 200);
  assert.equal(h.events('ai_invalid').length, 1);
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM cats').get().n, 0);
});

test('a runaway loop of different requests is stopped before it reaches the provider', async () => {
  const h = harness();
  let refusedAt = null;
  for (let i = 1; i <= limits.LIMITS.aiPerOwnerPerHour + 5; i++) {
    const res = await quiet(() => h.post({ input: `Milo ${i} fostered` }));
    if (res.status === 429) { refusedAt = i; assert.equal((await res.json()).outcome, 'ai_unavailable'); break; }
  }
  assert.equal(refusedAt, limits.LIMITS.aiPerOwnerPerHour + 1);
  assert.equal(h.state.providerCalls, limits.LIMITS.aiPerOwnerPerHour, 'the provider was never called past the limit');
  assert.ok(h.events('limit_hit').length >= 1);
});

test('the same request retried with the same key never calls the provider twice', async () => {
  const h = harness();
  const body = { requestKey: 'same', input: 'Milo fostered' };
  await quiet(() => h.post(body)); await quiet(() => h.post(body)); await quiet(() => h.post(body));
  assert.equal(h.state.providerCalls, 1);
  assert.equal(h.events('retry_replay').length, 2, 'the replays are counted for the ops report');
  assert.equal(h.db.prepare('SELECT COUNT(*) n FROM cats').get().n, 1);
});

test('switching the assistant off keeps the app working and never calls the provider', async () => {
  const h = harness();
  env.AI_DISABLED = 'true';
  const res = await quiet(() => h.post({ input: 'Which cats are waiting for adoption?', mode: 'ask' }));
  assert.equal(res.status, 200, 'simple questions still answer without the provider');
  assert.equal(h.state.providerCalls, 0);
  assert.equal(h.events('ai_call').length, 0);
  assert.equal(h.events('limit_hit').length, 1);
  env.AI_DISABLED = 'false';
  h.db.prepare("INSERT INTO ops_flags(name,enabled,reason) VALUES('ai',0,'cost')").run();
  await quiet(() => h.post({ input: 'Which cats are waiting for adoption?', mode: 'ask' }));
  assert.equal(h.state.providerCalls, 0, 'the database switch works too');
});

test('after repeated provider failures the provider is left alone', async () => {
  const h = harness({ provider: 'down' });
  for (let i = 0; i < limits.LIMITS.breakerFailures; i++) await quiet(() => h.post({}));
  assert.equal(h.state.providerCalls, limits.LIMITS.breakerFailures);
  const res = await quiet(() => h.post({}));
  assert.equal(res.status, 503); assert.match((await res.json()).message, /resting/);
  assert.equal(h.state.providerCalls, limits.LIMITS.breakerFailures, 'no further calls while paused');
});

test('bad and over-limit uploads are rejected and recorded', async () => {
  const h = harness();
  const bad = await quiet(() => h.post({ photoDataUrl: 'data:image/gif;base64,R0lGODlh' }));
  assert.equal(bad.status, 400);
  const huge = await quiet(() => h.post({ photoDataUrl: `data:image/png;base64,${'A'.repeat(1_900_000)}` }));
  assert.equal(huge.status, 400);
  assert.equal(h.events('upload_rejected').length, 2);
  assert.equal(h.state.providerCalls, 0);
  const stamp = new Date().toISOString();
  h.db.exec(`INSERT INTO owners(id,status) VALUES('A','active') ON CONFLICT DO NOTHING; INSERT INTO cats(id,owner_id,created_at,updated_at) VALUES('c1','A','${stamp}','${stamp}')`);
  const insert = h.db.prepare("INSERT INTO photos(id,owner_id,cat_id,storage_location,taken_at,created_at) VALUES(?,?,'c1',?,?,?)");
  for (let i = 0; i < limits.LIMITS.photosPerOwnerPerDay; i++) insert.run(`p${i}`, 'A', PHOTO, new Date().toISOString(), new Date().toISOString());
  const capped = await quiet(() => h.post({ photoDataUrl: PHOTO }));
  assert.equal(capped.status, 429);
  assert.equal(h.state.providerCalls, 0);
});

// ---------------------------------------------------------------- worker-level monitoring
test('request classification: errors, refused sign-ins, oversize and slow requests are noticed; healthy ones are not', () => {
  const c = observe.classify;
  assert.equal(c('/api/manage/cats', 500, 10).kind, 'api_error');
  assert.equal(c('/api/manage/cats', 503, 10).kind, 'api_error');
  assert.equal(c('/api/manage/cats', 401, 10).kind, 'auth_failure');
  assert.equal(c('/api/assistant', 413, 10).kind, 'limit_hit');
  assert.equal(c('/api/assistant', 200, observe.SLOW_MS).kind, 'slow_request');
  assert.equal(c('/api/assistant', 200, 120), null);
  assert.equal(c('/api/assistant', 429, 120), null, 'limit hits are recorded by the route, not twice');
  assert.equal(c('/', 500, 10), null, 'only API routes are monitored');
});

test('refused sign-ins are stored, but a flood cannot fill the database', async () => {
  const { db, d1 } = fresh();
  for (let i = 0; i < 80; i++) await quiet(() => observe.recordAuthFailure(d1, '/api/manage/cats', 401, 'bad token'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM ops_events WHERE kind='auth_failure'").get().n, 50);
});

test('status report shows configuration without revealing any secret', async () => {
  const { db, d1 } = fresh();
  db.prepare("INSERT INTO ops_events(id,kind,at) VALUES('j','job_ok',?)").run(new Date().toISOString());
  const report = await status.opsStatus(d1, { ENVIRONMENT: 'production', ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com', ACCESS_AUD: 'aud123', OPENROUTER_API_KEY: 'sk-or-v1-supersecret0000' });
  assert.equal(report.environment, 'production'); assert.equal(report.ai.providerConfigured, true); assert.equal(report.signIn.configured, true);
  assert.equal(JSON.stringify(report).includes('supersecret'), false); assert.equal(JSON.stringify(report).includes('aud123'), false);
  assert.ok(report.lastDailyJob.succeeded);
});

test('the worker wires monitoring, hardening and the daily job report correctly', async () => {
  const src = await readFile(path.join(root, 'worker/index.ts'), 'utf8');
  assert.match(src, /observe\(env\.DB/); assert.match(src, /recordAuthFailure/);
  assert.match(src, /job_ok/); assert.match(src, /job_failure/);
  assert.match(src, /x-content-type-options/); assert.match(src, /private, no-store/);
  assert.match(src, /MAX_REQUEST_BYTES/);
  assert.match(src, /catch \{[^}]*503/s, 'an Access outage fails closed with a retryable message instead of a crash');
  assert.ok(src.indexOf('withIdentity(request, env)') < src.indexOf('/_ops/status'), 'the status page is behind sign-in');
});

test('the daily clean-up trims the ops log after 90 days and nothing else', async () => {
  const { db, d1 } = fresh();
  const old = new Date(NOW.getTime() - 91 * 86400_000).toISOString(), recent = new Date(NOW.getTime() - 89 * 86400_000).toISOString();
  db.prepare("INSERT INTO ops_events(id,kind,at) VALUES('old','api_error',?),('new','api_error',?)").run(old, recent);
  const res = await retention.purgeExpired(d1, NOW);
  assert.equal(res.opsEventsRemoved, 1);
  assert.deepEqual(db.prepare('SELECT id FROM ops_events').all().map((r) => r.id), ['new']);
  assert.ok(retention.RETENTION_RULES.some((r) => r.id === 'ops' && r.automatic));
});

// ---------------------------------------------------------------- backup and restore
function dumpSql(db, skipTypes = []) {
  const out = ['PRAGMA defer_foreign_keys=TRUE;'];
  const objects = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid").all();
  for (const o of objects.filter((x) => x.type === 'table')) {
    out.push(`${o.sql};`);
    const cols = db.prepare(`PRAGMA table_info("${o.name}")`).all().map((c) => c.name);
    for (const row of db.prepare(`SELECT ${cols.map((c) => `quote("${c}") q`).join(',')} FROM "${o.name}"`.replace(/quote\("(.+?)"\) q/g, (_, c) => `quote("${c}") "${c}"`)).all()) out.push(`INSERT INTO "${o.name}" VALUES(${cols.map((c) => row[c]).join(',')});`);
  }
  for (const o of objects.filter((x) => x.type !== 'table' && !skipTypes.includes(x.type))) out.push(`${o.sql};`);
  return out.join('\n');
}
const seeded = () => {
  const { db, d1 } = fresh();
  db.exec(`INSERT INTO owners(id,status) VALUES('A','active');
   INSERT INTO colonies(id,owner_id,name,created_at) VALUES('col1','A','Jefferson''s Yard','2026-01-01T00:00:00.000Z');
   INSERT INTO cats(id,owner_id,name,origin_colony_id,created_at,updated_at) VALUES('c1','A','Milo "the tank"','col1','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
   INSERT INTO photos(id,owner_id,cat_id,storage_location,taken_at,created_at) VALUES('p1','A','c1','data:image/png;base64,iVBORw0KGgo=','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);
  return { db, d1 };
};
const counts = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(({ name }) => [name, db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n]));

test('a good backup restores to exactly the same schema, protections and row counts', async () => {
  const { db } = seeded();
  const dir = await mkdtemp(path.join(tmpdir(), 'catnr-bk-'));
  try {
    const file = path.join(dir, 'b.sql'); await writeFile(file, dumpSql(db));
    const result = verifyRestore(file, { tables: counts(db) });
    assert.deepEqual(result.problems, []); assert.equal(result.ok, true);
    assert.equal(result.counts.cats, 1); assert.equal(result.counts.photos, 1);
    assert.ok(result.triggers >= 20, 'the audit triggers came back too');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a damaged, truncated or incomplete backup is reported as FAIL, never as a quiet success', async () => {
  const { db } = seeded();
  const good = dumpSql(db), manifest = { tables: counts(db) };
  const dir = await mkdtemp(path.join(tmpdir(), 'catnr-bk-'));
  const check = async (name, sql, m = manifest) => { const f = path.join(dir, name); await writeFile(f, sql); return verifyRestore(f, m); };
  try {
    const noTriggers = await check('t.sql', dumpSql(db, ['trigger']));
    assert.equal(noTriggers.ok, false); assert.ok(noTriggers.problems.some((p) => /trigger/i.test(p)));
    const missingRow = await check('r.sql', good.split('\n').filter((l) => !l.startsWith('INSERT INTO "photos"')).join('\n'));
    assert.equal(missingRow.ok, false); assert.ok(missingRow.problems.some((p) => /photos: backup had 1 rows/.test(p)));
    const broken = await check('b.sql', good.slice(0, good.length - 40) + '\nINSERT INTO nowhere');
    assert.equal(broken.ok, false);
    const extra = await check('x.sql', good + '\nCREATE TABLE surprise(x);');
    assert.equal(extra.ok, false); assert.ok(extra.problems.some((p) => /surprise/.test(p)));
    const orphan = await check('o.sql', good.replace('PRAGMA defer_foreign_keys=TRUE;', '') + "\nPRAGMA foreign_keys=OFF;\nINSERT INTO cats(id,owner_id,created_at,updated_at) VALUES('c9','ghost','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');", { tables: { ...counts(db), cats: 2 } });
    assert.equal(orphan.ok, false); assert.ok(orphan.problems.some((p) => /foreign-key|owner|constraint/i.test(p)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- deploy safety and configuration
test('staging is a separate worker and database, and the offline deployment check passes', () => {
  const out = execFileSync('node', ['scripts/verify-deploy.mjs', '--offline'], { cwd: root, encoding: 'utf8' });
  assert.match(out, /0 failed/);
  assert.match(out, /staging and production use different databases/);
  assert.match(out, /no API key has ever been committed/);
  const staging = execFileSync('node', ['scripts/verify-deploy.mjs', '--offline', '--env', 'staging'], { cwd: root, encoding: 'utf8' });
  assert.match(staging, /ENVIRONMENT is "staging"/);
});

test('the deploy script refuses to release a build for the wrong place', async () => {
  const src = await readFile(path.join(root, 'scripts/deploy.mjs'), 'utf8');
  for (const guard of ['uncommitted changes', "!== 'main'", 'scripts/backup.mjs', 'is for worker', 'bound to database', "CLOUDFLARE_ENV: 'staging'"]) assert.ok(src.includes(guard), guard);
  assert.ok(src.indexOf("scripts/backup.mjs") < src.indexOf("'migrations', 'apply'"), 'the backup is taken before any migration');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.deploy, 'node scripts/deploy.mjs production');
  const dry = execFileSync('node', ['scripts/deploy.mjs', 'staging', '--dry-run'], { cwd: root, encoding: 'utf8' });
  assert.match(dry, /migrations apply catnr-staging-db --remote --env staging/);
  assert.doesNotMatch(dry, /catnr-db --remote/);
});

test('no secret is readable by the browser or hard-coded in source', async () => {
  const { readdir, stat } = await import('node:fs/promises');
  const walk = async (dir) => (await Promise.all((await readdir(dir)).map(async (f) => { const p = path.join(dir, f); return (await stat(p)).isDirectory() ? walk(p) : [p]; }))).flat();
  for (const file of [...await walk(path.join(root, 'app')), ...await walk(path.join(root, 'worker'))].filter((f) => /\.(ts|tsx)$/.test(f))) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /sk-or-v1-[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{30,}/, `${file} contains a key`);
    if (/^\s*['"]use client['"]/m.test(text)) assert.doesNotMatch(text, /OPENROUTER|OPENAI_API_KEY|process\.env|cloudflare:workers/, `${file} runs in the browser but references server secrets`);
  }
});

test('oversize rows are split into statements D1 accepts, and replay to identical data', async () => {
  const { splitLargeStatements, splitStatement } = await import('../scripts/lib/split.mjs');
  const { db } = seeded();
  const huge = `data:image/jpeg;base64,${'QUJD'.repeat(70_000)}it''s`;
  const line = `INSERT INTO "photos" ("id","owner_id","cat_id","event_id","storage_location","taken_at","caption","created_at","archived_at") VALUES('big','A','c1',NULL,'${huge}','2026-01-01T00:00:00.000Z','a ''quoted'' caption','2026-01-01T00:00:00.000Z',NULL);`;
  const statements = splitLargeStatements(line).split('\n');
  assert.ok(statements.length > 3);
  assert.ok(Math.max(...statements.map((s) => s.length)) < 90_000, 'every statement fits under D1\'s limit');
  for (const s of statements) db.exec(s);
  const row = db.prepare("SELECT storage_location, caption FROM photos WHERE id='big'").get();
  assert.equal(row.storage_location, huge.replaceAll("''", "'"));
  assert.equal(row.caption, "a 'quoted' caption");
  assert.deepEqual(splitStatement("INSERT INTO t (a) VALUES(1);"), ["INSERT INTO t (a) VALUES(1);"], 'small statements are untouched');
  assert.throws(() => splitStatement('X'.repeat(100_000)), /could not be split/);
});

test('a backup taken before a pending migration is judged against the migrations it had, not the newest', async () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON');
  const names = (await import('./helpers/migrations.mjs')).migrationNames;
  for (const sql of migrations.slice(0, -1)) db.exec(sql);
  const dir = await mkdtemp(path.join(tmpdir(), 'catnr-bk-'));
  try {
    const file = path.join(dir, 'old.sql'); await writeFile(file, dumpSql(db));
    assert.equal(verifyRestore(file, { tables: counts(db), appliedMigrations: names.slice(0, -1) }).ok, true);
    assert.equal(verifyRestore(file, { tables: counts(db) }).ok, false, 'without the list it would (rightly) look incomplete');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
