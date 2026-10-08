// Usage: node scripts/backup.mjs [--env production|staging] [--keep-all]
// Takes a full logical backup of the remote D1 database into backups/ (git-ignored, owner-only), records
// a manifest (checksum + row counts), PROVES the backup restores into a scratch database, and only then
// prunes old backups: every backup of the last 14 days, then the newest of each week for 8 weeks.
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { remoteQuery, root, stamp, targetEnv, wrangler, migrationFiles } from './lib/common.mjs';
import { verifyRestore } from './lib/restore.mjs';

const target = targetEnv(process.argv);
const dir = path.join(root, 'backups');
mkdirSync(dir, { recursive: true, mode: 0o700 });
const base = `catnr-${target.name}-${stamp()}`, sqlFile = path.join(dir, `${base}.sql`), manifestFile = path.join(dir, `${base}.manifest.json`);

console.log(`Backing up ${target.database} (${target.name})...`);
wrangler(['d1', 'export', target.database, '--remote', '--output', sqlFile]);
chmodSync(sqlFile, 0o600);
const tables = remoteQuery(target.database, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations' ORDER BY name", target.envFlag).map((r) => r.name);
// D1 allows only a few terms in one compound SELECT, so count in small groups.
const countRows = [];
for (let i = 0; i < tables.length; i += 4) countRows.push(...remoteQuery(target.database, tables.slice(i, i + 4).map((t) => `SELECT '${t}' t, COUNT(*) n FROM "${t}"`).join(' UNION ALL '), target.envFlag));
const bytes = readFileSync(sqlFile);
const manifest = {
  database: target.database, environment: target.name, createdAt: new Date().toISOString(), file: path.basename(sqlFile),
  bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  appliedMigrations: remoteQuery(target.database, 'SELECT name FROM d1_migrations ORDER BY id', target.envFlag).map((r) => r.name),
  expectedMigrations: migrationFiles(),
  tables: Object.fromEntries(countRows.map((r) => [r.t, r.n])),
};
writeFileSync(manifestFile, JSON.stringify(manifest, null, 2)); chmodSync(manifestFile, 0o600);

const result = verifyRestore(sqlFile, manifest);
console.log(`${result.ok ? 'PASS' : 'FAIL'}  backup ${path.basename(sqlFile)} (${(bytes.length / 1024).toFixed(0)} KB, ${Object.values(manifest.tables).reduce((a, b) => a + b, 0)} rows) ${result.ok ? 'restores cleanly' : 'DID NOT RESTORE'}`);
for (const p of result.problems) console.log(`      - ${p}`);
if (!result.ok) { console.error('Old backups were NOT pruned because this one is not usable.'); process.exit(1); }

if (!process.argv.includes('--keep-all')) {
  const week = (d) => { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); return `${t.getUTCFullYear()}-W${Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7)}`; };
  const all = readdirSync(dir).filter((f) => f.startsWith(`catnr-${target.name}-`) && f.endsWith('.manifest.json')).map((f) => ({ f, at: new Date(JSON.parse(readFileSync(path.join(dir, f), 'utf8')).createdAt) })).sort((a, b) => b.at - a.at);
  const seenWeeks = new Set(), now = Date.now();
  for (const { f, at } of all) {
    const age = (now - at) / 86400000;
    const keep = age <= 14 || (age <= 56 && !seenWeeks.has(week(at)));
    if (age > 14) seenWeeks.add(week(at));
    if (!keep) for (const ext of ['.sql', '.manifest.json']) { const p = path.join(dir, f.replace('.manifest.json', ext)); if (existsSync(p)) { rmSync(p); console.log(`pruned ${path.basename(p)}`); } }
  }
}
