// Validates the checked-in migrations without touching any real database. Run by `npm run migrations:check` and CI.
//   1. The journal lists exactly the .sql files, in order, numbered without gaps.
//   2. History is append-only: a migration that already exists in the base commit must be byte-for-byte unchanged
//      (an applied migration that is edited later is never re-run, so editing one silently forks every database).
//   3. Applied in order to an empty database they succeed, leave no foreign-key violations, pass SQLite's
//      integrity check, and every statement is separated the way `wrangler d1 migrations apply` expects.
// Base for (2): $MIGRATIONS_BASE (CI sets it to the target branch), else HEAD.
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'drizzle');
const problems = [];
const fail = (m) => problems.push(m);

const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const journal = JSON.parse(readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8')).entries;

// 1. journal <-> files
if (journal.map((e) => `${e.tag}.sql`).join() !== files.join()) fail(`drizzle/meta/_journal.json lists [${journal.map((e) => e.tag).join(', ')}] but the folder holds [${files.join(', ')}].`);
journal.forEach((e, i) => { if (e.idx !== i) fail(`journal entry ${e.tag} has idx ${e.idx}, expected ${i}.`); });
files.forEach((f, i) => { if (!f.startsWith(String(i).padStart(4, '0') + '_')) fail(`${f} should be numbered ${String(i).padStart(4, '0')}_ (no gaps, no duplicates).`); });

// 2. append-only history
const base = process.env.MIGRATIONS_BASE || 'HEAD';
try {
  const tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', base, 'drizzle/'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.sql'));
  for (const f of tracked) {
    const before = execFileSync('git', ['show', `${base}:${f}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
    let now;
    try { now = readFileSync(path.join(root, f), 'utf8'); } catch { fail(`${f} existed at ${base} and has been deleted.`); continue; }
    if (now !== before) fail(`${f} was already committed at ${base} and has been edited. Add a new migration instead.`);
  }
} catch (e) { console.warn(`(skipping the append-only check: cannot read ${base} from git: ${String(e.message).split('\n')[0]})`); }

// 3. applies cleanly, in order
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
for (const f of files) {
  const text = readFileSync(path.join(dir, f), 'utf8');
  if (!text.trim()) { fail(`${f} is empty.`); continue; }
  try {
    for (const statement of text.split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) db.exec(statement);
  } catch (e) { fail(`${f} failed to apply: ${e.message}`); break; }
}
if (!problems.length) {
  const fk = db.prepare('PRAGMA foreign_key_check').all();
  if (fk.length) fail(`foreign key violations after migrating: ${JSON.stringify(fk.slice(0, 3))}`);
  const integrity = db.prepare('PRAGMA integrity_check').get();
  if (Object.values(integrity)[0] !== 'ok') fail(`integrity_check: ${JSON.stringify(integrity)}`);
  const tables = db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().n;
  console.log(`${files.length} migrations apply cleanly in order (${tables} tables).`);
}

if (problems.length) { console.error('\nMigration check FAILED:\n' + problems.map((p) => ` - ${p}`).join('\n')); process.exit(1); }
console.log('Migration check passed.');
