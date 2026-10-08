import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { migrations, migrationNames } from './helpers/migrations.mjs';
import { moneyURL } from './helpers/money.mjs';

const money = await import(moneyURL);
const root = fileURLToPath(new URL('..', import.meta.url));
const T0 = '2026-01-01T00:00:00.000Z';
const OWNED = ['colonies', 'people', 'ai_inputs', 'cats', 'events', 'photos', 'transactions', 'write_requests', 'rescue_revisions', 'write_guards', 'corrections', 'proposed_actions', 'proposal_executions', 'clarifications', 'clarification_answers', 'clarification_resolutions', 'merges', 'record_changes', 'duplicate_dismissals', 'data_exports', 'deletion_requests'];

const open = () => { const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); return db; };
const fresh = () => { const db = open(); for (const sql of migrations) db.exec(sql); return db; };
const fks = (db, table) => db.prepare(`PRAGMA foreign_key_list(${table})`).all();
const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all();
const shape = (db) => db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map((r) => `${r.type}|${r.name}|${r.tbl_name}|${(r.sql || '').replace(/\s+/g, ' ')}`);
const seed = (db) => db.exec(`
 INSERT INTO ai_inputs(id,owner_id,transcription,input_type,created_at) VALUES('in1','A','x','text','${T0}'),('inB','B','x','text','${T0}');
 INSERT INTO colonies(id,owner_id,name,created_at) VALUES('col1','A','Jefferson','${T0}'),('colB','B','Elm','${T0}');
 INSERT INTO people(id,owner_id,name,created_at) VALUES('p1','A','Sarah','${T0}'),('pB','B','Other','${T0}');
 INSERT INTO cats(id,owner_id,name,origin_colony_id,created_at,updated_at) VALUES('c1','A','Milo','col1','${T0}','${T0}'),('cB','B','Theirs',NULL,'${T0}','${T0}');
 INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,created_at) VALUES('e1','A','c1','vet_visit','${T0}','${T0}');`);
const txn = (db, id, cols = '', vals = '') => db.exec(`INSERT INTO transactions(id,owner_id,transaction_type,direction,date,description,created_at${cols}) VALUES('${id}','A','cash_donation','inflow','${T0}','d','${T0}'${vals})`);

test('a new environment is created from migrations alone and is internally consistent', () => {
  const db = fresh();
  assert.equal(migrationNames.at(-1), '0010_operations.sql');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check), ['ok']);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name).sort();
  assert.deepEqual(tables, ['owners', 'currencies', 'deletion_in_progress', 'deletion_receipts', 'ops_events', 'ops_flags', ...OWNED].sort());
  assert.equal(tables.filter((n) => n.endsWith('__n')).length, 0, 'no leftover rebuild tables');
  db.close();
});

test('every owned table has a mandatory owner that is a real foreign key to owners', () => {
  const db = fresh();
  for (const table of OWNED) {
    const owner = columns(db, table).find((c) => c.name === 'owner_id');
    assert.ok(owner, `${table}.owner_id exists`);
    assert.equal(owner.notnull, 1, `${table}.owner_id is NOT NULL`);
    const toOwners = fks(db, table).filter((f) => f.table === 'owners' && f.from === 'owner_id');
    assert.equal(toOwners.length, 1, `${table}.owner_id references owners`);
    assert.equal(toOwners[0].on_delete, 'RESTRICT');
    assert.equal(toOwners[0].on_update, 'RESTRICT');
  }
  db.close();
});

test('record links are enforced as owner-scoped foreign keys with restrict (never cascade)', () => {
  const db = fresh();
  const expected = {
    cats: ['origin_colony_id'], events: ['cat_id', 'person_id', 'source_input_id', 'superseded_by'], photos: ['cat_id', 'event_id'],
    transactions: ['person_id', 'related_cat_id', 'related_event_id', 'related_colony_id', 'source_input_id', 'superseded_by'],
    corrections: ['source_input_id', 'reverts_id'], proposed_actions: ['input_id'], proposal_executions: ['proposal_id'],
    clarifications: ['input_id'], clarification_answers: ['clarification_id', 'input_id'], clarification_resolutions: ['clarification_id'],
  };
  for (const [table, links] of Object.entries(expected)) {
    for (const column of links) {
      const rows = fks(db, table).filter((f) => f.from === column);
      assert.ok(rows.length, `${table}.${column} has a foreign key`);
      assert.ok(fks(db, table).some((f) => f.from === 'owner_id' && f.id === rows[0].id), `${table}.${column} is checked together with owner_id`);
      assert.equal(rows[0].on_delete, 'RESTRICT', `${table}.${column} restricts delete`);
    }
  }
  for (const table of [...OWNED, 'owners', 'currencies']) assert.ok(!fks(db, table).some((f) => /CASCADE|SET/.test(f.on_delete)), `${table} has no cascading delete`);
  db.close();
});

test('foreign keys are enforced by the database even without the ownership triggers', () => {
  const db = fresh(); seed(db);
  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE '%ownership%')").all();
  assert.ok(triggers.length > 5);
  for (const { name } of triggers) db.exec(`DROP TRIGGER ${name}`);
  assert.throws(() => db.exec(`INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,created_at) VALUES('x','A','nope','vet_visit','${T0}','${T0}')`), /FOREIGN KEY/);
  assert.throws(() => db.exec(`INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,created_at) VALUES('x','A','cB','vet_visit','${T0}','${T0}')`), /FOREIGN KEY/, "another owner's cat");
  assert.throws(() => db.exec(`INSERT INTO cats(id,owner_id,origin_colony_id,created_at,updated_at) VALUES('x','A','colB','${T0}','${T0}')`), /FOREIGN KEY/);
  assert.throws(() => db.exec(`INSERT INTO photos(id,owner_id,cat_id,storage_location,taken_at) VALUES('x','A','cB','s','${T0}')`), /FOREIGN KEY/);
  assert.throws(() => txn(db, 'x', ',person_id', ",'pB'"), /FOREIGN KEY/);
  assert.throws(() => txn(db, 'x', ',source_input_id', ",'inB'"), /FOREIGN KEY/);
  assert.throws(() => db.exec(`INSERT INTO cats(id,owner_id,created_at,updated_at) VALUES('x','ghost','${T0}','${T0}')`) || db.exec("UPDATE cats SET owner_id='ghost' WHERE id='c1'"), /./);
  db.close();
});

test('deleting a parent that has dependants is refused, and owners cannot be removed', () => {
  const db = fresh(); seed(db);
  assert.throws(() => db.exec("DELETE FROM cats WHERE id='c1'"), /FOREIGN KEY/);
  assert.throws(() => db.exec("DELETE FROM colonies WHERE id='col1'"), /FOREIGN KEY/);
  assert.doesNotThrow(() => db.exec("DELETE FROM ai_inputs WHERE id='inB'"), 'an unreferenced input can go, a referenced one cannot');
  db.exec(`INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,source_input_id,created_at) VALUES('e2','A','c1','observation','${T0}','in1','${T0}')`);
  assert.throws(() => db.exec("DELETE FROM ai_inputs WHERE id='in1'"), /FOREIGN KEY/);
  assert.throws(() => db.exec("DELETE FROM owners WHERE id='A'"), /FOREIGN KEY/);
  assert.throws(() => db.exec("UPDATE owners SET id='Z' WHERE id='A'"), /FOREIGN KEY/);
  assert.equal(db.prepare("SELECT count(*) n FROM events WHERE id='e1'").get().n, 1);
  db.close();
});

test('owners are registered from verified writes only; reserved and empty identities never are', () => {
  const db = open(); for (const sql of migrations) db.exec(sql);
  assert.equal(db.prepare('SELECT count(*) n FROM owners').get().n, 0);
  db.exec(`INSERT INTO colonies(id,owner_id,name,created_at) VALUES('k','new@person.test','Yard','${T0}')`);
  assert.deepEqual(db.prepare('SELECT id,status FROM owners').all().map((r) => ({ ...r })), [{ id: 'new@person.test', status: 'active' }]);
  for (const bad of ['', '  ', 'local-owner', 'legacy:quarantine', null]) {
    assert.throws(() => db.prepare(`INSERT INTO colonies(id,owner_id,name,created_at) VALUES('bad',?,'X','${T0}')`).run(bad), /./, `owner ${JSON.stringify(bad)} rejected`);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM owners').get().n, 1);
  db.close();
});

test('uniqueness: names per owner (case-insensitive) and microchips; the same photo may attach to two records', () => {
  const db = fresh(); seed(db);
  assert.throws(() => db.exec(`INSERT INTO colonies(id,owner_id,name,created_at) VALUES('d','A','JEFFERSON','${T0}')`), /UNIQUE/);
  db.exec(`INSERT INTO colonies(id,owner_id,name,created_at) VALUES('d','B','Jefferson','${T0}')`);
  assert.throws(() => db.exec(`INSERT INTO people(id,owner_id,name,created_at) VALUES('d','A','sarah','${T0}')`), /UNIQUE/);
  db.exec("UPDATE cats SET microchip_number='123456789012345' WHERE id='c1'");
  assert.throws(() => db.exec(`INSERT INTO cats(id,owner_id,microchip_number,created_at,updated_at) VALUES('c2','A','123456789012345','${T0}','${T0}')`), /UNIQUE/);
  db.exec(`INSERT INTO cats(id,owner_id,created_at,updated_at) VALUES('c3','A','${T0}','${T0}'),('c4','A','${T0}','${T0}')`); // many cats without a chip
  db.exec(`INSERT INTO photos(id,owner_id,cat_id,storage_location,taken_at) VALUES('ph1','A','c1','data:image/jpeg;base64,AAAA','${T0}'),('ph2','A','c3','data:image/jpeg;base64,AAAA','${T0}')`);
  assert.throws(() => db.exec(`INSERT INTO photos(id,owner_id,storage_location,taken_at) VALUES('ph3','A','s','${T0}')`), /CHECK/, 'a photo belongs to a cat or an event');
  db.close();
});

test('nullability, defaults, timestamps and vocabularies are enforced', () => {
  const db = fresh(); seed(db);
  assert.throws(() => db.exec("INSERT INTO colonies(id,name) VALUES('x','No owner')"), /./);
  assert.throws(() => db.exec(`INSERT INTO colonies(id,owner_id,name,created_at) VALUES('x','A','   ','${T0}')`), /CHECK/);
  assert.throws(() => db.exec(`INSERT INTO cats(id,owner_id,sex,created_at,updated_at) VALUES('x','A','robot','${T0}','${T0}')`), /CHECK/);
  assert.throws(() => db.exec(`INSERT INTO cats(id,owner_id,age_class,created_at,updated_at) VALUES('x','A','ancient','${T0}','${T0}')`), /CHECK/);
  assert.throws(() => db.exec(`INSERT INTO transactions(id,owner_id,transaction_type,direction,date,description) VALUES('x','A','cash','sideways','${T0}','d')`), /CHECK/);
  assert.throws(() => db.exec(`INSERT INTO ai_inputs(id,owner_id,transcription,input_type,confidence) VALUES('x','A','t','text',7)`), /CHECK/);
  db.exec("INSERT INTO colonies(id,owner_id,name) VALUES('auto','A','Defaults')");
  const row = db.prepare("SELECT created_at,updated_at FROM colonies WHERE id='auto'").get();
  assert.match(row.created_at, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/); assert.equal(row.created_at, row.updated_at);
  // updated_at is system-managed: any change to a person, event, transaction or colony moves it forward.
  for (const [table, id, set] of [['people', 'p1', "contact='555'"], ['events', 'e1', "notes='n'"], ['colonies', 'auto', "notes='n'"]]) {
    db.exec(`UPDATE ${table} SET updated_at='${T0}' WHERE id='${id}'`);
    db.exec(`UPDATE ${table} SET ${set} WHERE id='${id}'`);
    assert.ok(db.prepare(`SELECT updated_at FROM ${table} WHERE id='${id}'`).get().updated_at > '2026-06-01', `${table}.updated_at advances on change`);
  }
  db.close();
});

test('financial amounts are exact integers with an explicit currency; cents are preserved', () => {
  const db = fresh(); seed(db);
  const amountCols = columns(db, 'transactions').map((c) => c.name);
  assert.ok(!amountCols.includes('amount') && !amountCols.includes('estimated_value'), 'no floating money columns remain');
  for (const name of ['amount_minor', 'estimated_value_minor']) assert.equal(columns(db, 'transactions').find((c) => c.name === name).type, 'INTEGER');
  assert.equal(columns(db, 'transactions').find((c) => c.name === 'currency').notnull, 1);
  // 10c + 20c + 0.01 style sums are exact (they would not be as REAL).
  for (const [i, minor] of [10, 20, 1999, 1, 129_00].entries()) txn(db, `m${i}`, ',amount_minor', `,${minor}`);
  assert.equal(db.prepare('SELECT SUM(amount_minor) s FROM transactions').get().s, 10 + 20 + 1999 + 1 + 12900);
  assert.throws(() => txn(db, 'f', ',amount_minor', ',12.5'), /CHECK/, 'a fractional number cannot be stored');
  assert.throws(() => txn(db, 'f', ',amount_minor', ",'twelve'"), /CHECK/, 'text cannot be stored as money');
  assert.throws(() => txn(db, 'f', ',amount_minor', ',-1'), /CHECK/);
  assert.throws(() => txn(db, 'f', ',estimated_value_minor', ',0.5'), /CHECK/);
  assert.throws(() => txn(db, 'f', ',amount_minor,currency', ",100,'XYZ'"), /FOREIGN KEY/, 'unknown currency');
  assert.throws(() => txn(db, 'f', ',amount_minor,currency', ',100,NULL'), /NOT NULL/);
  txn(db, 'cad', ',amount_minor,currency', ",500,'CAD'");
  const byCurrency = db.prepare('SELECT currency,SUM(amount_minor) s FROM transactions GROUP BY currency ORDER BY currency').all().map((r) => ({ ...r }));
  assert.deepEqual(byCurrency, [{ currency: 'CAD', s: 500 }, { currency: 'USD', s: 14930 }], 'currencies are never mixed');
  assert.throws(() => db.exec("UPDATE currencies SET minor_unit=0 WHERE code='CAD'"), /minor unit/, 'a currency in use keeps its precision');
  db.exec("UPDATE currencies SET minor_unit=3 WHERE code='MXN'"); // unused currency may still be corrected
  db.close();
});

test('supported currencies match the money module exactly', () => {
  const db = fresh();
  const rows = Object.fromEntries(db.prepare('SELECT code,minor_unit FROM currencies').all().map((r) => [r.code, r.minor_unit]));
  assert.deepEqual(rows, { ...money.CURRENCY_MINOR_UNITS });
  assert.equal(money.DEFAULT_CURRENCY, 'USD');
  db.close();
});

test('money module: exact conversion, no silent rounding, explicit currency', () => {
  assert.equal(money.toMinorUnits(19.99), 1999);
  assert.equal(money.toMinorUnits(129), 12900);
  assert.equal(money.toMinorUnits(0.1), 10);
  assert.equal(money.toMinorUnits(0.07), 7);
  assert.equal(money.toMinorUnits(1234567.89, 'CAD'), 123456789);
  assert.equal(money.toMinorUnits(0), 0);
  for (const bad of [1.005, 0.001, 0.1 + 0.2, 1e-7, 1e21, -1, NaN, Infinity, '5', null]) assert.throws(() => money.toMinorUnits(bad), money.MoneyError, `rejects ${String(bad)}`);
  assert.throws(() => money.toMinorUnits(5, 'XYZ'), /Unsupported currency/);
  assert.equal(money.minorToDecimalString(1999), '19.99'); assert.equal(money.minorToDecimalString(5), '0.05'); assert.equal(money.minorToDecimalString(0), '0.00'); assert.equal(money.minorToDecimalString(-250), '-2.50');
  assert.equal(money.formatMoney(12950), '$129.50'); assert.equal(money.formatMoney(500, 'CAD'), 'CA$5.00'); assert.equal(money.formatMoney(-500), '-$5.00');
  assert.equal(money.formatTotals([{ currency: 'USD', minor: 1000 }, { currency: 'CAD', minor: 500 }]), '$10.00 + CA$5.00');
  assert.equal(money.formatTotals([]), '$0.00');
  for (let cents = 0; cents < 100_000; cents += 7) assert.equal(money.toMinorUnits(Number(money.minorToDecimalString(cents))), cents, `round trip ${cents}`);
});

test('an upgraded database has exactly the same schema as a fresh one, and keeps its data', () => {
  const upgraded = open();
  for (const [i, sql] of migrations.entries()) {
    if (i === 2) upgraded.exec(`
      INSERT INTO colonies(id,name,created_at) VALUES('oldcol','Legacy yard','${T0}');
      INSERT INTO cats(id,name,origin_colony_id,created_at,updated_at) VALUES('oldcat','Pepper','oldcol','${T0}','${T0}');`);
    if (i === 7) {
      upgraded.exec(`
        INSERT INTO ai_inputs(id,owner_id,transcription,input_type,created_at) VALUES('in1','A','Sarah gave 19.99','text','${T0}');
        INSERT INTO people(id,owner_id,name,created_at) VALUES('p1','A','Sarah','${T0}');
        INSERT INTO cats(id,owner_id,name,created_at,updated_at) VALUES('c1','A','Milo','${T0}','${T0}');
        INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,source_input_id,created_at) VALUES('e1','A','c1','vet_visit','${T0}','in1','${T0}');
        INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount,currency,person_id,description,estimated_value,source_input_id,created_at) VALUES
          ('t1','A','cash_donation','inflow','${T0}',19.99,'USD','p1','gift',NULL,'in1','${T0}'),
          ('t2','A','cash_outflow','outflow','${T0}',0.1,NULL,NULL,'ten cents',NULL,NULL,'${T0}'),
          ('t3','A','in_kind_donation','inflow','${T0}',NULL,'CAD',NULL,'food',12.34,NULL,'${T0}'),
          ('t4','A','cash_donation','inflow','${T0}',1234567.89,'USD',NULL,'big',NULL,NULL,'${T0}');`);
    }
    upgraded.exec(sql);
  }
  assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
  assert.deepEqual(shape(upgraded), shape(fresh()), 'identical tables, indexes, triggers and views');
  const m = Object.fromEntries(upgraded.prepare('SELECT id,amount_minor a,estimated_value_minor v,currency c FROM transactions').all().map((r) => [r.id, { ...r }]));
  assert.deepEqual(m.t1, { id: 't1', a: 1999, v: null, c: 'USD' });
  assert.equal(m.t2.a, 10); assert.equal(m.t2.c, 'USD', 'a missing legacy currency becomes an explicit USD');
  assert.deepEqual([m.t3.a, m.t3.v, m.t3.c], [null, 1234, 'CAD']);
  assert.equal(m.t4.a, 123456789);
  assert.equal(upgraded.prepare('SELECT count(*) n FROM events WHERE id=?').get('e1').n, 1);
  // legacy rows survive but stay quarantined under an owner that can never write again
  assert.deepEqual(upgraded.prepare("SELECT id,owner_id FROM cats WHERE id='oldcat'").get() && { ...upgraded.prepare("SELECT id,owner_id FROM cats WHERE id='oldcat'").get() }, { id: 'oldcat', owner_id: 'legacy:quarantine' });
  assert.deepEqual(upgraded.prepare('SELECT id,status FROM owners ORDER BY id').all().map((r) => ({ ...r })), [{ id: 'A', status: 'active' }, { id: 'legacy:quarantine', status: 'quarantined' }]);
  assert.throws(() => upgraded.exec("UPDATE cats SET name='x' WHERE id='oldcat'"), /Invalid ownership/);
  assert.equal(upgraded.prepare("SELECT created_at,updated_at FROM colonies WHERE id='oldcol'").get().updated_at, T0, 'updated_at is backfilled from created_at');
  upgraded.close();
});

test('a legacy amount that is not a whole number of cents aborts the migration instead of being rounded', () => {
  const db = open();
  for (const [i, sql] of migrations.entries()) {
    if (i === 7) {
      db.exec(`INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount,description,created_at) VALUES('t','A','cash_donation','inflow','${T0}',10.005,'half cent','${T0}')`);
      db.exec('BEGIN');
      assert.throws(() => db.exec(sql), /whole number of cents/);
      db.exec('ROLLBACK');
      assert.equal(db.prepare("SELECT amount FROM transactions WHERE id='t'").get().amount, 10.005, 'old data untouched after the failed migration');
      assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='owners'").get().n, 0, 'nothing half-applied');
      break;
    }
    db.exec(sql);
  }
  db.close();
});

test('an unknown legacy currency also aborts the migration', () => {
  const db = open();
  for (const [i, sql] of migrations.entries()) {
    if (i === 7) {
      db.exec(`INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount,currency,description,created_at) VALUES('t','A','cash_donation','inflow','${T0}',5,'XYZ','odd','${T0}')`);
      db.exec('BEGIN');
      assert.throws(() => db.exec(sql), /whole number of cents/);
      db.exec('ROLLBACK');
      break;
    }
    db.exec(sql);
  }
  db.close();
});

test('db/schema.ts describes exactly the migrated columns', async () => {
  const source = (await readFile(path.join(root, 'db/schema.ts'), 'utf8')).replace('from "drizzle-orm/sqlite-core"', `from "${import.meta.resolve('drizzle-orm/sqlite-core')}"`).replace('from "drizzle-orm"', `from "${import.meta.resolve('drizzle-orm')}"`);
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const schema = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  const { getTableConfig } = await import('drizzle-orm/sqlite-core');
  const db = fresh();
  const declared = Object.values(schema).map(getTableConfig);
  const real = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name).sort();
  assert.deepEqual(declared.map((t) => t.name).sort(), real);
  for (const table of declared) {
    const actual = columns(db, table.name).map((c) => ({ name: c.name, notNull: !!c.notnull, pk: c.pk > 0, type: c.type }));
    const described = table.columns.map((c) => ({ name: c.name, notNull: c.notNull, pk: table.primaryKeys.length ? table.primaryKeys.some((k) => k.columns.some((kc) => kc.name === c.name)) : c.primary, type: c.getSQLType().toUpperCase() }));
    const norm = (list) => list.map((c) => `${c.name}|${c.notNull || c.pk ? 'nn' : 'null'}|${c.pk ? 'pk' : ''}|${c.type}`).sort();
    assert.deepEqual(norm(described), norm(actual), `columns of ${table.name}`);
  }
  db.close();
});

test('requests never create or alter tables: no DDL or schema pragmas exist in application code', async () => {
  const files = [];
  const walk = async (dir) => { for (const entry of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, entry.name); if (entry.isDirectory()) { if (!['node_modules', '.next', '.vinext', 'dist'].includes(entry.name)) await walk(p); } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) files.push(p); } };
  for (const dir of ['app', 'worker', 'db']) await walk(path.join(root, dir));
  assert.ok(files.length > 8);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP)\s+(UNIQUE\s+)?(TABLE|INDEX|TRIGGER|VIEW)\b/i, `${path.relative(root, file)} runs DDL`);
    assert.doesNotMatch(text, /PRAGMA\s+(table_info|foreign_keys|defer_foreign_keys|writable_schema|user_version)/i, `${path.relative(root, file)} touches schema pragmas`);
    assert.doesNotMatch(text, /ensureSchema|sqlite_master/, `${path.relative(root, file)} inspects or builds schema`);
  }
});

test('migrations are the only schema source: deploy and tooling do not generate or alter schema', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['db:generate'], undefined, 'drizzle-kit generate would diverge from the hand-written migrations');
  assert.match(pkg.scripts['db:migrate'], /migrations apply catnr-db --remote/);
  assert.match(pkg.scripts['db:migrate:local'], /migrations apply catnr-db --local/);
  assert.doesNotMatch(pkg.scripts.deploy, /migrations/, 'schema changes are a deliberate step, not part of serving requests');
  const journal = JSON.parse(await readFile(path.join(root, 'drizzle/meta/_journal.json'), 'utf8'));
  assert.deepEqual(journal.entries.map((e) => `${e.tag}.sql`), migrationNames, 'every migration file is in the journal, in order');
});
