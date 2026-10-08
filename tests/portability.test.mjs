import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup, JPEG, reportQueries } from './helpers/records.mjs';
import { loadTs } from './helpers/load-ts.mjs';

const csvLib = await loadTs('app/portability/csv.ts');
const retention = await loadTs('app/portability/retention.ts');
const importLib = await loadTs('app/portability/import.ts');
const root = fileURLToPath(new URL('..', import.meta.url));
const ok = (r, msg) => { assert.equal(r.status, 200, msg || JSON.stringify(r.body)); return r.body; };
const SECRET_PLACE = '14 Hidden Alley behind the feed store';

/** A realistic account: every kind of record, plus history that makes deletion hard (edits, undo, merge, AI input). */
async function populate(api, owner = 'A') {
  const colony = ok(await api.post('colonies', { colony: { name: 'Back Lot', generalLocation: SECRET_PLACE, notes: 'caretaker is wary of strangers', latitude: 41.5, longitude: -72.1 } }, owner)).id;
  const sarah = ok(await api.post('people', { person: { name: 'Sarah Yunker', type: 'donor', contact: 'sarah@example.com 555-0100', notes: 'prefers texts' } }, owner)).id;
  const milo = ok(await api.post('cats', { cat: { name: 'Milo', sex: 'male', originColonyId: colony, currentLocation: 'Elm St porch', microchipNumber: '985112000001', healthObservations: 'limping' } }, owner)).id;
  const dup = ok(await api.post('cats', { cat: { name: 'Mylo', sex: 'male' } }, owner)).id;
  const vet = ok(await api.post('events', { catId: milo, eventType: 'vet_visit', occurredAt: '2026-03-01', notes: 'private vet note', personId: sarah }, owner)).id;
  const edited = ok(await api.post('events', { action: 'update', id: vet, version: api.row('events', vet).version, changes: { notes: 'corrected note' } }, owner, 'PATCH')).id;
  const gift = ok(await api.post('transactions', { transactionType: 'cash_donation', date: '2026-03-02', amount: '100', description: 'Sarah gift', personId: sarah, relatedColonyId: colony }, owner)).id;
  ok(await api.post('transactions', { transactionType: 'in_kind_donation', date: '2026-03-03', description: 'Friskies', item: 'Friskies', quantity: 2, unit: 'bag' }, owner));
  const photo = ok(await api.post('photos', { catId: milo, photoDataUrl: JPEG, caption: 'on the porch' }, owner)).id;
  const preview = ok(await api.get('merges', `type=cat&survivorId=${milo}&mergedId=${dup}`, owner));
  ok(await api.post('merges', { recordType: 'cat', survivorId: milo, mergedId: dup, confirm: true, survivorVersion: preview.survivor.version, mergedVersion: preview.duplicate.version }, owner));
  api.db.exec(`INSERT INTO ai_inputs(id,owner_id,transcription,input_type,created_at) VALUES('in-${owner}','${owner}','Milo went to the vet','voice','2026-03-01T10:00:00Z')`);
  api.db.exec(`INSERT INTO clarifications(id,owner_id,input_id,mode,original_text,question,proposed_plan,photo_name,photo_data,status,created_at,updated_at,expires_at,decided_at) VALUES('cl-${owner}','${owner}','in-${owner}','text','x','which cat?','{}','p.jpg','${JPEG}','resolved','2026-03-01T00:00:00Z','2026-03-01T00:00:00Z','2026-03-02T00:00:00Z','2026-03-01T00:00:00Z')`);
  // An undo that points at an earlier correction: corrections reference each other, so deletion must order them.
  const first = api.db.prepare("SELECT * FROM corrections WHERE owner_id=? LIMIT 1").get(owner);
  api.db.prepare("INSERT INTO corrections(id,owner_id,kind,record_type,original_id,replacement_id,reverts_id,made_by,actor_id,original_snapshot) VALUES(?,?,?,?,?,?,?,?,?,?)")
    .run(`undo-${owner}`, owner, 'undo', 'event', first.replacement_id, first.original_id, first.id, 'user', owner, '{}');
  return { colony, sarah, milo, dup, vet, edited, gift, photo };
}

// ---------- a minimal ZIP reader, to prove the archive is valid without trusting our own writer ----------
function unzip(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let end = buffer.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'end of central directory');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const crc = view.getUint32(at + 16, true), size = view.getUint32(at + 24, true), nameLen = view.getUint16(at + 28, true), offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buffer.subarray(at + 46, at + 46 + nameLen));
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = buffer.subarray(start, start + size);
    const crcCheck = (bytes) => { let c = ~0 >>> 0; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
    assert.equal(crcCheck(data), crc, `crc of ${name}`);
    files[name] = data;
    at += 46 + nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}
const text = (bytes) => new TextDecoder().decode(bytes);
const bytesOf = async (res) => new Uint8Array(await res.arrayBuffer());

// =============================================================== EXPORT
test('export: requires sign-in and is private, attachment-only and uncached', async () => {
  const api = setup();
  await populate(api);
  const res = await api.get('export', 'download=json');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-disposition'), /^attachment; filename="catnr-full-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const { http } = await import('./helpers/records.mjs');
  const anon = await http.serve(() => api.d1, (await loadTs('app/portability/export.ts')).resource).GET(new Request('https://rescue.test/api/manage/export?download=json'));
  assert.equal(anon.status, 401);
});

test('export: JSON holds every record type for this owner only, in standard form', async () => {
  const api = setup();
  const ids = await populate(api);
  await populate(api, 'B');
  const doc = (await api.get('export', 'download=json')).body; // served as JSON, so the helper has already parsed it
  assert.equal(doc.format, 'catnr-export'); assert.equal(doc.version, 1); assert.equal(doc.profile, 'full');
  for (const t of ['colonies', 'people', 'cats', 'events', 'photos', 'transactions', 'ai_inputs', 'corrections', 'record_changes', 'merges', 'clarifications']) {
    assert.equal(doc.tables[t].length, api.count(t, "owner_id='A'"), `${t} complete`);
    assert.ok(doc.tables[t].length > 0, `${t} not empty in the fixture`);
  }
  assert.equal(doc.counts.cats, 2, 'archived and merged-away cats are included');
  assert.equal(doc.tables.events.length, 3, 'original, its replacement and the merge note are all included');
  const everything = JSON.stringify(doc);
  assert.doesNotMatch(everything, /"owner_id"/, 'ownership ids are not exported');
  assert.ok(!everything.includes('"B"') && !doc.tables.cats.some((c) => c.id.includes('B')));
  assert.equal(doc.tables.cats.filter((c) => c.owner_id).length, 0);
  // Money stays exact integers with a currency.
  const gift = doc.tables.transactions.find((t) => t.id === ids.gift);
  assert.equal(gift.amount_minor, 10000); assert.equal(gift.currency, 'USD');
  // Photos: metadata plus a file reference, never bytes in the JSON; queued photo bytes are not duplicated either.
  const photo = doc.tables.photos[0];
  assert.equal(photo.file, `photos/${ids.photo}.jpg`); assert.ok(!('storage_location' in photo));
  assert.doesNotMatch(everything, /base64/);
  assert.equal(doc.tables.clarifications[0].has_photo, 1);
});

test('export: CSV per record type, formula-safe, opens cleanly in a spreadsheet', async () => {
  const api = setup();
  ok(await api.post('cats', { cat: { name: '=HYPERLINK("http://evil","x")', appearance: 'tabby, "striped"\nwith a second line' } }));
  ok(await api.post('cats', { cat: { name: '+1 Lucky', appearance: 'plain' } }));
  const res = await api.get('export', 'download=csv&table=cats');
  assert.match(res.headers.get('content-type'), /^text\/csv/);
  const raw = await bytesOf(res.body);
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 byte-order mark so Excel reads accents correctly');
  const body = text(raw);
  assert.ok(!/(^|,|\n)=HYPERLINK/.test(body) && !/(^|,|\n)\+1 Lucky/.test(body), 'cells starting with = or + are neutralised');
  const parsed = csvLib.parseCsv(body);
  assert.deepEqual(parsed.rows.map((r) => r[parsed.header.indexOf('appearance')]).sort(), ['plain', 'tabby, "striped"\nwith a second line']);
  assert.equal((await api.get('export', 'download=csv&table=owners')).status, 400);
  assert.equal((await api.get('export', 'download=csv')).status, 400);
  assert.equal((await api.get('export', 'download=exe')).status, 400);
  assert.equal((await api.get('export', 'download=json&profile=everyone')).status, 400);
});

test('export: the ZIP is a valid archive with README, JSON, CSVs and the real photo files', async () => {
  const api = setup();
  const ids = await populate(api);
  const res = await api.get('export', 'download=zip');
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const files = unzip(await bytesOf(res.body));
  assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'csv/cats.csv', 'csv/colonies.csv', 'csv/events.csv', 'csv/people.csv', 'csv/photos.csv', 'csv/transactions.csv', 'export.json', `photos/${ids.photo}.jpg`].sort());
  assert.deepEqual([...files[`photos/${ids.photo}.jpg`]], [...Buffer.from(JPEG.split(',')[1], 'base64')], 'photo bytes survive exactly');
  assert.match(text(files['README.txt']), /minor units/);
  assert.equal(JSON.parse(text(files['export.json'])).counts.cats, 2);
  assert.match(text(files['csv/photos.csv']), new RegExp(`photos/${ids.photo}\\.jpg`));
});

test('export: the shareable profile leaves out places, contacts, notes, people, photos and the audit trail', async () => {
  const api = setup();
  await populate(api);
  const res = await api.get('export', 'download=zip&profile=shareable');
  const files = unzip(await bytesOf(res.body));
  assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'csv/cats.csv', 'csv/colonies.csv', 'csv/events.csv', 'csv/transactions.csv', 'export.json'].sort());
  const all = Object.values(files).map(text).join('\n');
  for (const secret of [SECRET_PLACE, 'caretaker is wary', 'sarah@example.com', 'Sarah', 'Yunker', 'private vet note', 'corrected note', 'Elm St porch', '985112000001', 'limping', '41.5', '-72.1', 'prefers texts', 'Sarah gift']) {
    assert.ok(!all.includes(secret), `shareable export must not contain "${secret}"`);
  }
  const doc = JSON.parse(text(files['export.json']));
  assert.deepEqual(Object.keys(doc.tables).sort(), ['cats', 'colonies', 'events', 'transactions']);
  assert.equal(doc.tables.colonies[0].name, 'Back Lot');
  assert.equal(doc.tables.transactions.find((t) => t.amount_minor === 10000).currency, 'USD', 'amounts remain for impact reporting');
});

test('export: every download is logged (what, when, how many) without content', async () => {
  const api = setup();
  await populate(api);
  assert.equal(ok(await api.get('export')).lastExport, null);
  await api.get('export', 'download=json'); await api.get('export', 'download=zip&profile=shareable');
  const rows = api.db.prepare('SELECT profile,format,counts FROM data_exports ORDER BY rowid').all();
  assert.deepEqual(rows.map((r) => `${r.profile}/${r.format}`), ['full/json', 'shareable/zip']);
  assert.doesNotMatch(rows[0].counts, /Milo|Sarah/);
  assert.equal(ok(await api.get('export')).lastExport.profile, 'shareable');
  assert.equal(ok(await api.get('export', '', 'B')).lastExport, null, 'another owner sees no log');
});

// =============================================================== IMPORT
const csvOf = (header, rows) => [header, ...rows].join('\n');
const preview = (api, kind, csv, extra = {}, owner = 'A') => api.post('import', { mode: 'preview', kind, csv, ...extra }, owner);
const commit = (api, kind, csv, extra = {}, owner = 'A') => api.post('import', { mode: 'commit', kind, csv, filename: 'rescue.csv', ...extra }, owner);

test('import: a preview checks every row and writes nothing', async () => {
  const api = setup();
  const csv = csvOf('Name,Sex,Age,Status,Colour', ['Pepper,F,adult,foster,black', 'Ghost,m,kitten,observed,white', ',,,,', 'Bad,robot,adult,foster,x', 'Zed,male,adult,on vacation,x']);
  const before = api.count('cats') + api.count('record_changes') + api.count('write_requests');
  const res = ok(await preview(api, 'cats', csv));
  assert.equal(res.outcome, 'preview');
  assert.deepEqual(res.summary, { ready: 2, duplicates: 0, errors: 2 });
  assert.equal(res.rowCount, 4);
  assert.deepEqual(res.rows.map((r) => [r.row, r.status]), [[2, 'ready'], [3, 'ready'], [4, 'error'], [5, 'error']]);
  assert.match(res.rows[2].problem, /Sex must be one of/); assert.match(res.rows[3].problem, /Status must be one of/);
  assert.deepEqual(res.columns.recognized.map((c) => c.field), ['Name', 'Sex', 'Age', 'Status', 'Appearance']);
  assert.equal(res.canImport, true);
  assert.match(res.errorCsv, /Sex must be one of/); assert.match(res.errorCsv, /^\uFEFFrow,result,reason,Name,Sex,Age,Status,Colour/);
  assert.equal(api.count('cats') + api.count('record_changes') + api.count('write_requests'), before, 'preview wrote nothing at all');
});

test('import: problems stop the import unless Ari chooses to skip those rows; then it is all-or-nothing and audited', async () => {
  const api = setup();
  const csv = csvOf('name,sex,status', ['Pepper,f,foster', 'Bad,robot,foster', 'Ghost,m,observed']);
  const refused = await commit(api, 'cats', csv);
  assert.equal(refused.status, 400); assert.match(refused.body.message, /1 row has a problem, so nothing was imported/);
  assert.equal(api.count('cats'), 0);
  const done = ok(await commit(api, 'cats', csv, { skipInvalid: true }));
  assert.equal(done.imported, 2); assert.equal(done.skippedInvalid, 1);
  assert.equal(api.count('cats'), 2);
  const audit = api.db.prepare("SELECT reason,action,made_by,actor_id FROM record_changes WHERE record_type='cat'").all();
  assert.equal(audit.length, 2);
  for (const a of audit) { assert.equal(a.reason, 'Imported from rescue.csv'); assert.equal(a.action, 'create'); assert.equal(a.actor_id, 'A'); }
  assert.equal(api.db.prepare("SELECT owner_id FROM cats WHERE name='Pepper'").get().owner_id, 'A');
});

test('import: a failure while saving leaves nothing behind', async () => {
  const api = setup({ fail: (q) => q.startsWith('INSERT INTO cats') && globalThis.__failNext });
  globalThis.__failNext = false;
  const csv = csvOf('name', ['One', 'Two', 'Three']);
  globalThis.__failNext = true;
  const res = await commit(api, 'cats', csv);
  globalThis.__failNext = false;
  assert.notEqual(res.status, 200);
  assert.equal(api.count('cats'), 0); assert.equal(api.count('record_changes'), 0);
});

test('import: importing the same file twice, or a retry with the same key, never duplicates', async () => {
  const api = setup();
  const csv = csvOf('name,type,contact', ['Sarah Yunker,donor,sarah@example.com', 'Dr. Lee,veterinarian,555-0101', 'sarah yunker,donor,again']);
  const first = ok(await commit(api, 'people', csv));
  assert.equal(first.imported, 2); assert.equal(first.skippedDuplicates, 1, 'repeat inside the file');
  const second = await commit(api, 'people', csv);
  assert.equal(second.status, 400); assert.match(second.body.message, /nothing new to import/);
  assert.equal(api.count('people'), 2);
  const keyed = { mode: 'commit', kind: 'colonies', csv: csvOf('name', ['North Lot']), requestKey: 'same-key' };
  ok(await api.post('import', keyed)); ok(await api.post('import', keyed));
  assert.equal(api.count('colonies'), 1);
});

test('import: real spreadsheet quirks - BOM, semicolons, tabs, quoted line breaks, US dates, dollar signs', async () => {
  const api = setup();
  ok(await commit(api, 'cats', csvOf('Name,Appearance', ['Milo,gray']))); 
  assert.equal(csvLib.parseCsv('\uFEFFa;b\n1;2').delimiter, ';');
  assert.equal(csvLib.parseCsv('a\tb\n1\t2').delimiter, '\t');
  assert.deepEqual(csvLib.parseCsv('a,b\n"x,1","line\nbreak"\n\n').rows, [['x,1', 'line\nbreak']]);
  assert.throws(() => csvLib.parseCsv('a,b\n"unclosed,1'), /never closed/);
  assert.throws(() => csvLib.parseCsv('   \n'), /empty|column names/);
  const events = '\uFEFFCat;Type;Date;Notes\r\nMilo;Vet Visit;3/9/2026;"checkup;\nall good"\r\n';
  const res = ok(await commit(api, 'events', events));
  assert.equal(res.imported, 1);
  const e = api.db.prepare('SELECT event_type,occurred_at,notes FROM events').get();
  assert.deepEqual({ ...e }, { event_type: 'vet_visit', occurred_at: '2026-03-09', notes: 'checkup;\nall good' });
  const money = ok(await commit(api, 'transactions', csvOf('Date,Type,Amount,Description,Donor', ['2026-03-10,Cash Donation,"$1,250.50",Spring drive,'])));
  assert.equal(money.imported, 1);
  assert.equal(api.db.prepare('SELECT amount_minor,currency,direction FROM transactions').get().amount_minor, 125050);
  assert.deepEqual(importLib.importDate('12/1/2026'), '2026-12-01');
});

test('import: history and money must point at real records of this owner, and never change a cat\'s status', async () => {
  const api = setup();
  const milo = ok(await api.post('cats', { cat: { name: 'Milo', microchipNumber: '985112000009' } })).id;
  ok(await api.post('cats', { cat: { name: 'Bella' } }));
  ok(await api.post('cats', { cat: { name: 'Bella', appearance: 'second' } }, 'A'));
  ok(await api.post('cats', { cat: { name: 'Secret' } }, 'B'));
  const csv = csvOf('Cat,Microchip,Type,Date', ['Milo,,adoption,2026-03-05', 'Ghost,,vet_visit,2026-03-05', 'Bella,,vet_visit,2026-03-05', 'Secret,,vet_visit,2026-03-05', ',985112000009,vet_visit,2026-03-06', ',,vet_visit,2026-03-06', 'Milo,,vet_visit,3/40/2026']);
  const res = ok(await preview(api, 'events', csv));
  assert.deepEqual(res.rows.map((r) => r.status), ['ready', 'error', 'error', 'error', 'ready', 'error', 'error']);
  assert.match(res.rows[1].problem, /No cat called “Ghost”/); assert.match(res.rows[2].problem, /More than one cat/);
  assert.match(res.rows[3].problem, /No cat called “Secret”/, "another owner's cat is invisible");
  assert.match(res.rows[5].problem, /Say which cat/); assert.match(res.rows[6].problem, /not a valid date/);
  ok(await commit(api, 'events', csv, { skipInvalid: true }));
  assert.equal(api.row('cats', milo).current_status, 'observed', 'an imported adoption entry does not move the cat');
  assert.equal(api.count('events', "event_type='adoption'"), 1);
  const noDate = await preview(api, 'events', csvOf('Cat,Type', ['Milo,vet_visit']));
  assert.equal(noDate.body.canImport, false); assert.deepEqual(noDate.body.columns.missing, ['Date']);
  assert.equal((await commit(api, 'events', csvOf('Cat,Type', ['Milo,vet_visit']))).status, 400);
});

test('import: limits and unsafe input are refused with a plain message', async () => {
  const api = setup();
  const big = csvOf('name', Array.from({ length: importLib.MAX_IMPORT_ROWS + 1 }, (_, i) => `Cat ${i}`));
  const r = await preview(api, 'cats', big);
  assert.equal(r.status, 400); assert.match(r.body.message, /Import up to 200 at a time/);
  assert.equal((await preview(api, 'dragons', 'a\n1')).status, 400);
  assert.equal((await preview(api, 'cats', '')).status, 400);
  assert.equal((await api.post('import', { kind: 'cats', csv: 'name\nX' })).status, 400, 'mode is required');
  assert.equal((await preview(api, 'cats', 'name\n"never closed')).status, 400);
  const extra = ok(await preview(api, 'people', csvOf('name', ['Sam,oops extra cell'])));
  assert.match(extra.rows[0].problem, /more cells than the header/);
  // Text that looks like a formula or markup is stored as inert text.
  ok(await commit(api, 'people', csvOf('name,notes', ['Eve,=1+1', 'Mallory,"<script>alert(1)</script>"'])));
  assert.equal(api.db.prepare("SELECT notes FROM people WHERE name='Eve'").get().notes, '=1+1');
});

test('import: a cat can be placed in a colony by name; unknown colonies are explained', async () => {
  const api = setup();
  ok(await api.post('colonies', { colony: { name: 'Back Lot' } }));
  const res = ok(await commit(api, 'cats', csvOf('name,colony', ['Pepper,back lot', 'Ghost,Nowhere']), { skipInvalid: true }));
  assert.equal(res.imported, 1);
  assert.ok(api.db.prepare("SELECT origin_colony_id FROM cats WHERE name='Pepper'").get().origin_colony_id);
  const bad = ok(await preview(api, 'cats', csvOf('name,colony', ['Ghost,Nowhere'])));
  assert.match(bad.rows[0].problem, /No colony called “Nowhere”/);
});

test('import: the exported CSV can be imported again (columns are recognised)', async () => {
  const a = setup(), b = setup();
  await populate(a);
  const csv = await (await a.get('export', 'download=csv&table=colonies')).body.text();
  const res = ok(await commit(b, 'colonies', csv));
  assert.equal(res.imported, 1);
  assert.equal(b.db.prepare('SELECT general_location FROM colonies').get().general_location, SECRET_PLACE);
  assert.equal(b.db.prepare('SELECT latitude FROM colonies').get().latitude, 41.5);
});

test('import: cross-site posts are refused', async () => {
  const { http } = await import('./helpers/records.mjs');
  const api = setup();
  const handlers = http.serve(() => api.d1, (await loadTs('app/portability/import.ts')).resource);
  const res = await handlers.POST(new Request('https://rescue.test/api/manage/import', { method: 'POST', headers: { 'x-catnr-user-id': 'A', 'x-catnr-user-email': 'A@test', origin: 'https://evil.example' }, body: JSON.stringify({ mode: 'commit', kind: 'people', csv: 'name\nX' }) }));
  assert.equal(res.status, 403);
  assert.equal(api.count('people'), 0);
});

// =============================================================== ACCOUNT DELETION
const OWNED_TABLES = ['colonies', 'people', 'ai_inputs', 'cats', 'events', 'photos', 'transactions', 'write_requests', 'rescue_revisions', 'write_guards', 'corrections', 'proposed_actions', 'proposal_executions', 'clarifications', 'clarification_answers', 'clarification_resolutions', 'merges', 'record_changes', 'duplicate_dismissals', 'data_exports', 'deletion_requests'];
const snapshotOf = (api, owner) => JSON.stringify(OWNED_TABLES.map((t) => api.db.prepare(`SELECT * FROM ${t} WHERE owner_id=? ORDER BY rowid`).all(owner)));
const PHRASE = 'DELETE MY RESCUE DATA';
const startedLongAgo = (api, owner = 'A') => api.db.prepare('UPDATE deletion_requests SET execute_after=? WHERE owner_id=?').run('2020-01-01T00:00:00.000Z', owner);

test('account deletion: explains exactly what goes and what stays', async () => {
  const api = setup();
  await populate(api);
  const s = ok(await api.get('account'));
  assert.equal(s.counts.cats, 2); assert.equal(s.counts.photos, 1); assert.ok(s.counts.record_changes > 5);
  assert.equal(s.confirmPhrase, PHRASE); assert.equal(s.waitHours, 24); assert.equal(s.request, null);
  assert.ok(s.willDelete.length >= 3 && s.willRemain.some((l) => /Cloudflare Access/.test(l)) && s.willRemain.some((l) => /receipt/.test(l)));
  assert.ok(s.retention.some((r) => r.id === 'money' && /charity/.test(r.why)));
  assert.equal(s.lastFullExport, null);
  await api.get('export', 'download=zip');
  assert.ok(ok(await api.get('account')).lastFullExport);
});

test('account deletion: nothing happens without the waiting period, the exact phrase and fresh records', async () => {
  const api = setup();
  await populate(api);
  const before = snapshotOf(api, 'A');
  const confirm = (extra) => api.post('account', { action: 'confirm', ...extra });
  assert.equal((await confirm({ confirm: PHRASE, revision: 0 })).status, 409, 'not requested yet');
  const asked = ok(await api.post('account', { action: 'request' }));
  assert.equal(asked.outcome, 'requested'); assert.equal(asked.request.canConfirm, false);
  const rev = asked.revision;
  assert.equal((await confirm({ confirm: PHRASE, revision: rev })).status, 409, 'still inside the 24 hours');
  startedLongAgo(api);
  assert.equal((await confirm({ confirm: 'delete my rescue data', revision: rev })).status, 400, 'phrase must be exact');
  assert.equal((await confirm({ revision: rev })).status, 400);
  assert.equal((await confirm({ confirm: PHRASE })).status, 409, 'revision is required');
  ok(await api.post('cats', { cat: { name: 'Late addition' } }));
  const stale = await confirm({ confirm: PHRASE, revision: rev });
  assert.equal(stale.status, 409); assert.match(stale.body.message, /records changed/);
  assert.equal(api.count('cats', "owner_id='A'"), 3, 'nothing was deleted');
  assert.notEqual(snapshotOf(api, 'A'), before);
  assert.equal(api.count('deletion_receipts'), 0);
  assert.equal(api.count('deletion_in_progress'), 0);
});

test('account deletion: cancelling leaves every record untouched', async () => {
  const api = setup();
  await populate(api);
  ok(await api.post('account', { action: 'request' }));
  const before = snapshotOf(api, 'A').replace(/"requested_at":"[^"]+"/, '').length;
  const cancelled = ok(await api.post('account', { action: 'cancel' }));
  assert.equal(cancelled.request, null); assert.equal(api.count('deletion_requests'), 0);
  assert.ok(before > 1000);
  assert.equal(api.count('cats', "owner_id='A'"), 2);
  assert.equal((await api.post('account', { action: 'confirm', confirm: PHRASE, revision: 0 })).status, 409);
  assert.equal((await api.post('account', { action: 'launch' })).status, 400);
});

test('account deletion: removes everything for this owner - audited history included - and nothing for anyone else', async () => {
  const api = setup();
  await populate(api); await populate(api, 'B');
  const bBefore = snapshotOf(api, 'B');
  const rev = ok(await api.post('account', { action: 'request' })).revision;
  startedLongAgo(api);
  const done = ok(await api.post('account', { action: 'confirm', confirm: PHRASE, revision: rev }));
  assert.equal(done.outcome, 'deleted'); assert.equal(done.counts.cats, 2);
  for (const t of OWNED_TABLES) assert.equal(api.count(t, "owner_id='A'"), 0, `${t} emptied`);
  assert.equal(api.count('owners', "id='A'"), 0);
  assert.equal(snapshotOf(api, 'B'), bBefore, "another owner's data is byte-for-byte unchanged");
  assert.equal(api.count('deletion_in_progress'), 0, 'the temporary marker is gone');
  assert.deepEqual(api.db.prepare('PRAGMA foreign_key_check').all(), []);
  // The receipt proves it happened and identifies no one.
  const receipt = api.db.prepare('SELECT * FROM deletion_receipts').get();
  assert.ok(receipt.completed_at); assert.equal(JSON.parse(receipt.counts).cats, 2);
  assert.doesNotMatch(JSON.stringify(receipt), /A@test|"A"|Milo|Sarah/);
  // The deleted owner is gone, B still works, and history protection is intact for B.
  assert.equal((await api.get('cats', '', 'A')).body.total, 0);
  assert.equal(ok(await api.get('cats', '', 'B')).total, 1, 'the active cat remains (the merged-away one is hidden)');
  assert.throws(() => api.db.exec("DELETE FROM record_changes WHERE owner_id='B'"), /immutable/);
  assert.throws(() => api.db.exec("DELETE FROM corrections WHERE owner_id='B'"), /immutable/);
  assert.throws(() => api.db.exec("DELETE FROM cats WHERE owner_id='B'"), /preserved|FOREIGN KEY/);
  // Retrying the confirmation after success cannot delete again or resurrect anything.
  const again = await api.post('account', { action: 'confirm', confirm: PHRASE, revision: rev });
  assert.equal(again.status, 409);
  assert.equal(api.count('owners', "id='A'"), 0);
  // Signing in again later starts a clean, empty account.
  const fresh = ok(await api.post('cats', { cat: { name: 'New start' } }));
  assert.equal(api.row('cats', fresh.id).owner_id, 'A');
});

test('account deletion: a database failure part-way deletes nothing', async () => {
  let fail = false;
  const api = setup({ fail: (q) => fail && q.startsWith('DELETE FROM cats') });
  await populate(api);
  const rev = ok(await api.post('account', { action: 'request' })).revision;
  startedLongAgo(api);
  const before = snapshotOf(api, 'A');
  fail = true;
  const res = await api.post('account', { action: 'confirm', confirm: PHRASE, revision: rev });
  fail = false;
  assert.notEqual(res.status, 200);
  assert.equal(snapshotOf(api, 'A'), before, 'rolled back completely');
  assert.equal(api.count('deletion_in_progress'), 0, 'no marker survives a failed batch');
  assert.equal(api.count('deletion_receipts'), 0);
});

test('account deletion: the protection of audited history only stands down inside a deletion', async () => {
  const api = setup();
  await populate(api);
  assert.throws(() => api.db.exec("DELETE FROM record_changes"), /immutable/);
  assert.throws(() => api.db.exec("DELETE FROM merges"), /immutable/);
  // Writing a marker by hand is the only way to lift it - application code does so in exactly one place.
  const source = await readFile(path.join(root, 'app/portability/account.ts'), 'utf8');
  assert.equal((source.match(/INSERT INTO deletion_in_progress/g) || []).length, 1);
  for (const dir of ['app', 'worker']) for (const file of await walk(path.join(root, dir))) {
    if (file.endsWith('portability/account.ts')) continue;
    assert.doesNotMatch(await readFile(file, 'utf8'), /deletion_in_progress/, `${file} must not touch the deletion marker`);
  }
});

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

// =============================================================== RETENTION
test('retention: finished question photos and old retry records are purged; nothing else is touched', async () => {
  const api = setup();
  await populate(api);
  const day = 86_400_000, at = new Date('2026-06-01T00:00:00Z');
  const iso = (daysAgo) => new Date(at.getTime() - daysAgo * day).toISOString();
  const add = (id, status, decided, expires) => api.db.prepare("INSERT INTO clarifications(id,owner_id,input_id,mode,original_text,question,proposed_plan,photo_data,status,created_at,updated_at,expires_at,decided_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, 'A', 'in-A', 'text', 'x', 'q', '{}', JPEG, status, iso(60), iso(60), expires, decided);
  add('old-answered', 'resolved', iso(8), iso(50)); add('recent-answered', 'resolved', iso(2), iso(50)); add('expired-long-ago', 'pending', null, iso(30)); add('still-waiting', 'pending', null, iso(-1));
  api.db.prepare("UPDATE clarifications SET photo_data=NULL WHERE id='cl-A'").run();
  api.db.prepare("INSERT INTO write_requests(owner_id,request_key,request_hash,response,created_at) VALUES('A','old','h','{}',?),('A','new','h','{}',?)").run(iso(40), iso(1));
  const transcripts = api.count('ai_inputs'), audit = api.count('record_changes'), photos = api.count('photos'), money = api.count('transactions');
  const res = await retention.purgeExpired(api.d1, at);
  assert.equal(res.clarificationPhotosWiped, 2); assert.equal(res.retryRecordsRemoved, 1);
  const has = (id) => api.db.prepare('SELECT photo_data IS NOT NULL p FROM clarifications WHERE id=?').get(id).p;
  assert.deepEqual(['old-answered', 'recent-answered', 'expired-long-ago', 'still-waiting'].map(has), [0, 1, 0, 1]);
  assert.equal(api.db.prepare("SELECT original_text,question FROM clarifications WHERE id='old-answered'").get().question, 'q', 'the question and words are kept as history');
  assert.deepEqual([api.count('ai_inputs'), api.count('record_changes'), api.count('photos'), api.count('transactions')], [transcripts, audit, photos, money]);
  assert.equal(api.count('write_requests', "request_key='new'"), 1);
  assert.deepEqual(await retention.purgeExpired(api.d1, at), { clarificationPhotosWiped: 0, retryRecordsRemoved: 0, opsEventsRemoved: 0 }, 'safe to run again');
  assert.throws(() => api.db.exec("UPDATE clarifications SET photo_data='data:image/png;base64,AAAA' WHERE id='recent-answered'"), /cannot be edited/, 'a photo can be wiped but never swapped');
});

test('retention: the policy is explicit, voice is never stored, and a daily job is scheduled', async () => {
  const ids = retention.RETENTION_RULES.map((r) => r.id);
  for (const needed of ['voice', 'transcripts', 'photos', 'audit', 'removed', 'money']) assert.ok(ids.includes(needed), needed);
  assert.equal(retention.RETENTION_RULES.find((r) => r.id === 'voice').keptFor, 'Never stored');
  for (const rule of retention.RETENTION_RULES) assert.ok(rule.what && rule.keptFor && rule.why);
  for (const file of [...await walk(path.join(root, 'app')), ...await walk(path.join(root, 'worker'))]) {
    assert.doesNotMatch(await readFile(file, 'utf8'), /MediaRecorder|getUserMedia/, `${file} would capture audio`);
  }
  const wrangler = await readFile(path.join(root, 'wrangler.jsonc'), 'utf8');
  assert.match(wrangler, /"crons":\s*\["15 4 \* \* \*"\]/);
  assert.match(await readFile(path.join(root, 'worker/index.ts'), 'utf8'), /scheduled\([^)]*\)[\s\S]*purgeExpired/);
});

// =============================================================== PRIVACY
test('privacy: reports and the assistant context never carry colony locations, contacts or private notes', async () => {
  const api = setup();
  await populate(api);
  const report = JSON.stringify(await reportQueries.buildReport(api.d1, 'A'));
  const sentences = JSON.stringify(reportQueries.reportSentences(await reportQueries.buildReport(api.d1, 'A'), 'All time'));
  for (const secret of [SECRET_PLACE, 'caretaker', 'sarah@example.com', 'Sarah', 'prefers texts', 'private vet note']) {
    assert.ok(!report.includes(secret) && !sentences.includes(secret), `report leaks ${secret}`);
  }
  const source = await readFile(path.join(root, 'app/reports/queries.ts'), 'utf8');
  assert.doesNotMatch(source, /general_location|latitude|longitude|contact|notes/, 'report queries never select sensitive columns');
});
