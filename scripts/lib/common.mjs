// Shared helpers for the operations scripts. Plain Node, no dependencies beyond wrangler itself.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const root = path.resolve(import.meta.dirname, '../..');
export const ENVIRONMENTS = {
  production: { worker: 'catnr', database: 'catnr-db', url: 'https://catnr.bre999.workers.dev', envFlag: [] },
  staging: { worker: 'catnr-staging', database: 'catnr-staging-db', url: 'https://catnr-staging.bre999.workers.dev', envFlag: ['--env', 'staging'] },
};

export function targetEnv(argv) {
  const i = argv.indexOf('--env');
  const name = i >= 0 ? argv[i + 1] : 'production';
  if (!ENVIRONMENTS[name]) { console.error(`Unknown environment "${name}". Use production or staging.`); process.exit(2); }
  return { name, ...ENVIRONMENTS[name] };
}

export function wrangler(args, { json = false, allowFail = false } = {}) {
  try {
    const out = execFileSync('npx', ['wrangler', ...args], {
      cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_LOG_PATH: path.join(root, '.wrangler/wrangler.log'), WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
    });
    if (!json) return out;
    return JSON.parse(out.slice(out.search(/[[{]/)));
  } catch (error) {
    if (allowFail) return null;
    throw new Error(`wrangler ${args.slice(0, 3).join(' ')} failed: ${String(error.stderr || error.message).split('\n').slice(0, 6).join('\n')}`);
  }
}

/** Runs read-only SQL against a remote D1 database and returns the rows. */
export function remoteQuery(database, sql, envFlag = []) {
  const result = wrangler(['d1', 'execute', database, '--remote', '--json', '--command', sql, ...envFlag], { json: true });
  return result[0]?.results ?? [];
}

/** Strips // and block comments from JSONC without touching text inside strings. */
export function parseJsonc(text) {
  let out = '', inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inString) { out += c; if (c === '\\') out += text[++i]; else if (c === '"') inString = false; continue; }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}
export const readConfig = () => parseJsonc(readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8'));

export const migrationFiles = () => readdirSync(path.join(root, 'drizzle')).filter((f) => f.endsWith('.sql')).sort();

/** The schema an environment must have: built from the checked-in migrations alone (all of them, or just the ones it has applied). */
export function expectedShape(names = migrationFiles()) {
  const db = new DatabaseSync(':memory:');
  for (const f of names) db.exec(readFileSync(path.join(root, 'drizzle', f), 'utf8'));
  const rows = shapeOf(db);
  db.close();
  return rows;
}

export const SHAPE_SQL = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY type,name";
export const normalize = (rows) => rows.map((r) => `${r.type}|${r.name}|${r.tbl_name}|${(r.sql || '').replace(/\s+/g, ' ').trim()}`);
export const shapeOf = (db) => normalize(db.prepare(SHAPE_SQL).all());

export const stamp = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-');
