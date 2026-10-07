import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, reportQueries, reportDefinitions } from './helpers/records.mjs';

// One fixture rescue whose every number is worked out by hand in the comments below.
const D = '2026-01-01T00:00:00.000Z';
let n = 0;
const cat = (db, id, o = {}, owner = 'A') => db.prepare('INSERT INTO cats(id,owner_id,name,origin_colony_id,current_status,archived_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
  .run(id, owner, id, o.colony ?? null, o.status ?? 'observed', o.archived ?? null, D, D);
const event = (db, catId, type, day, o = {}, owner = 'A') => { const id = o.id ?? `e${++n}`;
  db.prepare('INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,voided_at,superseded_at,superseded_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, owner, catId, type, `${day}T12:00:00.000Z`, o.voided ?? null, o.supersededBy ? D : null, o.supersededBy ?? null, D); return id; };
const tx = (db, type, direction, day, amountMinor, o = {}, owner = 'A') => db.prepare('INSERT INTO transactions(id,owner_id,transaction_type,direction,date,amount_minor,currency,description,item,quantity,unit,estimated_value_minor,voided_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  .run(`t${++n}`, owner, type, direction, day, amountMinor, o.currency ?? 'USD', o.description ?? type, o.item ?? null, o.quantity ?? null, o.unit ?? null, o.estimated ?? null, o.voided ?? null, D);

function fixture() {
  const api = setup(), { db } = api;
  for (const [id, name] of [['col1', 'Jefferson'], ['col2', 'Elm'], ['col3', 'Quiet lane']]) db.prepare('INSERT INTO colonies(id,owner_id,name,created_at) VALUES(?,?,?,?)').run(id, 'A', name, D);
  // confirmed surgery by the rescue (type recorded exactly), and one recorded the way the assistant may: odd case + ":detail"
  cat(db, 'spay', { colony: 'col1' }); event(db, 'spay', 'spay', '2026-03-01'); event(db, 'spay', 'vet_visit', '2026-03-01');
  cat(db, 'neuter', { colony: 'col1' }); event(db, 'neuter', 'captured', '2026-03-30'); event(db, 'neuter', 'Neuter: mild swelling', '2026-04-02'); event(db, 'neuter', 'vaccination', '2026-04-02');
  // unknown surgery history: seen at the vet, nothing said about surgery. Its only "spay" was reversed, so it must not count.
  cat(db, 'unknown', { colony: 'col2' }); event(db, 'unknown', 'vet_visit', '2026-05-01'); event(db, 'unknown', 'spay', '2026-05-01', { voided: D });
  // confirmed need: only a sighting and a "still needs surgery" finding
  cat(db, 'need', { colony: 'col2' }); event(db, 'need', 'first_seen', '2026-05-02'); event(db, 'need', 'surgery_needed', '2026-05-02');
  // already fixed when found (ear-tipped), now in foster
  cat(db, 'prior', { colony: 'col1', status: 'foster' }); event(db, 'prior', 'previously_sterilized', '2026-05-03'); event(db, 'prior', 'foster', '2026-05-04');
  // missing data: no events, no colony
  cat(db, 'missing');
  // last year's work, adopted
  cat(db, 'old', { colony: 'col1', status: 'adopted' }); event(db, 'old', 'spay', '2025-12-31'); event(db, 'old', 'adoption', '2025-12-31');
  cat(db, 'adopted', { colony: 'col2', status: 'adopted' }); event(db, 'adopted', 'adoption', '2026-06-01');
  cat(db, 'returned', { status: 'returned to colony' }); event(db, 'returned', 'returned_to_colony', '2026-06-02');
  cat(db, 'avail', { status: 'available for adoption' });
  cat(db, 'archived', { status: 'foster', archived: D });
  // a correction: the superseded original is replaced and must count once
  const original = event(db, 'avail', 'vaccination', '2026-06-03'), replacement = event(db, 'avail', 'transport', '2026-06-03');
  db.prepare("INSERT INTO corrections(id,owner_id,kind,record_type,original_id,replacement_id,made_by,actor_id,original_snapshot,created_at) VALUES('cor1','A','correction','event',?,?,'user','A','{}',?)").run(original, replacement, D);
  db.prepare("UPDATE events SET superseded_at=?,superseded_by='cor1' WHERE id=?").run(D, original);
  // another rescue's data never leaks in
  cat(db, 'theirs', {}, 'B'); event(db, 'theirs', 'spay', '2026-03-01', {}, 'B'); tx(db, 'cash_donation', 'inflow', '2026-03-01', 999999, {}, 'B');

  tx(db, 'cash_donation', 'inflow', '2026-02-01', 10000);                       // $100.00 Sarah
  tx(db, 'cash_inflow', 'inflow', '2026-02-02', 12950);                         // $129.50 collection
  tx(db, 'merchandise_income', 'inflow', '2026-02-03', 30000);                  // $300.00 stickers
  tx(db, 'merchandise_income', 'inflow', '2026-02-04', 1999, { currency: 'CAD' }); // CA$19.99
  tx(db, 'supply_purchase', 'outflow', '2026-02-05', 4500);                     // $45.00
  tx(db, 'operating_expense', 'outflow', '2026-02-06', 333);                    // $3.33 (cents kept)
  tx(db, 'operating_expense', 'outflow', '2026-02-07', 550, { currency: 'CAD' });  // CA$5.50
  tx(db, 'cash_donation', 'inflow', '2026-02-08', 99999, { voided: D });         // reversed: not counted
  tx(db, 'cash_donation', 'inflow', '2025-12-31', 5000);                        // last year
  tx(db, 'cash_donation', 'inflow', '2026-02-09', null);                        // amount never recorded
  tx(db, 'in_kind_donation', 'inflow', '2026-02-10', null, { item: 'Friskies 12 lb bag', quantity: 2, unit: 'bag', estimated: 2400 });
  tx(db, 'in_kind_donation', 'inflow', '2026-02-11', null, { item: 'Blankets', quantity: 5, unit: 'each' }); // no value given
  tx(db, 'cash_donation', 'inflow', '2026-02-12', 10); tx(db, 'cash_donation', 'inflow', '2026-02-12', 20); // 0.10 + 0.20 must be exactly 0.30
  return api;
}
const total = (list, currency) => list.find((t) => t.currency === currency)?.minor ?? 0;
const report = (api, period) => reportQueries.buildReport(api.d1, 'A', period);
const YEAR = { from: '2026-01-01', to: '2026-12-31' };

test('cat metrics: confirmed events count, sightings, unknowns and reversed entries do not', async () => {
  const r = await report(fixture(), YEAR);
  // assisted: spay, neuter, unknown (vet visit), prior (foster), adopted, returned, avail (transport). Not need/missing/old/archived-with-no-events.
  assert.equal(r.cats.assisted, 7);
  assert.equal(r.cats.captured, 1);
  assert.equal(r.cats.sterilized, 2, 'only spay/neuter events in the period; "Neuter: detail" is understood; previously_sterilized and a voided spay are not procedures');
  assert.equal(r.cats.vaccinated, 1, 'the superseded vaccination is replaced, not double counted; a spay never implies a vaccination');
  assert.equal(r.cats.adopted, 1, 'last year\'s adoption is outside the period');
  assert.equal(r.cats.returnedToColony, 1);
  assert.equal(r.coloniesServed, 2, 'Jefferson and Elm; the quiet colony had no assisted cat');
  assert.equal(r.veterinary.procedures, 3);
  assert.deepEqual({ ...r.veterinary.byProcedure }, { spay: 1, neuter: 1, vaccination: 1, testing: 0, medication: 0 });
  assert.equal(r.veterinary.vetVisits, 2, 'a vet visit is not a procedure');
});

test('all-time and different periods give different, reproducible answers', async () => {
  const api = fixture();
  const all = await report(api);
  assert.equal(all.cats.sterilized, 3, 'adds last year\'s spay');
  assert.equal(all.cats.adopted, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(await report(api))), JSON.parse(JSON.stringify(all)), 'the same database gives the same report');
  const december = await report(api, { from: '2025-12-01', to: '2025-12-31' });
  assert.equal(december.cats.assisted, 1);
  assert.equal(december.cats.sterilized, 1);
  assert.equal((await report(api, { from: '2026-04-02', to: '2026-04-02' })).cats.sterilized, 1, 'the end date is inclusive');
});

test('snapshot metrics describe now, ignore the period and skip archived cats', async () => {
  const api = fixture();
  for (const period of [YEAR, { from: '2020-01-01', to: '2020-12-31' }]) {
    const r = await report(api, period);
    assert.equal(r.current.inFoster, 1, 'prior; the archived foster cat is not counted');
    assert.equal(r.current.availableForAdoption, 1);
  }
});

test('unknown surgery history is not "needs surgery"', async () => {
  const s = (await report(fixture(), YEAR)).surgery;
  // in care: spay, neuter, unknown, need, prior, missing, avail (not old/adopted/returned/archived)
  assert.equal(s.inCare, 7);
  assert.equal(s.sterilized, 3, 'spay, neuter, and the cat found already fixed');
  assert.deepEqual(s.needsSurgeryCatIds, ['need'], 'only the cat with a confirmed finding');
  assert.equal(s.needsSurgery, 1);
  assert.equal(s.unknown, 3, 'the vet-visit cat, the cat with no data and the available cat');
  assert.deepEqual([...s.unknownCatIds].sort(), ['avail', 'missing', 'unknown']);
  assert.equal(s.sterilized + s.needsSurgery + s.unknown, s.inCare, 'every cat is in exactly one group');
});

test('a later surgery makes a confirmed need go away; the report never infers either way', async () => {
  const api = fixture();
  assert.equal((await reportQueries.surgeryStatus(api.d1, 'A')).needsSurgery, 1);
  event(api.db, 'need', 'neuter', '2026-07-01');
  const s = await reportQueries.surgeryStatus(api.d1, 'A');
  assert.equal(s.needsSurgery, 0);
  assert.equal(s.sterilized, 4);
  // A cat with no events and no status change stays unknown: "not on file" is not evidence either way.
  assert.ok(s.unknownCatIds.includes('missing'));
});

test('cash: income and expenses are separate, exact to the cent and never mixed across currencies', async () => {
  const m = (await report(fixture(), YEAR)).money;
  assert.equal(total(m.cashIn, 'USD'), 10000 + 12950 + 30000 + 10 + 20);
  assert.equal(total(m.cashOut, 'USD'), 4500 + 333);
  assert.equal(total(m.net, 'USD'), 52980 - 4833);
  assert.equal(total(m.cashIn, 'CAD'), 1999);
  assert.equal(total(m.cashOut, 'CAD'), 550);
  assert.equal(total(m.net, 'CAD'), 1449);
  assert.deepEqual(m.cashIn.map((t) => t.currency), ['CAD', 'USD']);
  assert.equal(m.cashInText, 'CA$19.99 + $529.80');
  assert.equal(m.cashOutText, 'CA$5.50 + $48.33');
  assert.equal(m.netText, 'CA$14.49 + $481.47');
  assert.ok(m.cashIn.every((t) => Number.isInteger(t.minor)));
  assert.equal(total(m.cashIn, 'USD') / 100, 529.8);
});

test('merchandise income, donations and other money in are broken out by type', async () => {
  const m = (await report(fixture(), YEAR)).money;
  const row = (type, currency = 'USD') => m.cashInByType.find((r) => r.type === type && r.currency === currency);
  assert.equal(row('merchandise_income').minor, 30000);
  assert.equal(row('merchandise_income', 'CAD').minor, 1999);
  assert.equal(row('cash_donation').minor, 10030);
  assert.equal(row('cash_donation').count, 3);
  assert.equal(row('cash_inflow').minor, 12950);
  assert.equal(m.cashOutByType.find((r) => r.type === 'supply_purchase').minor, 4500);
});

test('in-kind donations are never cash and their estimated value stays apart', async () => {
  const k = (await report(fixture(), YEAR)).money.inKind;
  assert.equal(k.count, 2);
  assert.equal(k.withoutEstimate, 1);
  assert.equal(total(k.estimatedValue, 'USD'), 2400);
  assert.equal(k.estimatedValueText, '$24.00');
  assert.deepEqual(k.quantities.map((q) => [q.item, q.quantity, q.unit]), [['Blankets', 5, 'each'], ['Friskies 12 lb bag', 2, 'bag']]);
  const cashIn = (await report(fixture(), YEAR)).money.cashIn;
  assert.equal(total(cashIn, 'USD'), 52980, 'the $24 estimate is not income');
});

test('missing data is reported, not guessed: a money entry without an amount adds nothing and is flagged', async () => {
  const r = await report(fixture(), YEAR);
  assert.equal(r.dataQuality.moneyWithoutAmount, 1);
  assert.equal(total(r.money.cashIn, 'USD'), 52980);
});

test('an empty rescue reports zeros, not errors', async () => {
  const api = setup();
  const r = await reportQueries.buildReport(api.d1, 'nobody', YEAR);
  assert.equal(r.cats.assisted, 0);
  assert.equal(r.surgery.inCare, 0);
  assert.deepEqual(r.money.cashIn, []);
  assert.equal(r.money.cashInText, '$0.00');
  assert.equal(r.money.inKind.estimatedValueText, null);
});

test('reports are scoped to the signed-in rescue', async () => {
  const api = fixture();
  const mine = await api.get('reports', 'year=2026', 'A');
  const theirs = await api.get('reports', 'year=2026', 'B');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.cats.sterilized, 2);
  assert.equal(theirs.body.cats.sterilized, 1);
  assert.equal(total(theirs.body.money.cashIn, 'USD'), 999999);
  assert.equal(mine.headers.get('cache-control'), 'no-store');
  const empty = await api.get('reports', 'year=2026', 'C');
  assert.equal(empty.body.cats.assisted, 0);
});

test('the report API validates its period', async () => {
  const api = fixture();
  for (const q of ['year=26', 'from=2026-02-30', 'from=2026-05-01&to=2026-04-01', 'year=2026&from=2026-01-01', 'to=tomorrow']) {
    const r = await api.get('reports', q);
    assert.equal(r.status, 400, q);
  }
  assert.equal((await api.get('reports', 'from=2026-04-01&to=2026-04-30')).body.cats.sterilized, 1);
  assert.equal((await api.get('reports', '')).body.cats.sterilized, 3);
});

test('reports only read: nothing in the database changes', async () => {
  const api = fixture();
  const before = ['cats', 'events', 'transactions', 'rescue_revisions'].map((t) => JSON.stringify(api.db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));
  await report(api, YEAR); await api.get('reports', 'year=2026');
  assert.deepEqual(['cats', 'events', 'transactions', 'rescue_revisions'].map((t) => JSON.stringify(api.db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all())), before);
});

test('every metric has a written definition and the plain-language answers use the same numbers', async () => {
  const r = await report(fixture(), YEAR);
  const keys = r.definitions.map((d) => d.key);
  for (const key of ['catsAssisted', 'catsCaptured', 'catsSterilized', 'catsVaccinated', 'catsAdopted', 'catsReturned', 'inFoster', 'availableForAdoption', 'coloniesServed', 'veterinaryProcedures', 'cashIn', 'cashOut', 'inKind', 'surgeryStatus']) assert.ok(keys.includes(key), key);
  assert.ok(r.definitions.every((d) => d.counts.length > 20 && d.excludes.length > 10));
  const text = reportQueries.reportSentences(r, '2026');
  assert.match(text.impact, /7 cats assisted, 1 captured, 2 sterilized, 1 vaccinated, 1 adopted, 1 returned to colony, 2 colonies served, 3 veterinary procedures/);
  assert.match(text.money, /Cash in CA\$19\.99 \+ \$529\.80, cash out CA\$5\.50 \+ \$48\.33/);
  assert.match(text.money, /estimated \$24\.00 \(not counted as income\)/);
  assert.equal(reportDefinitions.yearPeriod(2026).to, '2026-12-31');
});
