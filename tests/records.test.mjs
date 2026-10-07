import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, http, JPEG, dateValue, paging, likeTerm } from './helpers/records.mjs';

const ok = (r, msg) => { assert.equal(r.status, 200, msg || JSON.stringify(r.body)); return r.body; };

test('every manage endpoint refuses unauthenticated requests', async () => {
  const api = setup();
  for (const resource of ['cats', 'colonies', 'people', 'transactions', 'photos', 'duplicates', 'merges', 'events']) {
    const res = await http.serve(() => api.d1, {
      read: async () => ({}), write: async () => ({ statements: [], response: {} }),
    }).GET(new Request(`https://rescue.test/api/manage/${resource}`));
    assert.equal(res.status, 401);
  }
  assert.equal(http.ownerFrom(new Request('https://x', { headers: { 'x-catnr-user-id': 'local-owner', 'x-catnr-user-email': 'a@b' } })), null);
  assert.equal(http.ownerFrom(new Request('https://x', { headers: { 'x-catnr-user-id': 'legacy:1', 'x-catnr-user-email': 'a@b' } })), null);
  assert.equal(http.ownerFrom(new Request('https://x', { headers: { 'x-catnr-user-id': 'A' } })), null);
});

test('cats: create without a name, edit, optimistic version check, audit trail', async () => {
  const api = setup();
  const empty = await api.post('cats', { cat: {} });
  assert.equal(empty.status, 400);
  const made = ok(await api.post('cats', { cat: { appearance: 'gray tabby', sex: 'female', currentLocation: 'Elm St porch' } }));
  const cat = api.row('cats', made.id);
  assert.equal(cat.name, null);
  assert.equal(cat.owner_id, 'A');
  const detail = ok(await api.get('cats', `id=${made.id}`));
  assert.equal(detail.cat.displayName, 'gray tabby female');
  assert.equal(detail.changes[0].action, 'create');

  const edited = ok(await api.post('cats', { action: 'update', id: made.id, version: cat.version, changes: { name: 'Pepper', currentStatus: 'recovering' } }, 'A', 'PATCH'));
  assert.deepEqual(edited.changed.sort(), ['current_status', 'name']);
  assert.equal(api.row('cats', made.id).name, 'Pepper');

  // A stale version is refused and nothing changes.
  const stale = await api.post('cats', { action: 'update', id: made.id, version: cat.version, changes: { name: 'Other' } }, 'A', 'PATCH');
  assert.equal(stale.status, 409);
  assert.equal(api.row('cats', made.id).name, 'Pepper');
  const latest = api.row('cats', made.id);
  for (const bad of [{ sex: 'tom' }, { ageClass: 'ancient' }, { currentStatus: 'vacation' }, { name: 'x'.repeat(101) }, { id: 'hacked' }, { ownerId: 'B' }]) {
    const r = await api.post('cats', { action: 'update', id: made.id, version: latest.version, changes: bad }, 'A', 'PATCH');
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal((await api.post('cats', { action: 'update', id: made.id, version: latest.version, changes: { name: 'Pepper' } }, 'A', 'PATCH')).status, 400, 'no-op edit is refused');
  const audit = api.db.prepare("SELECT action,before_snapshot,after_snapshot,actor_id,made_by FROM record_changes WHERE record_id=? ORDER BY rowid").all(made.id);
  assert.deepEqual(audit.map((a) => a.action), ['create', 'update']);
  assert.equal(JSON.parse(audit[1].before_snapshot).name, null);
  assert.equal(JSON.parse(audit[1].after_snapshot).name, 'Pepper');
  assert.equal(audit[1].actor_id, 'A');
  assert.equal(audit[1].made_by, 'user');
});

test('cats: archive and restore keep history, and microchips stay unique', async () => {
  const api = setup();
  const a = ok(await api.post('cats', { cat: { name: 'Milo', microchipNumber: '9851 1200-0000' } })).id;
  assert.equal(api.row('cats', a).microchip_number, '985112000000');
  const dup = await api.post('cats', { cat: { name: 'Other', microchipNumber: '985112000000' } });
  assert.equal(dup.status, 409);
  assert.match(dup.body.message, /Milo already has microchip/);
  ok(await api.post('events', { catId: a, eventType: 'vet_visit', occurredAt: '2026-03-01', notes: 'checkup' }));
  ok(await api.post('cats', { action: 'archive', id: a, reason: 'moved away' }));
  assert.equal(ok(await api.get('cats')).items.length, 0);
  assert.equal(ok(await api.get('cats', 'archived=archived')).items.length, 1);
  assert.equal(ok(await api.get('cats', 'archived=all')).items.length, 1);
  assert.equal(api.count('events'), 1, 'history is kept');
  assert.equal((await api.post('cats', { action: 'archive', id: a })).status, 409);
  const v = api.row('cats', a).version;
  assert.equal((await api.post('cats', { action: 'update', id: a, version: v, changes: { name: 'x' } }, 'A', 'PATCH')).status, 409, 'archived cats are read-only');
  assert.equal((await api.post('events', { catId: a, eventType: 'vet_visit', occurredAt: '2026-03-02' })).status, 409);
  ok(await api.post('cats', { action: 'restore', id: a }));
  assert.equal(ok(await api.get('cats')).items.length, 1);
  assert.deepEqual(api.db.prepare("SELECT action FROM record_changes WHERE record_id=? ORDER BY rowid").all(a).map((r) => r.action), ['create', 'archive', 'restore']);
  assert.equal(api.count('cats'), 1, 'archiving never deletes');
});

test('cats: search, filters, sorting and pagination over a realistic amount of data', async () => {
  const api = setup();
  const t0 = Date.now();
  ok(await api.post('colonies', { name: 'Jefferson' })); ok(await api.post('colonies', { name: 'Elm Street' }));
  const colonies = api.db.prepare('SELECT id,name FROM colonies').all(), jeff = colonies.find((c) => c.name === 'Jefferson').id, elm = colonies.find((c) => c.name === 'Elm Street').id;
  api.db.exec('BEGIN');
  const insert = api.db.prepare("INSERT INTO cats(id,owner_id,name,sex,age_class,appearance,current_status,origin_colony_id,microchip_number,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
  const statuses = ['observed', 'captured', 'foster', 'adopted', 'recovering'];
  api.db.prepare("INSERT OR IGNORE INTO owners(id) VALUES('B')").run();
  for (let i = 0; i < 1500; i++) {
    const iso = new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
    insert.run(`seed-${i}`, 'A', i % 3 === 0 ? null : `Cat${i}`, i % 2 ? 'male' : 'female', 'adult', i % 5 === 0 ? 'black and white' : 'orange tabby', statuses[i % 5], i % 2 ? jeff : elm, i === 777 ? 'CHIP777' : null, iso, iso);
  }
  insert.run('theirs', 'B', 'Cat1', 'male', 'adult', 'black and white', 'foster', null, null, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
  api.db.exec('COMMIT');

  const first = ok(await api.get('cats', 'pageSize=25'));
  assert.equal(first.total, 1500);
  assert.equal(first.items.length, 25);
  assert.equal(first.pages, 60);
  assert.equal(first.hasMore, true);
  const seen = new Set();
  for (let page = 1; page <= 60; page++) for (const c of ok(await api.get('cats', `page=${page}&pageSize=25&sort=created`)).items) { assert.ok(!seen.has(c.id), 'no cat appears on two pages'); seen.add(c.id); }
  assert.equal(seen.size, 1500, 'paging visits every cat exactly once');
  assert.equal(ok(await api.get('cats', 'page=61&pageSize=25')).items.length, 0);
  assert.equal(ok(await api.get('cats', 'pageSize=9999')).pageSize, 100);
  assert.equal(ok(await api.get('cats', 'page=-3&pageSize=abc')).page, 1);

  assert.equal(ok(await api.get('cats', 'q=CHIP777')).total, 1);
  assert.equal(ok(await api.get('cats', 'q=chip777')).items[0].id, 'seed-777', 'search is case-insensitive');
  assert.equal(ok(await api.get('cats', `status=adopted`)).total, 300);
  assert.equal(ok(await api.get('cats', `colonyId=${jeff}&sex=male`)).total, 750);
  assert.equal(ok(await api.get('cats', `q=black+jefferson`)).total, ok(await api.get('cats', `q=jefferson+black`)).total, 'words can be in any order');
  assert.equal(ok(await api.get('cats', `q=${encodeURIComponent('100%')}`)).total, 0, 'LIKE wildcards are literal');
  assert.equal(ok(await api.get('cats', `q=${encodeURIComponent('_')}`)).total, 0);
  assert.equal(ok(await api.get('cats', 'q=Cat1')).items.every((c) => !c.id.startsWith('theirs')), true, 'another owner’s cats never appear');
  const named = ok(await api.get('cats', 'sort=name&pageSize=100')).items;
  assert.ok(named.length === 100);
  assert.equal((await api.get('cats', 'archived=weird')).status, 400);
  assert.ok(Date.now() - t0 < 20000, 'seeding and 70 queries over 1500 cats stay fast');
});

test('colonies: create with location, duplicate names refused, edit, archive frees the name, restore conflicts are explained', async () => {
  const api = setup();
  const id = ok(await api.post('colonies', { name: 'Jefferson Ave', generalLocation: '12 Jefferson Ave, behind the market', latitude: '40.7', longitude: '-73.9' })).id;
  assert.equal((await api.post('colonies', { name: 'jefferson ave' })).status, 409);
  assert.equal((await api.post('colonies', { name: 'X', latitude: '40' })).status, 400, 'a half-set pin is refused');
  assert.equal((await api.post('colonies', { name: 'X', latitude: '120', longitude: '1' })).status, 400);
  const v = api.row('colonies', id).version;
  ok(await api.post('colonies', { action: 'update', id, version: v, changes: { notes: 'feeds at 6pm', status: 'inactive' } }, 'A', 'PATCH'));
  assert.equal((await api.post('colonies', { action: 'update', id, version: v, changes: { notes: 'again' } }, 'A', 'PATCH')).status, 409);
  const cat = ok(await api.post('cats', { cat: { name: 'Milo', originColonyId: id } })).id;
  const archived = ok(await api.post('colonies', { action: 'archive', id, reason: 'cleared' }));
  assert.match(archived.message, /1 cat/);
  assert.equal(api.row('cats', cat).origin_colony_id, id, 'cats keep their origin');
  assert.equal((await api.post('cats', { cat: { name: 'New', originColonyId: id } })).status, 409, 'cannot add cats to an archived colony');
  ok(await api.post('colonies', { name: 'Jefferson Ave' }));
  const blocked = await api.post('colonies', { action: 'restore', id });
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /already a colony called/);
  assert.equal(ok(await api.get('colonies')).items.length, 1);
  assert.equal(ok(await api.get('colonies', 'archived=all')).items.length, 2);
  assert.equal(ok(await api.get('colonies', 'q=market')).total, 0, 'archived colonies are hidden from search by default');
  assert.equal(ok(await api.get('colonies', 'q=market&archived=archived')).total, 1);
  const detail = ok(await api.get('colonies', `id=${id}`));
  assert.equal(detail.cats[0].displayName, 'Milo');
});

test('people: types, search, archive keeps history, relevant history and totals', async () => {
  const api = setup();
  const sarah = ok(await api.post('people', { name: 'Sarah Yunker', type: 'donor', contact: 'sarah@example.com' })).id;
  assert.equal((await api.post('people', { name: 'SARAH YUNKER' })).status, 409);
  assert.equal((await api.post('people', { name: 'Bad', type: 'wizard' })).status, 400);
  ok(await api.post('people', { name: 'Dr. Lee', type: 'veterinarian' }));
  const cat = ok(await api.post('cats', { cat: { name: 'Milo' } })).id;
  ok(await api.post('events', { catId: cat, eventType: 'foster', occurredAt: '2026-03-01', personId: sarah }));
  ok(await api.post('transactions', { transactionType: 'cash_donation', date: '2026-03-02', amount: '100.00', description: 'Donation', personId: sarah }));
  assert.equal(ok(await api.get('people', 'type=veterinarian')).total, 1);
  assert.equal(ok(await api.get('people', 'q=example.com')).total, 1, 'contact details are searchable');
  const detail = ok(await api.get('people', `id=${sarah}`));
  assert.equal(detail.events.length, 1);
  assert.equal(detail.transactions[0].amountText, '$100.00');
  assert.equal(detail.totals[0].text, '$100.00');
  ok(await api.post('people', { action: 'archive', id: sarah }));
  assert.equal(api.count('events', `person_id='${sarah}'`), 1);
  assert.equal(api.count('transactions', `person_id='${sarah}'`), 1);
  assert.equal((await api.post('transactions', { transactionType: 'cash_donation', date: '2026-03-02', amount: '5', description: 'x', personId: sarah })).status, 409);
  ok(await api.post('people', { action: 'restore', id: sarah }));
});

test('transactions: exact money, validation, search, filters, date ranges, totals per currency', async () => {
  const api = setup();
  const sarah = ok(await api.post('people', { name: 'Sarah', type: 'donor' })).id;
  const add = (b) => api.post('transactions', b);
  ok(await add({ transactionType: 'cash_donation', date: '2026-01-10', amount: '100', description: 'Sarah donated', personId: sarah, category: 'donation' }));
  ok(await add({ transactionType: 'merchandise_income', date: '2026-02-14', amount: 300, description: 'Sticker sales', category: 'fundraiser' }));
  ok(await add({ transactionType: 'supply_purchase', date: '2026-02-20', amount: '45.10', description: 'Brand stickers', category: 'supplies' }));
  ok(await add({ transactionType: 'cash_donation', date: '2026-03-05', amount: '5.00', currency: 'CAD', description: 'Canadian donor' }));
  ok(await add({ transactionType: 'in_kind_donation', date: '2026-03-06', description: 'Two 12 lb bags of Friskies', item: 'Friskies', quantity: 2, unit: 'bags', personId: sarah }));
  assert.equal(api.db.prepare("SELECT amount_minor FROM transactions WHERE description='Brand stickers'").get().amount_minor, 4510);
  for (const bad of [{ amount: '10.005' }, { amount: '-5' }, { amount: '1e3' }, { amount: 'abc' }, { amount: 0 }, { amount: '' }, { currency: 'JPY' }, { transactionType: 'bogus' }, { date: '2026-02-31' }, { date: '2999-01-01' }, { description: '' }, { direction: 'outflow', transactionType: 'cash_donation' }, { personId: 'nope' }]) {
    const r = await add({ transactionType: 'cash_donation', date: '2026-01-01', amount: '5', description: 'x', ...bad });
    assert.ok(r.status >= 400, JSON.stringify(bad));
  }
  assert.equal(api.count('transactions'), 5, 'rejected input wrote nothing');
  const all = ok(await api.get('transactions'));
  assert.equal(all.total, 5);
  assert.equal(all.items[0].date, '2026-03-06', 'newest first');
  assert.equal(all.totals.cashInText, 'CA$5.00 + $400.00');
  assert.equal(all.totals.cashOutText, '$45.10');
  assert.equal(ok(await api.get('transactions', 'from=2026-02-01&to=2026-02-28')).total, 2);
  assert.equal(ok(await api.get('transactions', 'from=2026-02-14&to=2026-02-14')).total, 1, 'range is inclusive');
  assert.equal(ok(await api.get('transactions', 'from=2026-02-01&to=2026-02-28')).totals.cashInText, '$300.00');
  assert.equal((await api.get('transactions', 'from=2026-03-01&to=2026-01-01')).status, 400);
  assert.equal((await api.get('transactions', 'from=yesterday')).status, 400);
  assert.equal(ok(await api.get('transactions', 'direction=outflow')).total, 1);
  assert.equal(ok(await api.get('transactions', 'type=in_kind_donation')).items[0].amountText, null);
  assert.equal(ok(await api.get('transactions', 'category=SUPPLIES')).total, 1);
  assert.equal(ok(await api.get('transactions', 'currency=CAD')).total, 1);
  assert.equal(ok(await api.get('transactions', 'q=sarah')).total, 2, 'search matches description and person');
  assert.equal(ok(await api.get('transactions', `personId=${sarah}`)).total, 2);
  assert.deepEqual(ok(await api.get('transactions', 'facets=1')).categories, ['donation', 'fundraiser', 'supplies']);
  assert.equal(ok(await api.get('transactions', 'pageSize=2&page=3')).items.length, 1);
});

test('transactions: edit keeps the original, reverse (void) and restore change totals, and corrections can be undone', async () => {
  const api = setup();
  const id = ok(await api.post('transactions', { transactionType: 'cash_donation', date: '2026-01-10', amount: '100', description: 'Donation' })).id;
  const v = api.row('transactions', id).version;
  const edited = ok(await api.post('transactions', { action: 'update', id, version: v, changes: { amount: '120.50', description: 'Donation (corrected)' }, reason: 'typo' }, 'A', 'PATCH'));
  assert.notEqual(edited.id, id);
  assert.equal(api.row('transactions', id).superseded_by != null, true, 'the original is superseded, not changed or deleted');
  assert.equal(api.row('transactions', id).amount_minor, 10000);
  assert.equal(api.row('transactions', edited.id).amount_minor, 12050);
  assert.equal(ok(await api.get('transactions')).total, 1);
  assert.equal(ok(await api.get('transactions')).totals.cashInText, '$120.50');
  assert.equal(ok(await api.get('transactions')).items[0].corrected, true);
  const correction = api.db.prepare('SELECT * FROM corrections').get();
  assert.equal(correction.made_by, 'user'); assert.equal(correction.reason, 'typo'); assert.equal(JSON.parse(correction.original_snapshot).amount_minor, 10000);
  assert.equal((await api.post('transactions', { action: 'update', id, version: v, changes: { amount: '1' } }, 'A', 'PATCH')).status, 409, 'cannot edit a replaced version');
  assert.equal((await api.post('transactions', { action: 'update', id: edited.id, version: 0, changes: { amount: '120.50' } }, 'A', 'PATCH')).status, 400, 'no-op edit refused');

  ok(await api.post('transactions', { action: 'void', id: edited.id, reason: 'duplicate entry' }));
  assert.equal(ok(await api.get('transactions')).total, 0);
  assert.equal(ok(await api.get('transactions')).totals.cashInText, '$0.00');
  assert.equal(ok(await api.get('transactions', 'status=voided')).total, 1);
  assert.equal(ok(await api.get('transactions', 'status=voided')).totals.cashInText, '$0.00', 'voided money never counts');
  assert.equal((await api.post('transactions', { action: 'void', id: edited.id })).status, 409);
  assert.equal((await api.post('transactions', { action: 'update', id: edited.id, version: 0, changes: { amount: '1' } }, 'A', 'PATCH')).status, 409, 'must restore before editing');
  assert.equal(api.count('transactions'), 2, 'nothing deleted');
  ok(await api.post('transactions', { action: 'unvoid', id: edited.id }));
  assert.equal(ok(await api.get('transactions')).totals.cashInText, '$120.50');
  assert.deepEqual(api.db.prepare("SELECT action FROM record_changes WHERE record_type='transaction' ORDER BY rowid").all().map((r) => r.action), ['create', 'replace', 'void', 'unvoid']);
  // The assistant's own undo works on a manual edit (it reverts the replacement).
  const detail = ok(await api.get('transactions', `id=${edited.id}`));
  assert.equal(detail.changes.length >= 2, true);
});

test('events: add history, status follows the history, edit via replacement, void and restore', async () => {
  const api = setup();
  const cat = ok(await api.post('cats', { cat: { name: 'Milo' } })).id;
  assert.equal((await api.post('events', { catId: cat, eventType: 'teleport', occurredAt: '2026-03-01' })).status, 400);
  assert.equal((await api.post('events', { catId: 'nope', eventType: 'vet_visit', occurredAt: '2026-03-01' })).status, 404);
  assert.equal((await api.post('events', { catId: cat, eventType: 'vet_visit', occurredAt: '2999-01-01' })).status, 400);
  ok(await api.post('events', { catId: cat, eventType: 'vet_visit', occurredAt: '2026-03-01', notes: 'checkup' }));
  const foster = ok(await api.post('events', { catId: cat, eventType: 'foster', occurredAt: '2026-03-05' }));
  assert.equal(foster.statusChangedTo, 'foster');
  assert.equal(api.row('cats', cat).current_status, 'foster');
  const older = ok(await api.post('events', { catId: cat, eventType: 'captured', occurredAt: '2026-01-01' }));
  assert.equal(older.statusChangedTo, null, 'an older event does not override a newer status');
  assert.equal(api.row('cats', cat).current_status, 'foster');
  const detail = ok(await api.get('cats', `id=${cat}`));
  assert.deepEqual(detail.events.map((e) => e.eventType), ['foster', 'vet_visit', 'captured']);
  assert.equal(detail.eventsPaging.total, 3);

  const v = api.row('events', foster.id).version;
  const edited = ok(await api.post('events', { action: 'update', id: foster.id, version: v, changes: { notes: 'with Sarah', occurredAt: '2026-03-06' } }, 'A', 'PATCH'));
  assert.equal(api.row('events', foster.id).superseded_by != null, true);
  assert.equal(api.row('events', edited.id).notes, 'with Sarah');
  ok(await api.post('events', { action: 'void', id: edited.id, reason: 'wrong cat' }));
  assert.equal(ok(await api.get('cats', `id=${cat}`)).events.length, 2);
  assert.equal(api.row('cats', cat).current_status, 'captured', 'status is repaired from the remaining history');
  ok(await api.post('events', { action: 'unvoid', id: edited.id }));
  assert.equal(api.row('cats', cat).current_status, 'foster');
  assert.equal(api.count('events'), 4, 'nothing was deleted');
});

test('photos: upload, gallery listing never loads image data, caption, hide and restore, owner-scoped images', async () => {
  const api = setup();
  const cat = ok(await api.post('cats', { cat: { name: 'Milo' } })).id;
  assert.equal((await api.post('photos', { catId: cat, photoDataUrl: 'data:image/jpeg;base64,aGVsbG8=' })).status, 400);
  assert.equal((await api.post('photos', { catId: cat, photoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 400);
  assert.equal((await api.post('photos', { catId: cat })).status, 400);
  assert.equal((await api.post('photos', { catId: 'nope', photoDataUrl: JPEG })).status, 404);
  const ids = [];
  for (let i = 0; i < 30; i++) ids.push(ok(await api.post('photos', { catId: cat, photoDataUrl: JPEG, caption: `photo ${i}`, takenAt: `2026-02-${String(i % 28 + 1).padStart(2, '0')}` })).id);
  const page1 = ok(await api.get('photos', `catId=${cat}`));
  assert.equal(page1.total, 30); assert.equal(page1.items.length, 24); assert.equal(page1.hasMore, true);
  assert.ok(page1.items.every((p) => !('storageLocation' in p) && !JSON.stringify(p).includes('base64')), 'listings carry no image data');
  const page2 = ok(await api.get('photos', `catId=${cat}&page=2`));
  assert.equal(page2.items.length, 6);
  assert.equal(new Set([...page1.items, ...page2.items].map((p) => p.id)).size, 30);
  const img = await api.get('photos', `image=${ids[0]}`);
  assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg'); assert.match(img.headers.get('cache-control'), /private/);
  assert.equal((await api.get('photos', `image=${ids[0]}`, 'B')).status, 404, 'another owner cannot fetch the image');
  assert.equal((await api.get('photos', 'image=missing')).status, 404);
  ok(await api.post('photos', { action: 'caption', id: ids[0], caption: 'Milo on the porch' }, 'A', 'PATCH'));
  assert.equal(api.row('photos', ids[0]).caption, 'Milo on the porch');
  ok(await api.post('photos', { action: 'archive', id: ids[0] }));
  assert.equal(ok(await api.get('photos', `catId=${cat}`)).total, 29);
  assert.equal(ok(await api.get('photos', `catId=${cat}&archived=archived`)).total, 1);
  assert.equal(api.count('photos'), 30, 'hiding a photo never deletes it');
  assert.equal(ok(await api.get('cats', `id=${cat}`)).cat.photoCount, 29);
  assert.equal(ok(await api.get('cats')).items[0].leadPhotoId != null, true);
  ok(await api.post('photos', { action: 'restore', id: ids[0] }));
  assert.equal(ok(await api.get('photos', `catId=${cat}`)).total, 30);
  const audit = api.db.prepare("SELECT before_snapshot,after_snapshot FROM record_changes WHERE record_type='photo'").all();
  assert.ok(audit.every((a) => !String(a.before_snapshot).includes('base64') && !String(a.after_snapshot).includes('base64')), 'audit rows never hold image bytes');
});

test('writes are atomic, idempotent and isolated per owner', async () => {
  const api = setup();
  // A retry with the same key replays the saved answer instead of creating a second record.
  const first = ok(await api.post('cats', { requestKey: 'same', cat: { name: 'Milo' } }));
  const again = ok(await api.post('cats', { requestKey: 'same', cat: { name: 'Milo' } }));
  assert.equal(again.replayed, true); assert.equal(again.id, first.id); assert.equal(api.count('cats'), 1);
  assert.equal((await api.post('cats', { requestKey: 'same', cat: { name: 'Different' } })).status, 409, 'a key cannot be reused for a different change');

  // An injected failure on the audit insert leaves nothing behind (no cat, no receipt).
  const failing = setup({ fail: (q) => q.startsWith('INSERT INTO record_changes') });
  const bad = await failing.post('cats', { cat: { name: 'Ghost' } });
  assert.equal(bad.status, 503);
  assert.equal(failing.count('cats'), 0); assert.equal(failing.count('record_changes'), 0); assert.equal(failing.count('write_requests'), 0);

  // Ownership: B can neither read nor change A's records, and ids sent by the client are never trusted.
  const mine = first.id;
  assert.equal((await api.get('cats', `id=${mine}`, 'B')).status, 404);
  assert.equal((await api.post('cats', { action: 'archive', id: mine }, 'B')).status, 404);
  assert.equal((await api.post('cats', { action: 'update', id: mine, version: 0, changes: { name: 'Hijack' } }, 'B', 'PATCH')).status, 404);
  assert.equal(ok(await api.get('cats', '', 'B')).total, 0);
  assert.equal(api.row('cats', mine).name, 'Milo');
  const theirCol = ok(await api.post('colonies', { name: 'Theirs' }, 'B')).id;
  assert.equal((await api.post('cats', { cat: { name: 'Cross', originColonyId: theirCol } })).status, 404, 'cannot link to another owner’s colony');
  const created = ok(await api.post('cats', { cat: { name: 'Mine', ownerId: 'B', owner_id: 'B' } }));
  assert.equal(api.row('cats', created.id).owner_id, 'A', 'client-supplied owner ids are ignored');
  assert.equal((await api.post('merges', { recordType: 'cat', survivorId: mine, mergedId: created.id, confirm: true, survivorVersion: 0, mergedVersion: 0 }, 'B')).status, 404);
});

test('input helpers: dates, paging and search escaping', () => {
  assert.equal(dateValue('2026-03-01', 'd'), '2026-03-01');
  assert.equal(dateValue('2026-03-01T10:00:00Z', 'd'), '2026-03-01T10:00:00Z');
  for (const bad of ['2026-02-30', '03/01/2026', 'tomorrow', '2026-13-01', '1980-01-01', 5]) assert.throws(() => dateValue(bad, 'd'), /date|past/i, String(bad));
  assert.throws(() => dateValue('2999-01-01', 'd'), /future/);
  assert.equal(dateValue('', 'd', false), null);
  assert.deepEqual(paging(new URLSearchParams('page=3&pageSize=10')), { page: 3, pageSize: 10, offset: 20 });
  assert.equal(paging(new URLSearchParams('pageSize=1000')).pageSize, 100);
  assert.equal(likeTerm('50%_off\\'), '%50\\%\\_off\\\\%');
});
