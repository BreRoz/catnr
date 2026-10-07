import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, JPEG, findCatPairs, findPersonPairs, findColonyPairs, editDistance, analyze } from './helpers/records.mjs';

const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const cat = (id, o = {}) => ({ id, name: null, sex: 'unknown', age_class: 'unknown', appearance: null, distinguishing_characteristics: null, origin_colony_id: null, microchip_number: null, ...o });

test('duplicate detection: cats', () => {
  const pairs = findCatPairs([
    cat('a', { name: 'Milo' }), cat('b', { name: 'milo ' }), cat('c', { name: 'Pepper' }),
    cat('d', { appearance: 'gray tabby with white paws', origin_colony_id: 'j', sex: 'female' }), cat('e', { appearance: 'Gray tabby, white paws', origin_colony_id: 'j' }),
    cat('f', { appearance: 'gray tabby with white paws', origin_colony_id: 'j', sex: 'male' }),
    cat('g', { name: 'Ziggy', appearance: 'gray tabby with white paws', origin_colony_id: 'j' }), cat('g2', { name: 'Rex2', appearance: 'gray tabby with white paws', origin_colony_id: 'j' }),
    cat('h', { name: 'Rex', microchip_number: '111' }), cat('i', { name: 'Rex', microchip_number: '222' }),
    cat('k', { name: 'Tom', sex: 'male' }), cat('l', { name: 'Tom', sex: 'female' }),
  ]);
  const has = (x, y) => pairs.find((p) => (p.aId === x && p.bId === y) || (p.aId === y && p.bId === x));
  assert.ok(has('a', 'b'), 'same name ignoring case/space');
  assert.ok(!has('a', 'c'));
  assert.ok(has('d', 'e'), 'same description in the same colony');
  assert.ok(!has('d', 'f'), 'a female and a male are not duplicates');
  assert.ok(has('e', 'f'));
  assert.ok(has('d', 'g'), 'a nameless cat may be a named cat that was recorded earlier');
  assert.ok(!has('g', 'g2'), 'two different names mean different cats, whatever they look like');
  assert.ok(!has('h', 'i'), 'different microchips are never duplicates');
  assert.ok(!has('k', 'l'), 'same name but different sex is never suggested');
  assert.ok(has('a', 'b').score >= 0.9);
  assert.ok(has('d', 'e').reasons.some((r) => /same colony/i.test(r)));
});

test('duplicate detection: people and colonies', () => {
  const people = findPersonPairs([
    { id: 'p1', name: 'Sarah Yunker', contact: null }, { id: 'p2', name: 'Yunker, Sarah', contact: null }, { id: 'p3', name: 'Sara Yunker', contact: null },
    { id: 'p4', name: 'Bob Smith', contact: 'bob@x.com' }, { id: 'p5', name: 'Robert S.', contact: 'Bob@X.com' }, { id: 'p6', name: 'Ann Lee', contact: '(555) 123-4567' }, { id: 'p7', name: 'A. Lee', contact: '+1 555 123 4567' },
    { id: 'p8', name: 'Dr. Patel', contact: null }, { id: 'p9', name: 'Marcus', contact: null },
  ]);
  const has = (list, x, y) => list.find((p) => (p.aId === x && p.bId === y) || (p.aId === y && p.bId === x));
  assert.ok(has(people, 'p1', 'p2'), 'name order'); assert.ok(has(people, 'p1', 'p3'), 'one letter off');
  assert.ok(has(people, 'p4', 'p5'), 'same email'); assert.ok(has(people, 'p6', 'p7'), 'same phone');
  assert.ok(!has(people, 'p8', 'p9'));
  const colonies = findColonyPairs([
    { id: 'c1', name: 'Jefferson Colony', general_location: null }, { id: 'c2', name: 'The Jefferson', general_location: null }, { id: 'c3', name: 'Jeferson', general_location: null },
    { id: 'c4', name: 'Elm', general_location: '12 Elm Street behind the school' }, { id: 'c5', name: 'School lot', general_location: '12 elm street, behind the school' }, { id: 'c6', name: 'Harrington', general_location: null },
  ]);
  assert.ok(has(colonies, 'c1', 'c2')); assert.ok(has(colonies, 'c1', 'c3')); assert.ok(has(colonies, 'c4', 'c5')); assert.ok(!has(colonies, 'c1', 'c6'));
  assert.equal(editDistance('kitten', 'sitting', 3), 3); assert.equal(editDistance('abc', 'abcdefgh', 3), 4);
});

test('duplicate detection scales: 2,000 records are compared without all-pairs blowup', () => {
  const rows = Array.from({ length: 2000 }, (_, i) => cat(`c${i}`, { name: `Cat${i}`, appearance: `color${i} pattern${i}`, origin_colony_id: `col${i % 20}` }));
  rows.push(cat('dup', { name: 'Cat7' }));
  const started = Date.now();
  const pairs = findCatPairs(rows);
  assert.ok(Date.now() - started < 3000);
  assert.equal(pairs.length, 1);
});

async function seed(api) {
  const col = (await api.post('colonies', { name: 'Jefferson' })).body.id;
  const sarah = (await api.post('people', { name: 'Sarah', type: 'donor' })).body.id;
  const keep = (await api.post('cats', { cat: { name: 'Milo', appearance: 'gray', originColonyId: col } })).body.id;
  const dup = (await api.post('cats', { cat: { name: 'Milo ', appearance: 'grey tabby', sex: 'male', ageClass: 'adult', microchipNumber: '985000111', healthObservations: 'limp', currentLocation: 'Elm porch' } })).body.id;
  assert.ok(keep && dup && keep !== dup);
  await api.post('events', { catId: dup, eventType: 'vet_visit', occurredAt: '2026-03-01', notes: 'checkup', personId: sarah });
  await api.post('events', { catId: dup, eventType: 'neuter', occurredAt: '2026-03-02' });
  await api.post('events', { catId: keep, eventType: 'captured', occurredAt: '2026-02-01' });
  await api.post('photos', { catId: dup, photoDataUrl: JPEG, caption: 'on the porch' });
  await api.post('transactions', { transactionType: 'supply_purchase', date: '2026-03-03', amount: '30', description: 'Vet supplies', relatedCatId: dup });
  return { col, sarah, keep, dup };
}

test('cat merge preserves history, photos, money and audit; nothing is deleted', async () => {
  const api = setup();
  const { keep, dup, sarah } = await seed(api);
  const before = { cats: api.count('cats'), events: api.count('events'), photos: api.count('photos'), transactions: api.count('transactions') };
  const preview = ok(await api.get('merges', `type=cat&survivorId=${keep}&mergedId=${dup}`));
  assert.equal(preview.canMerge, true);
  assert.deepEqual(preview.willMove, { events: 2, photos: 1, transactions: 1 });
  assert.ok(preview.willFill.some((f) => f.field === 'sex' && f.value === 'male'));
  assert.ok(preview.willFill.some((f) => f.field === 'microchip_number'));
  assert.ok(preview.conflicts.some((c) => c.field === 'appearance' && c.kept === 'gray' && c.other === 'grey tabby'));
  assert.equal(api.row('cats', dup).archived_at, null, 'previewing changes nothing');

  assert.equal((await api.post('merges', { recordType: 'cat', survivorId: keep, mergedId: dup, survivorVersion: preview.survivor.version, mergedVersion: preview.duplicate.version })).status, 400, 'needs explicit confirmation');
  const merged = ok(await api.post('merges', { recordType: 'cat', survivorId: keep, mergedId: dup, confirm: true, survivorVersion: preview.survivor.version, mergedVersion: preview.duplicate.version }));
  assert.equal(merged.outcome, 'merged');
  assert.deepEqual(merged.moved, { events: 2, photos: 1, transactions: 1 });

  // Nothing was deleted; the survivor owns the history, photos and money.
  assert.equal(api.count('cats'), before.cats);
  assert.equal(api.count('photos'), before.photos);
  assert.equal(api.count('transactions'), before.transactions);
  assert.equal(api.count('events'), before.events + 1, 'one merge note was added');
  assert.equal(api.count('events', `cat_id='${dup}'`), 0);
  assert.equal(api.count('photos', `cat_id='${keep}'`), 1);
  assert.equal(api.count('transactions', `related_cat_id='${keep}'`), 1);
  const survivor = api.row('cats', keep), gone = api.row('cats', dup);
  assert.equal(survivor.sex, 'male'); assert.equal(survivor.age_class, 'adult'); assert.equal(survivor.microchip_number, '985000111'); assert.equal(survivor.current_location, 'Elm porch');
  assert.equal(survivor.appearance, 'gray', 'the survivor’s own details are never overwritten');
  assert.equal(gone.microchip_number, null); assert.ok(gone.archived_at); assert.match(gone.archive_reason, /Merged into/);
  assert.equal(api.row('events', api.db.prepare("SELECT id FROM events WHERE event_type='vet_visit'").get().id).person_id, sarah, 'relationships stay intact');
  assert.equal(api.db.prepare("SELECT notes FROM events WHERE event_type='other'").get().notes.includes('grey tabby'), true, 'differing details are recorded in the history');

  const detail = ok(await api.get('cats', `id=${keep}`));
  assert.equal(detail.events.length, 4); assert.equal(detail.cat.photoCount, 1);
  assert.equal(detail.mergedFrom.length, 1); assert.equal(detail.mergedFrom[0].catId, dup);
  assert.equal(ok(await api.get('cats')).items.length, 1, 'the duplicate disappears from the default list');
  assert.equal(ok(await api.get('cats', 'archived=archived')).items[0].mergedInto, keep);

  // Audit: merge record + one entry per side, linked together, with full snapshots.
  const m = api.db.prepare('SELECT * FROM merges').get();
  assert.equal(m.survivor_id, keep); assert.equal(m.merged_id, dup); assert.equal(m.actor_id, 'A');
  assert.equal(JSON.parse(m.summary).moved.events.length, 2); assert.equal(JSON.parse(m.summary).duplicateBefore.name, 'Milo');
  const changes = api.db.prepare('SELECT record_id,action,merge_id FROM record_changes WHERE merge_id=? ORDER BY action').all(m.id);
  assert.deepEqual(changes.map((c) => c.action), ['merge_into', 'merged_from']);

  // A merged-away record cannot be restored or merged again, and its history is immutable.
  assert.equal((await api.post('cats', { action: 'restore', id: dup })).status, 409);
  assert.equal((await api.post('merges', { recordType: 'cat', survivorId: keep, mergedId: dup, confirm: true, survivorVersion: 0, mergedVersion: 0 })).status, 409);
  assert.throws(() => api.db.exec("DELETE FROM merges"), /immutable/);
  assert.throws(() => api.db.exec("UPDATE record_changes SET reason='x'"), /immutable/);
  assert.throws(() => api.db.exec(`DELETE FROM cats WHERE id='${dup}'`), /preserved/, 'merged records cannot be deleted');
});

test('merge refuses unsafe merges and writes nothing', async () => {
  const api = setup();
  const a = ok(await api.post('cats', { cat: { name: 'Rex', sex: 'male', microchipNumber: 'AAA111' } })).id;
  const b = ok(await api.post('cats', { cat: { name: 'Rex', sex: 'male', microchipNumber: 'BBB222' } })).id;
  const c = ok(await api.post('cats', { cat: { name: 'Rexie', sex: 'female' } })).id;
  const snapshot = () => JSON.stringify(['cats', 'events', 'merges', 'record_changes'].map((t) => api.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
  const before = snapshot();
  const tryMerge = (survivorId, mergedId, extra = {}) => api.post('merges', { recordType: 'cat', survivorId, mergedId, confirm: true, survivorVersion: api.row('cats', survivorId)?.version, mergedVersion: api.row('cats', mergedId)?.version, ...extra });
  assert.equal((await tryMerge(a, b)).status, 409); assert.match((await tryMerge(a, b)).body.message, /different microchip/);
  assert.equal((await tryMerge(a, c)).status, 409); assert.match((await tryMerge(a, c)).body.message, /male and the other is female|one is male/i);
  assert.equal((await tryMerge(a, a)).status, 400);
  assert.equal((await tryMerge(a, 'missing')).status, 404);
  assert.equal((await tryMerge(a, b, { survivorVersion: 99 })).status, 409);
  assert.equal((await api.post('merges', { recordType: 'dragon', survivorId: a, mergedId: b, confirm: true })).status, 400);
  const preview = ok(await api.get('merges', `type=cat&survivorId=${a}&mergedId=${b}`));
  assert.equal(preview.canMerge, false); assert.ok(preview.blockers.length);
  assert.equal(snapshot(), before, 'refused merges changed nothing');
  ok(await api.post('cats', { action: 'archive', id: c }));
  const d = ok(await api.post('cats', { cat: { name: 'Rex' } })).id;
  assert.equal((await tryMerge(a, c)).status, 409, 'archived records cannot be merged');
  assert.equal((await tryMerge(d, c)).status, 409);
});

test('a merge that fails part-way rolls everything back', async () => {
  for (const fragment of ['UPDATE events', 'UPDATE photos', 'UPDATE transactions', 'INSERT INTO merges', 'INSERT INTO record_changes', 'INSERT INTO events']) {
    let armed = false;
    const api = setup({ fail: (q) => armed && q.startsWith(fragment) });
    const { keep, dup } = await seed(api);
    const dump = () => JSON.stringify(['cats', 'events', 'photos', 'transactions', 'merges', 'record_changes'].map((t) => api.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
    const before = dump();
    armed = true;
    const r = await api.post('merges', { recordType: 'cat', survivorId: keep, mergedId: dup, confirm: true, survivorVersion: api.row('cats', keep).version, mergedVersion: api.row('cats', dup).version });
    armed = false;
    assert.equal(r.status, 503, fragment);
    assert.equal(dump(), before, `rolled back after failure at ${fragment}`);
  }
});

test('merged retries are idempotent', async () => {
  const api = setup();
  const { keep, dup } = await seed(api);
  const body = { requestKey: 'merge-1', recordType: 'cat', survivorId: keep, mergedId: dup, confirm: true, survivorVersion: api.row('cats', keep).version, mergedVersion: api.row('cats', dup).version };
  const first = ok(await api.post('merges', body)), again = ok(await api.post('merges', body));
  assert.equal(again.replayed, true); assert.equal(again.mergeId, first.mergeId);
  assert.equal(api.count('merges'), 1); assert.equal(api.count('events', "event_type='other'"), 1);
});

test('people merge moves events and donations, keeps contact details and the old name', async () => {
  const api = setup();
  const keep = ok(await api.post('people', { name: 'Sarah Yunker', type: 'donor' })).id;
  const dup = ok(await api.post('people', { name: 'S. Yunker', contact: 'sarah@example.com', generalLocation: 'Oak Park', notes: 'prefers email' })).id;
  const cat = ok(await api.post('cats', { cat: { name: 'Milo' } })).id;
  ok(await api.post('events', { catId: cat, eventType: 'foster', occurredAt: '2026-03-01', personId: dup }));
  ok(await api.post('transactions', { transactionType: 'cash_donation', date: '2026-03-02', amount: '50', description: 'Donation', personId: dup }));
  ok(await api.post('transactions', { transactionType: 'cash_donation', date: '2026-03-03', amount: '25', description: 'Another', personId: keep }));
  ok(await api.post('transactions', { action: 'void', id: api.db.prepare("SELECT id FROM transactions WHERE description='Another'").get().id }));
  const r = ok(await api.post('merges', { recordType: 'person', survivorId: keep, mergedId: dup, confirm: true, survivorVersion: api.row('people', keep).version, mergedVersion: api.row('people', dup).version }));
  assert.deepEqual(r.moved, { events: 1, transactions: 1 });
  const p = api.row('people', keep);
  assert.equal(p.contact, 'sarah@example.com'); assert.equal(p.general_location, 'Oak Park'); assert.equal(p.type, 'donor');
  assert.match(p.notes, /Also recorded as “S. Yunker”/); assert.match(p.notes, /prefers email/);
  assert.ok(api.row('people', dup).archived_at);
  const detail = ok(await api.get('people', `id=${keep}`));
  assert.equal(detail.events.length, 1); assert.equal(detail.totals[0].text, '$50.00'); assert.equal(detail.mergedFrom[0].personId, dup);
  // The archived duplicate's name is free again, and archived people don't block new ones.
  ok(await api.post('people', { name: 'S. Yunker' }));
  assert.equal(api.count('people'), 3);
});

test('colony merge re-homes cats and money, keeps the location, and AI-facing names fold into the survivor', async () => {
  const api = setup();
  const keep = ok(await api.post('colonies', { name: 'Jefferson' })).id;
  const dup = ok(await api.post('colonies', { name: 'Jefferson Colony', generalLocation: '12 Jefferson Ave', latitude: '40.1', longitude: '-70.2', notes: 'feeds at 6' })).id;
  const cats = [];
  for (const n of ['Milo', 'Pepper']) cats.push(ok(await api.post('cats', { cat: { name: n, originColonyId: dup } })).id);
  ok(await api.post('transactions', { transactionType: 'supply_purchase', date: '2026-03-01', amount: '12', description: 'Food', relatedColonyId: dup }));
  ok(await api.post('cats', { action: 'archive', id: cats[1] }));
  const r = ok(await api.post('merges', { recordType: 'colony', survivorId: keep, mergedId: dup, confirm: true, survivorVersion: api.row('colonies', keep).version, mergedVersion: api.row('colonies', dup).version }));
  assert.deepEqual(r.moved, { cats: 2, transactions: 1 }, 'archived cats are re-homed too');
  for (const id of cats) assert.equal(api.row('cats', id).origin_colony_id, keep);
  const c = api.row('colonies', keep);
  assert.equal(c.general_location, '12 Jefferson Ave'); assert.equal(c.latitude, 40.1); assert.match(c.notes, /Merged from “Jefferson Colony”/);
  assert.equal(api.count('transactions', `related_colony_id='${keep}'`), 1);
  assert.ok(api.row('colonies', dup).archived_at);
  assert.equal(ok(await api.get('colonies')).items.length, 1);
  assert.equal(ok(await api.get('colonies', `id=${keep}`)).cats.length, 1, 'the colony page lists active cats');
});

test('analysis is pure and symmetric about blanks', () => {
  const a = analyze('person', { name: 'A', type: null, contact: null, notes: null }, { name: 'A', type: 'donor', contact: 'x', notes: null });
  assert.deepEqual(a.fills, { type: 'donor', contact: 'x' }); assert.deepEqual(a.conflicts, []); assert.deepEqual(a.appended, {});
  const b = analyze('cat', cat('s', { name: 'Rex', current_status: 'foster' }), cat('d', { name: 'Max', current_status: 'adopted' }));
  assert.deepEqual(b.conflicts.map((c) => c.field).sort(), ['name', 'status']);
  assert.deepEqual(b.fills, {});
});

test('dismissing a suggestion hides it for good but never blocks a manual merge', async () => {
  const api = setup();
  const a = ok(await api.post('cats', { cat: { name: 'Milo' } })).id, b = ok(await api.post('cats', { cat: { name: 'milo' } })).id;
  const found = ok(await api.get('duplicates', 'type=cat'));
  assert.equal(found.pairs.length, 1);
  const pair = found.pairs[0];
  assert.deepEqual(pair.a.details.length >= 0, true);
  assert.ok([a, b].includes(pair.suggestedSurvivorId));
  assert.equal((await api.post('duplicates', { action: 'dismiss', recordType: 'cat', aId: a, bId: a })).status, 400);
  assert.equal((await api.post('duplicates', { action: 'dismiss', recordType: 'cat', aId: a, bId: 'nope' })).status, 404);
  ok(await api.post('duplicates', { action: 'dismiss', recordType: 'cat', aId: b, bId: a }));
  ok(await api.post('duplicates', { action: 'dismiss', recordType: 'cat', aId: a, bId: b }));
  assert.equal(ok(await api.get('duplicates', 'type=cat')).pairs.length, 0);
  assert.equal(api.count('cats'), 2, 'dismissing touches no records');
  assert.equal(ok(await api.post('merges', { recordType: 'cat', survivorId: a, mergedId: b, confirm: true, survivorVersion: api.row('cats', a).version, mergedVersion: api.row('cats', b).version })).outcome, 'merged');
  assert.equal((await api.get('duplicates', 'type=dragon')).status, 400);
  assert.equal(ok(await api.get('duplicates', 'type=cat', 'B')).pairs.length, 0);
});

test('suggestions prefer to keep the record with more history', async () => {
  const api = setup();
  const poor = ok(await api.post('cats', { cat: { name: 'Milo' } })).id, rich = ok(await api.post('cats', { cat: { name: 'Milo ' } })).id;
  ok(await api.post('events', { catId: rich, eventType: 'vet_visit', occurredAt: '2026-03-01' }));
  ok(await api.post('photos', { catId: rich, photoDataUrl: JPEG }));
  assert.equal(ok(await api.get('duplicates', 'type=cat')).pairs[0].suggestedSurvivorId, rich);
  void poor;
});
