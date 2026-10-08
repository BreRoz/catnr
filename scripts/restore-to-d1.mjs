// Usage: node scripts/restore-to-d1.mjs <backup.sql> --database <NEW-or-empty-d1-name> [--env staging]
// Restores a backup into an EMPTY remote D1 database, in a form D1 accepts (large photo rows are split),
// then checks the row counts against the backup's manifest. It will not touch the production database:
// to recover production, restore into a new database and repoint the binding (docs/RUNBOOK.md), or use
// Time Travel. The backup is proven restorable (scripts/lib/restore.mjs) before anything is sent.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ENVIRONMENTS, remoteQuery, wrangler } from './lib/common.mjs';
import { splitLargeStatements } from './lib/split.mjs';
import { verifyRestore } from './lib/restore.mjs';

const [file] = process.argv.slice(2), arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const database = arg('--database'), envFlag = arg('--env') ? ['--env', arg('--env')] : [];
if (!file || !existsSync(file) || !database) { console.error('Usage: node scripts/restore-to-d1.mjs <backup.sql> --database <empty d1 database> [--env staging]'); process.exit(2); }
if (database === ENVIRONMENTS.production.database) { console.error('Refusing to restore over the production database. Restore into a new database, check it, then repoint (see docs/RUNBOOK.md).'); process.exit(2); }

const manifestPath = file.replace(/\.sql$/, '.manifest.json'), manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const proof = verifyRestore(file, manifest);
if (!proof.ok) { console.error('This backup does not restore cleanly, so nothing was sent:\n  - ' + proof.problems.join('\n  - ')); process.exit(1); }
const existing = remoteQuery(database, "SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%'", envFlag)[0]?.n;
if (existing) { console.error(`${database} is not empty (${existing} tables). Restore into an empty database.`); process.exit(1); }

const dir = mkdtempSync(path.join(tmpdir(), 'catnr-d1restore-')), out = path.join(dir, 'restore.sql');
try {
  writeFileSync(out, splitLargeStatements(readFileSync(file, 'utf8')), { mode: 0o600 }); chmodSync(out, 0o600);
  console.log(`Restoring ${path.basename(file)} into ${database}...`);
  wrangler(['d1', 'execute', database, '--remote', '--yes', '--file', out, ...envFlag]);
} finally { rmSync(dir, { recursive: true, force: true }); }

const tables = Object.keys(manifest?.tables ?? proof.counts), bad = [];
for (let i = 0; i < tables.length; i += 4) for (const r of remoteQuery(database, tables.slice(i, i + 4).map((t) => `SELECT '${t}' t, COUNT(*) n FROM "${t}"`).join(' UNION ALL '), envFlag)) {
  const want = manifest ? manifest.tables[r.t] : proof.counts[r.t];
  if (r.n !== want) bad.push(`${r.t}: expected ${want}, found ${r.n}`);
}
const photoBytes = remoteQuery(database, 'SELECT COALESCE(SUM(LENGTH(storage_location)),0) n FROM photos', envFlag)[0]?.n;
console.log(bad.length ? `FAIL  restored database differs:\n  - ${bad.join('\n  - ')}` : `PASS  ${database} has every table and row count from the backup (${Number(photoBytes).toLocaleString()} bytes of photos). Now run: node scripts/verify-deploy.mjs --env ${arg('--env') || 'production'} against it, or point a test worker at it.`);
process.exit(bad.length ? 1 : 0);
