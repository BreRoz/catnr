// Brings the local development database in line with the checked-in migrations.
//
//  - Already migrated (has the d1_migrations table): just applies any pending migrations.
//  - Created before migrations were authoritative (app tables, no d1_migrations - the old
//    runtime CREATE TABLE IF NOT EXISTS path): its tables lack foreign keys, ownership and
//    constraints and cannot be migrated in place. The old files are COPIED to a timestamped
//    backup, then a fresh database is built from migrations alone. Data in the old file is
//    not carried over (it predates ownership and would be quarantined); recover from the backup
//    if needed.
//  - No local database yet: builds one from migrations.
import { DatabaseSync } from 'node:sqlite';
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const d1Dir = path.join(root, '.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
const migrate = () => execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'catnr-db', '--local'], { cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_LOG_PATH: path.join(root, '.wrangler/wrangler.log') } });

const files = existsSync(d1Dir) ? readdirSync(d1Dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite') : [];
let legacy = false;
for (const file of files) {
  const db = new DatabaseSync(path.join(d1Dir, file), { readOnly: true });
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  db.close();
  if (tables.has('d1_migrations')) continue;
  if (['cats', 'transactions', 'ai_inputs'].some((t) => tables.has(t))) legacy = true;
}

if (legacy) {
  const backup = path.join(root, '.wrangler/state/v3', `d1-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  cpSync(d1Dir, backup, { recursive: true });
  console.log(`Local database was created outside migrations. Backed up to ${path.relative(root, backup)}`);
  for (const file of readdirSync(d1Dir)) rmSync(path.join(d1Dir, file), { force: true });
  console.log('Rebuilding the local database from migrations...');
}
migrate();
