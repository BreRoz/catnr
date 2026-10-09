import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadTs } from './helpers/load-ts.mjs';

const rc = await loadTs('app/share/roll-call.ts');
const { buildRollCall, pickGrid, resolveRange, dateLabel, vetLine } = rc;

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (const ch of text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) {
    if (q) { if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const load = async (f) => parseCsv(await readFile(new URL(`./fixtures/roll-call/${f}.csv`, import.meta.url), 'utf8'));
const sample = { cats: await load('cats'), events: await load('events') };
const WEEK = { start: '2026-10-03', end: '2026-10-09' };

// ---- synthetic data for the count tests --------------------------------------------------------
const makeCats = (n, status = 'captured') => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: `Cat ${i}`, current_status: status, archived_at: '' }));
const seen = (cats, day = '2026-10-05') => cats.map((c, i) => ({ id: `e${i}`, cat_id: c.id, event_type: 'first_seen', occurred_at: day, created_at: `${day}T0${i % 10}:00:00Z`, superseded_at: '', voided_at: '' }));
const roll = (n) => { const cats = makeCats(n); return buildRollCall({ cats, events: seen(cats) }, WEEK); };

test('pickGrid follows the README table', () => {
  const t = (n) => { const g = pickGrid(n); return g && [g.cols, g.rows, g.shown, g.more, g.variant]; };
  assert.equal(pickGrid(0), null);
  assert.deepEqual(t(1), [2, 1, 1, 0, '2a']);
  assert.deepEqual(t(2), [2, 1, 2, 0, '2a']);
  assert.deepEqual(t(3), [2, 2, 3, 0, '2b']);
  assert.deepEqual(t(4), [2, 2, 4, 0, '2b']);
  assert.deepEqual(t(5), [3, 2, 5, 0, '2c']);
  assert.deepEqual(t(6), [3, 2, 6, 0, '2c']);
  assert.deepEqual(t(8), [4, 2, 8, 0, '2d']);
  assert.deepEqual(t(10), [5, 2, 10, 0, '1c']);
  assert.deepEqual(t(12), [5, 3, 12, 0, '5x3']);
  assert.deepEqual(t(15), [5, 3, 15, 0, '5x3']);
  assert.deepEqual(t(16), [5, 3, 14, 2, '5x3']);
  assert.deepEqual(t(20), [5, 3, 14, 6, '5x3']);
});

test('each cat count picks the right grid from buildRollCall output', () => {
  for (const [n, cells] of [[1, 2], [2, 2], [3, 4], [5, 6], [8, 8], [10, 10], [12, 15], [20, 15]]) {
    const r = roll(n), g = pickGrid(r.cats.length);
    assert.equal(r.cats.length, n);
    assert.equal(g.cells, cells, `${n} cats`);
    assert.ok(g.shown + (g.more ? 1 : 0) <= g.cells);
  }
  assert.deepEqual(roll(0).cats, []);
  assert.equal(pickGrid(roll(0).cats.length), null);
});

test('sample data, last week: cats, stats and vet count follow the data rules', () => {
  const r = buildRollCall(sample, { start: '2026-10-01', end: '2026-10-09' });
  const kinds = sample.events.filter((e) => !e.superseded_at && !e.voided_at && e.occurred_at >= '2026-10-01');
  const ids = new Set(kinds.filter((e) => e.cat_id).map((e) => e.cat_id));
  assert.equal(r.cats.length, ids.size);
  assert.equal(r.dateLabel, 'Oct 1–9, 2026');
  assert.deepEqual(r.headline, ['Meet the cats', "we're helping this month."]); // 9 days is longer than a week
  assert.deepEqual(buildRollCall(sample, { start: '2026-10-03', end: '2026-10-09' }).headline, ['Meet the cats', "we're helping this week."]);
  const stat = (l) => r.stats.find((s) => s.label === l)?.value ?? 0;
  assert.equal(stat('spayed/neutered'), kinds.filter((e) => /^(spay|neuter)$/.test(e.event_type)).length);
  assert.equal(stat('vet visits'), kinds.filter((e) => e.event_type === 'vet_visit').length);
  assert.equal(stat('adopted'), kinds.filter((e) => e.event_type === 'adoption').length);
  assert.equal(stat('cats trapped'), new Set(kinds.filter((e) => e.event_type === 'captured').map((e) => e.cat_id)).size);
  assert.ok(r.stats.every((s) => s.value > 0));
  const needVet = sample.cats.filter((c) => ids.has(c.id) && ['captured', 'awaiting vet'].includes(c.current_status)).length;
  assert.equal(r.needVet, needVet);
});

test('tiles are ordered Adopted → Up for adoption → Awaiting vet → Trapped, and labels follow the rules', () => {
  const r = buildRollCall(sample, { start: '2026-10-01', end: '2026-10-09' });
  const order = ['Adopted', 'Up for adoption', 'Spayed/neutered', 'Awaiting vet', 'Trapped'];
  const ranks = r.cats.map((c) => order.indexOf(c.status));
  assert.ok(ranks.every((x) => x >= 0));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.ok(r.cats.some((c) => c.label === 'Pepper'));
  assert.ok(r.cats.every((c) => c.label && c.label !== 'Unnamed cat'));
  assert.ok(r.cats.some((c) => c.label === 'Black Tuxedo, 3-leg') || r.cats.some((c) => /^Black Tuxedo/.test(c.label)));
});

test('archived, superseded and voided rows are excluded', () => {
  const cats = [...makeCats(3), { id: 'gone', name: 'Gone', current_status: 'captured', archived_at: '2026-10-06' }];
  const ev = (id, cat, type, extra = {}) => ({ id, cat_id: cat, event_type: type, occurred_at: '2026-10-05', superseded_at: '', voided_at: '', ...extra });
  const events = [
    ev('1', 'c0', 'captured'), ev('2', 'c1', 'spay', { voided_at: '2026-10-06' }), ev('3', 'c1', 'adoption', { superseded_at: '2026-10-06' }),
    ev('4', 'gone', 'captured'), ev('5', 'c2', 'vet_visit', { occurred_at: '2026-10-02' }),
  ];
  const r = buildRollCall({ cats, events }, WEEK);
  assert.deepEqual(r.cats.map((c) => c.label), ['Cat 0']);
  assert.deepEqual(r.stats, [{ value: 1, label: 'cats trapped' }]);
  assert.equal(r.needVet, 1);
});

test('zero stats are hidden; the vet line singular/plural/none', () => {
  assert.equal(vetLine(0), null);
  assert.equal(vetLine(1), '1 still needs a vet.');
  assert.equal(vetLine(5), '5 still need a vet.');
  const cats = makeCats(2, 'adopted');
  const r = buildRollCall({ cats, events: seen(cats) }, WEEK);
  assert.deepEqual(r.stats, []);
  assert.equal(r.needVet, 0);
});

test('labels: name, then appearance clause in title case, then Unnamed cat; look-alikes get a trait', () => {
  const cats = [
    { id: 'a', name: '', appearance: 'black tuxedo with white socks; black, chubby', distinguishing_characteristics: 'missing one leg (three-legged)', current_status: 'adopted' },
    { id: 'b', name: '', appearance: 'black tuxedo', distinguishing_characteristics: '', current_status: 'adopted' },
    { id: 'c', name: '', appearance: '', current_status: 'adopted' },
    { id: 'd', name: 'Pepper', appearance: 'grey', current_status: 'adopted' },
  ];
  const r = buildRollCall({ cats, events: seen(cats) }, WEEK);
  const labels = r.cats.map((c) => c.label).sort();
  assert.deepEqual(labels, ['Black Tuxedo', 'Black Tuxedo, 3-leg', 'Pepper', 'Unnamed cat']);
});

test('same-status cats are ordered by most recent event; photos pick the latest live one', () => {
  const cats = makeCats(2, 'captured');
  const events = [...seen([cats[0]], '2026-10-04'), ...seen([cats[1]], '2026-10-08')].map((e, i) => ({ ...e, id: `x${i}` }));
  const photos = [{ id: 'old', cat_id: 'c1', taken_at: '2026-10-01' }, { id: 'new', cat_id: 'c1', taken_at: '2026-10-07' }, { id: 'arch', cat_id: 'c1', taken_at: '2026-10-09', archived_at: 'x' }];
  const r = buildRollCall({ cats, events, photos }, WEEK);
  assert.deepEqual(r.cats.map((c) => c.label), ['Cat 1', 'Cat 0']);
  assert.equal(r.cats[0].photoUrl, '/api/manage/photos?image=new');
  assert.equal(r.cats[1].photoUrl, null);
});

test('date labels and time frames', () => {
  assert.equal(dateLabel({ start: '2026-10-01', end: '2026-10-09' }), 'Oct 1–9, 2026');
  assert.equal(dateLabel({ start: '2026-09-28', end: '2026-10-04' }), 'Sep 28 – Oct 4, 2026');
  assert.deepEqual(resolveRange('7d', '2026-10-09'), { start: '2026-10-03', end: '2026-10-09' });
  assert.deepEqual(resolveRange('30d', '2026-10-09'), { start: '2026-09-10', end: '2026-10-09' });
  assert.deepEqual(resolveRange('month', '2026-10-09'), { start: '2026-10-01', end: '2026-10-09' });
  assert.deepEqual(resolveRange('custom', '2026-10-09', { start: '2026-09-01', end: '2026-09-30' }), { start: '2026-09-01', end: '2026-09-30' });
  assert.throws(() => resolveRange('custom', '2026-10-09', { start: '2026-10-05', end: '2026-10-01' }));
  assert.throws(() => resolveRange('custom', '2026-10-09', { start: '', end: '' }));
});

// ---- the data endpoint -------------------------------------------------------------------------
const { setup } = await import('./helpers/records.mjs');

test('roll-call endpoint returns only the signed-in owner’s live rows in range, and needs a range', async () => {
  const api = setup(), { db } = api, D = '2026-10-01T00:00:00.000Z';
  const cat = (id, owner, archived = null) => db.prepare('INSERT INTO cats(id,owner_id,name,current_status,archived_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, owner, id, 'captured', archived, D, D);
  const ev = (id, catId, owner, day, voided = null) => db.prepare('INSERT INTO events(id,owner_id,cat_id,event_type,occurred_at,voided_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id, owner, catId, 'captured', day, voided, D);
  cat('mine', 'A'); cat('theirs', 'B'); cat('old', 'A'); cat('arch', 'A', D);
  ev('e1', 'mine', 'A', '2026-10-05'); ev('e2', 'theirs', 'B', '2026-10-05'); ev('e3', 'old', 'A', '2026-09-01'); ev('e4', 'arch', 'A', '2026-10-05'); ev('e5', 'mine', 'A', '2026-10-06', D);
  db.prepare("INSERT INTO photos(id,owner_id,cat_id,storage_location,taken_at,created_at) VALUES('p1','A','mine','data:image/jpeg;base64,/9j/2Q==','2026-10-05',?)").run(D);
  const res = await api.get('roll-call', 'from=2026-10-03&to=2026-10-09');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.events.map((e) => e.id), ['e4', 'e1']);
  assert.deepEqual(res.body.cats.map((c) => c.id), ['mine']);
  assert.deepEqual(res.body.photos.map((p) => p.id), ['p1']);
  assert.ok(!JSON.stringify(res.body).includes('data:image'), 'no image data in the listing');
  const r = buildRollCall(res.body, { start: '2026-10-03', end: '2026-10-09' });
  assert.deepEqual(r.cats.map((c) => c.label), ['mine']);
  assert.equal((await api.get('roll-call', 'from=2026-10-03&to=2026-10-09', 'B')).body.cats[0].id, 'theirs');
  assert.equal((await api.get('roll-call', '')).status, 400);
  assert.equal((await api.get('roll-call', 'from=2026-10-09&to=2026-10-03')).status, 400);
});
