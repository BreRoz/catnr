import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.mjs';
import { loadTs } from './load-ts.mjs';

export const http = await loadTs('app/manage/http.ts');
const modules = {
  cats: await loadTs('app/manage/cats.ts'), colonies: await loadTs('app/manage/colonies.ts'), people: await loadTs('app/manage/people.ts'),
  events: await loadTs('app/manage/events.ts'), transactions: await loadTs('app/manage/transactions.ts'), photos: (await loadTs('app/manage/photos.ts')).makeResource(() => undefined),
  duplicates: await loadTs('app/manage/duplicates.ts'), merges: await loadTs('app/manage/merge.ts'), reports: await loadTs('app/manage/reports.ts'), 'roll-call': await loadTs('app/manage/roll-call.ts'),
  export: (await loadTs('app/portability/export.ts')).resource, import: (await loadTs('app/portability/import.ts')).resource, account: (await loadTs('app/portability/account.ts')).resource,
};
export const { findCatPairs, findPersonPairs, findColonyPairs, editDistance } = modules.duplicates;
export const { analyze } = modules.merges;
export const reportQueries = await loadTs('app/reports/queries.ts');
export const reportDefinitions = await loadTs('app/reports/definitions.ts');
export const { paging, likeTerm, dateValue } = await loadTs('app/manage/common.ts');

/** A D1-shaped adapter over node:sqlite. batch() is one transaction, foreign keys are checked at commit. */
export function makeD1(db, hooks = {}) {
  return {
    prepare(query) {
      let values = [];
      const stmt = {
        bind(...v) { values = v.map((x) => (x === undefined ? null : x)); return stmt; },
        async first() { return db.prepare(query).get(...values) ?? null; },
        async all() { return { results: db.prepare(query).all(...values) }; },
        async run() { if (hooks.fail?.(query)) throw new Error('Injected database failure'); const r = db.prepare(query).run(...values); return { ...r, meta: { changes: Number(r.changes) } }; },
      };
      return stmt;
    },
    async batch(statements) {
      db.exec('BEGIN');
      try { const out = []; for (const s of statements) out.push(await s.run()); db.exec('COMMIT'); return out; }
      catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
    },
  };
}

export function setup(hooks) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const sql of migrations) db.exec(sql);
  const d1 = makeD1(db, hooks);
  const handlers = Object.fromEntries(Object.entries(modules).map(([name, mod]) => [name, http.serve(() => d1, mod)]));
  let counter = 0;
  const headers = (owner) => ({ 'x-catnr-user-id': owner, 'x-catnr-user-email': `${owner}@test`, 'content-type': 'application/json' });
  const api = {
    db, d1,
    async get(resource, query = '', owner = 'A') {
      const res = await handlers[resource].GET(new Request(`https://rescue.test/api/manage/${resource}${query ? `?${query}` : ''}`, { headers: headers(owner) }));
      return { status: res.status, headers: res.headers, body: res.headers.get('content-type')?.includes('json') ? await res.json() : res };
    },
    async post(resource, body, owner = 'A', method = 'POST') {
      const withKey = { requestKey: `k${++counter}`, ...body };
      const res = await handlers[resource][method](new Request(`https://rescue.test/api/manage/${resource}`, { method, headers: headers(owner), body: JSON.stringify(withKey) }));
      return { status: res.status, body: await res.json() };
    },
    count: (table, where = '1=1') => db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`).get().n,
    row: (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id),
  };
  return api;
}

export const JPEG = 'data:image/jpeg;base64,/9j/2Q==';
