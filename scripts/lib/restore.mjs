// Proves a backup file can actually be restored. It replays the SQL into a brand-new throwaway SQLite
// database and checks that what comes back is the schema the migrations define, internally consistent,
// and (when a manifest is given) has exactly the row counts recorded when the backup was taken.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expectedShape, shapeOf } from './common.mjs';

export function verifyRestore(sqlFile, manifest = null) {
  const problems = [], dir = mkdtempSync(path.join(tmpdir(), 'catnr-restore-'));
  const db = new DatabaseSync(path.join(dir, 'restored.sqlite'));
  try {
    try { db.exec(readFileSync(sqlFile, 'utf8')); } catch (error) { return { ok: false, problems: [`the backup could not be replayed: ${error.message}`], counts: {} }; }
    const integrity = db.prepare('PRAGMA integrity_check').all().map((r) => r.integrity_check);
    if (integrity.join() !== 'ok') problems.push(`integrity_check: ${integrity.join('; ')}`);
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    if (fk.length) problems.push(`${fk.length} foreign-key violation(s), first in table ${fk[0].table}`);
    // A backup taken before a migration is compared with the schema as of the migrations it had applied.
    const have = new Set(shapeOf(db)), want = expectedShape(manifest?.appliedMigrations);
    for (const line of want) if (!have.has(line)) problems.push(`missing or different in the backup: ${line.split('|').slice(0, 2).join(' ')}`);
    const wanted = new Set(want);
    for (const line of have) if (!wanted.has(line)) problems.push(`not in the migrations: ${line.split('|').slice(0, 2).join(' ')}`);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name<>'d1_migrations'").all().map((r) => r.name);
    const counts = Object.fromEntries(tables.map((t) => [t, Number(db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n)]));
    if (manifest) for (const [table, n] of Object.entries(manifest.tables)) if (counts[table] !== n) problems.push(`${table}: backup had ${n} rows when taken, restore produced ${counts[table] ?? 'no table'}`);
    // The protections that matter most must have survived the round trip, not just the data.
    const triggers = db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger'").get().n;
    if (triggers < 20) problems.push(`only ${triggers} triggers restored; the audit protections are missing`);
    return { ok: problems.length === 0, problems, counts, triggers };
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
}
