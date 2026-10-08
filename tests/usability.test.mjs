import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadTs } from './helpers/load-ts.mjs';
import { homeScreenSource } from './helpers/assistant.mjs';

const { describeFailure, describeMicError, workingLabel } = await loadTs('app/feedback.ts');
const { createDraftStore } = await loadTs('app/drafts.ts');
const src = (f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8');

// ---- Failure messages: what failed, was it saved, what next ----

test('a dropped connection on a save says it is unknown whether it saved, and that retry is safe', () => {
  const f = describeFailure({ action: 'save that update', kind: 'write', network: true, inputKept: true });
  assert.equal(f.saved, 'unknown');
  assert.ok(f.retrySafe);
  assert.match(f.message, /can’t tell whether it saved/);
  assert.match(f.message, /won’t create a duplicate/);
  assert.match(f.message, /still here/);
});

test('a dropped connection while only reading says nothing was changed', () => {
  const f = describeFailure({ action: 'load your cats', kind: 'read', network: true });
  assert.equal(f.saved, 'no');
  assert.match(f.message, /Nothing was changed/);
  assert.match(f.message, /Try again/);
});

test('a timeout is described as slow, not as a generic failure', () => {
  const f = describeFailure({ action: 'save that', kind: 'write', timedOut: true });
  assert.match(f.message, /took too long/);
  assert.equal(f.saved, 'unknown');
});

test('an expired sign-in (401, or an HTML page instead of JSON) tells Ari to reload and keeps her input', () => {
  for (const input of [{ status: 401 }, { unreadable: true }, { status: 403 }]) {
    const f = describeFailure({ action: 'save that update', kind: 'write', inputKept: true, ...input });
    assert.match(f.title, /sign in/i);
    assert.match(f.message, /Reload the page/);
    assert.match(f.message, /saved on this phone/);
    assert.equal(f.saved, 'no');
  }
});

test('AI outage points to Records, which works without the assistant', () => {
  const f = describeFailure({ action: 'save that update', kind: 'write', status: 503, outcome: 'ai_unavailable' });
  assert.match(f.message, /Records/);
  assert.equal(f.saved, 'no');
});

test('a server explanation is kept, and uncertain outcomes stay uncertain', () => {
  assert.match(describeFailure({ action: 'x', kind: 'write', status: 409, outcome: 'conflict', message: 'Another update changed these records.' }).message, /Another update changed/);
  const u = describeFailure({ action: 'x', kind: 'write', status: 503, outcome: 'uncertain', message: 'I can’t confirm whether the update saved.' });
  assert.equal(u.saved, 'unknown');
});

test('a bare 500 on a write is "unknown", on a read is "nothing changed"; neither is "Something went wrong"', () => {
  const w = describeFailure({ action: 'save that', kind: 'write', status: 500 });
  const r = describeFailure({ action: 'load that', kind: 'read', status: 500 });
  assert.equal(w.saved, 'unknown');
  assert.equal(r.saved, 'no');
  for (const f of [w, r, describeFailure({ action: 'x', kind: 'read', status: 418 }), describeFailure({ action: 'x', kind: 'write' })]) {
    assert.doesNotMatch(f.message, /something went wrong/i);
    assert.match(f.message, /Try again|try again|Reload/);
  }
});

test('every failure says whether data was saved and what to do next', () => {
  const cases = [{ network: true }, { timedOut: true }, { status: 401 }, { status: 413 }, { status: 429 }, { status: 500 }, { status: 400 }, { outcome: 'ai_unavailable' }, {}];
  for (const kind of ['read', 'write']) for (const c of cases) {
    const f = describeFailure({ action: 'do that', kind, ...c });
    assert.ok(f.title && f.message.length > 40, JSON.stringify(c));
    assert.ok(['no', 'unknown'].includes(f.saved));
    assert.match(f.message, /Nothing was|saved|save|duplicate|checks first|can’t be sure|can’t tell/i, `no save status: ${JSON.stringify(c)}`);
  }
});

test('microphone errors are explained in plain language', () => {
  assert.match(describeMicError('not-allowed'), /blocked.*browser settings/);
  assert.match(describeMicError('network'), /kept below/);
  assert.match(describeMicError('no-speech'), /didn’t hear/);
  assert.match(describeMicError('audio-capture'), /microphone/);
  assert.equal(describeMicError('aborted'), '');
  assert.match(describeMicError('weird-code'), /try again/);
});

test('progress text is stage-specific and admits slowness', () => {
  assert.match(workingLabel('photo', 0), /Uploading/);
  assert.match(workingLabel('answer', 0), /records/);
  assert.match(workingLabel('saving', 0), /Saving/);
  assert.match(workingLabel('assistant', 20000), /Still working/);
  assert.doesNotMatch(workingLabel('assistant', 1000), /Still working/);
});

// ---- Drafts: typed text and photo survive ----

const memoryStorage = (limit = Infinity) => {
  const m = new Map();
  return { m, getItem: (k) => m.get(k) ?? null, removeItem: (k) => m.delete(k), setItem(k, v) { if (v.length > limit) throw new DOMException('full', 'QuotaExceededError'); m.set(k, v); } };
};

test('a draft round-trips text and photo', () => {
  const store = createDraftStore(memoryStorage(), () => 1000);
  assert.equal(store.save({ mode: 'text', text: 'Pepper got neutered', photo: { name: 'a.jpg', dataUrl: 'data:image/jpeg;base64,AAAA' } }), 'saved');
  const d = store.load();
  assert.equal(d.text, 'Pepper got neutered');
  assert.equal(d.photo.dataUrl, 'data:image/jpeg;base64,AAAA');
});

test('an empty draft is removed rather than kept', () => {
  const s = memoryStorage();
  const store = createDraftStore(s, () => 1);
  store.save({ mode: 'text', text: 'hello', photo: null });
  assert.equal(store.save({ mode: 'text', text: '  ', photo: null }), 'cleared');
  assert.equal(store.load(), null);
  assert.equal(s.m.size, 0);
});

test('when the photo does not fit, the words are still kept and the caller is told', () => {
  const store = createDraftStore(memoryStorage(200), () => 1);
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  assert.equal(store.save({ mode: 'photo', text: 'Gray cat at Jefferson', photo: { name: 'big.jpg', dataUrl: big } }), 'text-only');
  const d = store.load();
  assert.equal(d.text, 'Gray cat at Jefferson');
  assert.equal(d.photo, null);
});

test('unavailable or corrupt storage never throws', () => {
  assert.equal(createDraftStore(null).save({ mode: 'text', text: 'x', photo: null }), 'failed');
  assert.equal(createDraftStore(null).load(), null);
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
  const store = createDraftStore(broken);
  assert.equal(store.save({ mode: 'text', text: 'x', photo: null }), 'failed');
  assert.equal(store.load(), null);
  assert.doesNotThrow(() => store.clear());
  const garbled = memoryStorage(); garbled.m.set('catnr-draft-v1', '{not json');
  assert.equal(createDraftStore(garbled).load(), null);
});

test('stale drafts (over a week old) are dropped', () => {
  let t = 0;
  const store = createDraftStore(memoryStorage(), () => t);
  store.save({ mode: 'text', text: 'old', photo: null });
  t = 8 * 24 * 3600 * 1000;
  assert.equal(store.load(), null);
});

// ---- Server: AI outage is honest and nothing is claimed saved ----

test('an AI provider failure produces an ai_unavailable 503, not a commit failure', async () => {
  const reliability = await src('app/api/assistant/reliability.ts');
  assert.match(reliability, /class AiUnavailable/);
  assert.match(reliability, /AbortSignal\.timeout\(45000\)/);
  assert.match(reliability, /outcome:\s*"ai_unavailable"/);
  const route = await src('app/api/assistant/agent.ts');
  assert.doesNotMatch(route, /await fetch\("https:\/\/(openrouter|api\.openai)/);
  assert.equal([...route.matchAll(/providerFetch\(/g)].length, 2);
});

// ---- Accessibility contracts, checked in the source ----

test('dialogs are modal, labelled, trap focus, close on Escape and restore focus', async () => {
  const dialog = await src('app/dialog.tsx');
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /aria-labelledby/);
  assert.match(dialog, /e\.key === "Escape"/);
  assert.match(dialog, /e\.key !== "Tab"/);
  assert.match(dialog, /opener\.focus\(\)/);
  assert.match(dialog, /stack\[stack\.length - 1\] !== entry/, 'only the innermost dialog may react to Escape');
  assert.match(dialog, /window\.confirm/);
});

test('no screen defines its own dialog markup; all use the shared Sheet', async () => {
  for (const f of ['app/capture-sheet.tsx', 'app/correction-sheet.tsx', 'app/cat-history-sheet.tsx']) {
    const s = await src(f);
    assert.doesNotMatch(s, /className="sheetBackdrop"/, f);
  }
  assert.doesNotMatch(await homeScreenSource(), /className="sheetBackdrop"/, 'home screen');
  assert.match(await src('app/capture-sheet.tsx'), /<Sheet /);
  assert.match(await src('app/records/ui.tsx'), /export \{ Sheet \} from "\.\.\/dialog"/);
});

test('clickable rows are real buttons, not divs with click handlers', async () => {
  const page = await homeScreenSource();
  assert.match(page, /<button\s+type="button"\s+key=\{item\.id\}\s+className=\{`rowBtn/);
  assert.doesNotMatch(page, /<article[^>]*onClick/);
  assert.match(page, /aria-current=\{tab === id \? "page"/);
});

test('a visible keyboard focus style exists', async () => {
  assert.match(await src('app/styles/states.css'), /:focus-visible\s*\{\s*outline:\s*3px solid/);
});

test('typed text is never discarded by opening another mode or choosing an example', async () => {
  const capture = await src('app/capture-sheet.tsx');
  assert.match(capture, /drafts\.save/);
  assert.match(capture, /!text &&/, 'example prompts only show while the box is empty');
  const page = await homeScreenSource();
  assert.doesNotMatch(page, /setText\(""\)/);
  assert.match(page, /Continue/);
});

test('failed saves never close the sheet or clear the input', async () => {
  const capture = await src('app/capture-sheet.tsx');
  const submit = capture.slice(capture.indexOf('const submit'), capture.indexOf('const confirm'));
  assert.ok(submit.indexOf('if (!result.ok) { setReply(result.reply); return; }') < submit.indexOf('done('), 'failure returns before done()');
  assert.doesNotMatch(submit.slice(0, submit.indexOf('done(')), /setText\(|setPhoto\(/);
});
