// Runs the migrations on the real D1 engine (workerd via Miniflare), not just node:sqlite.
// Covers what only D1 can prove: each migration applies as an atomic batch, D1's compound-SELECT
// limit, foreign-key enforcement, and rollback of a failed batch. Run with `npm run test:d1`
// (needs permission to bind localhost).
import { Miniflare } from 'miniflare';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { loadTs } from './helpers/load-ts.mjs';

const dir = new URL('../drizzle/', import.meta.url);
const names = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
const files = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await readFile(new URL(n, dir), 'utf8')])));
const statements = (name) => files[name].split('--> statement-breakpoint').map((x) => x.trim()).filter(Boolean);
const T0 = '2026-01-01T00:00:00.000Z';

async function newDb() {
  const mf = new Miniflare({ modules: true, script: 'export default { fetch(){ return new Response("ok") } }', d1Databases: ['DB'], compatibilityDate: '2026-05-22' });
  return { mf, db: await mf.getD1Database('DB') };
}
const apply = (db, name) => db.batch(statements(name).map((s) => db.prepare(s))); // like `wrangler d1 migrations apply`
const shape = async (db) => (await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type,name").all()).results.map((r) => `${r.type}|${r.name}|${r.tbl_name}|${(r.sql || '').replace(/\s+/g, ' ')}`);

// 1. Existing environment: legacy data, then every migration in order.
const upgrade = await newDb();
const fresh = await newDb();
try {
  const { db } = upgrade;
  for (const name of names) {
    if (name.startsWith('0002')) await db.exec(`INSERT INTO colonies(id,name,created_at) VALUES('oldcol','Yard','${T0}'); INSERT INTO cats(id,name,origin_colony_id,created_at,updated_at) VALUES('oldcat','Pepper','oldcol','${T0}','${T0}');`.replace(/\n/g, ' '));
    if (name.startsWith('0007')) {
      await db.exec(`INSERT INTO ai_inputs(id,owner_id,transcription,input_type,created_at) VALUES('in1','A','x','text','${T0}'); INSERT INTO cats(id,owner_id,name,created_at,updated_at) VALUES('c1','A','Milo','${T0}','${T0}'); INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount,currency,description,created_at) VALUES('t1','A','cash_donation','inflow','${T0}',19.99,'USD','gift','${T0}'),('t2','A','cash_donation','inflow','${T0}',0.1,NULL,'dime','${T0}');`);
      await apply(db, name);
    } else await apply(db, name);
  }
  assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length, 0);
  assert.deepEqual((await db.prepare('SELECT id,amount_minor a,currency c FROM transactions ORDER BY id').all()).results, [{ id: 't1', a: 1999, c: 'USD' }, { id: 't2', a: 10, c: 'USD' }]);
  assert.deepEqual((await db.prepare('SELECT id,status FROM owners ORDER BY id').all()).results, [{ id: 'A', status: 'active' }, { id: 'legacy:quarantine', status: 'quarantined' }]);
  assert.equal((await db.prepare("SELECT owner_id FROM cats WHERE id='oldcat'").first()).owner_id, 'legacy:quarantine');

  // 2. New environment: migrations alone, identical schema to the upgraded one.
  for (const name of names) await apply(fresh.db, name);
  assert.deepEqual(await shape(upgrade.db), await shape(fresh.db), 'fresh and upgraded schemas are identical');

  // 3. D1 enforces the relationships and the exact-money rules.
  const f = fresh.db;
  await f.prepare(`INSERT INTO cats(id,owner_id,name,created_at,updated_at) VALUES('c','A','Milo','${T0}','${T0}')`).run();
  const rejects = async (sql, pattern) => assert.rejects(f.prepare(sql).run(), pattern, sql);
  await rejects(`INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,created_at) VALUES('e','A','missing','x','${T0}','${T0}')`, /FOREIGN KEY|Invalid ownership/);
  await rejects(`INSERT INTO cats(id,owner_id,created_at,updated_at) VALUES('n',NULL,'${T0}','${T0}')`, /./);
  await rejects(`INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount_minor,description,created_at) VALUES('x','A','cash','inflow','${T0}',12.5,'d','${T0}')`, /CHECK/);
  await rejects(`INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount_minor,currency,description,created_at) VALUES('x','A','cash','inflow','${T0}',100,'XYZ','d','${T0}')`, /FOREIGN KEY/);
  await f.prepare(`INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,created_at) VALUES('e','A','c','vet','${T0}','${T0}')`).run();
  await rejects(`DELETE FROM cats WHERE id='c'`, /FOREIGN KEY/);

  // 3b. Stage 7: archived names are reusable, audit/merge history is immutable and protects its records.
  await f.prepare(`INSERT INTO colonies(id,owner_id,name,created_at) VALUES('k1','A','Jefferson','${T0}')`).run();
  await rejects(`INSERT INTO colonies(id,owner_id,name,created_at) VALUES('k2','A','JEFFERSON','${T0}')`, /UNIQUE/);
  await f.prepare("UPDATE colonies SET archived_at='x' WHERE id='k1'").run();
  await f.prepare(`INSERT INTO colonies(id,owner_id,name,created_at) VALUES('k2','A','JEFFERSON','${T0}')`).run();
  await f.prepare(`INSERT INTO merges(id,owner_id,record_type,survivor_id,merged_id,actor_id,created_at) VALUES('m','A','colony','k2','k1','A','${T0}')`).run();
  await rejects("UPDATE merges SET actor_id='B'", /immutable/);
  await rejects("DELETE FROM merges", /immutable/);
  await rejects("DELETE FROM colonies WHERE id='k1'", /preserved/);
  await rejects(`INSERT INTO record_changes(id,owner_id,record_type,record_id,action,actor_id,created_at) VALUES('r','A','cat','nope','update','A','${T0}')`, /Invalid ownership/);
  await f.prepare("UPDATE colonies SET notes='n' WHERE id='k2'").run();
  assert.equal((await f.prepare("SELECT version FROM colonies WHERE id='k2'").first()).version, 1);

  // 4. A failed batch rolls everything back (version guards, triggers, foreign keys).
  const before = await f.prepare("SELECT version FROM rescue_revisions WHERE owner_id='A'").first();
  await assert.rejects(f.batch([f.prepare("UPDATE cats SET current_status='adopted' WHERE id='c'"), f.prepare("INSERT INTO write_guards(owner_id,expected_version) VALUES('A',-1)")]), /Concurrent edit/);
  assert.equal((await f.prepare("SELECT current_status s FROM cats WHERE id='c'").first()).s, 'observed');
  assert.equal((await f.prepare("SELECT version FROM rescue_revisions WHERE owner_id='A'").first()).version, before.version);

  // 4b. Stage 10: deleting a whole account is one atomic batch on D1 - audited history goes, other owners stay.
  const account = (await loadTs('app/portability/account.ts')).resource;
  await f.prepare(`INSERT INTO cats(id,owner_id,name,created_at,updated_at) VALUES('bc','B','Theirs','${T0}','${T0}')`).run();
  await f.prepare(`INSERT INTO ai_inputs(id,owner_id,transcription,input_type,created_at) VALUES('ai','A','said','text','${T0}')`).run();
  await account.post(f, 'A', { action: 'request' });
  await f.prepare("UPDATE deletion_requests SET execute_after='2020-01-01T00:00:00.000Z'").run();
  const rev = (await account.read(f, 'A')).revision;
  await assert.rejects(account.post(f, 'A', { action: 'confirm', confirm: 'nope', revision: rev }), /exactly/);
  assert.equal((await f.prepare("SELECT count(*) n FROM cats WHERE owner_id='A'").first()).n, 1, 'a refused confirmation deletes nothing');
  const gone = await account.post(f, 'A', { action: 'confirm', confirm: 'DELETE MY RESCUE DATA', revision: rev });
  assert.equal(gone.outcome, 'deleted');
  for (const t of ['cats', 'events', 'colonies', 'merges', 'ai_inputs']) assert.equal((await f.prepare(`SELECT count(*) n FROM ${t} WHERE owner_id='A'`).first()).n, 0, t);
  assert.equal((await f.prepare("SELECT count(*) n FROM owners WHERE id='A'").first()).n, 0);
  assert.equal((await f.prepare("SELECT count(*) n FROM cats WHERE owner_id='B'").first()).n, 1);
  assert.equal((await f.prepare('SELECT count(*) n FROM deletion_in_progress').first()).n, 0);
  assert.equal((await f.prepare('PRAGMA foreign_key_check').all()).results.length, 0);

  // 5. A legacy half-cent aborts the whole migration batch and leaves the old schema intact.
  const bad = await newDb();
  try {
    for (const name of names.filter((n) => n < '0007')) await apply(bad.db, name);
    await bad.db.exec(`INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount,description,created_at) VALUES('t','A','cash_donation','inflow','${T0}',10.005,'half cent','${T0}')`);
    await assert.rejects(apply(bad.db, names.find((n) => n.startsWith('0007'))), /whole number of cents/);
    assert.equal((await bad.db.prepare("SELECT amount FROM transactions WHERE id='t'").first()).amount, 10.005);
    assert.equal((await bad.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='owners'").first()).n, 0);
  } finally { await bad.mf.dispose(); }
  console.log(`Actual D1: ${names.length} migrations (upgrade + fresh), identical schema, foreign keys, exact money, atomic rollback and whole-account deletion passed`);
} finally { await upgrade.mf.dispose(); await fresh.mf.dispose(); }
