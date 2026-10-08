// Usage: node scripts/restore-test.mjs backups/<file>.sql   (the matching .manifest.json is used if present)
// Replays a backup into a throwaway database and reports PASS or FAIL. Touches no live data.
import { existsSync, readFileSync } from 'node:fs';
import { verifyRestore } from './lib/restore.mjs';

const file = process.argv[2];
if (!file || !existsSync(file)) { console.error('Usage: node scripts/restore-test.mjs <backup.sql>'); process.exit(2); }
const manifestPath = file.replace(/\.sql$/, '.manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
const result = verifyRestore(file, manifest);
console.log(`${result.ok ? 'PASS' : 'FAIL'}  restore test of ${file}${manifest ? '' : '  (no manifest: row counts not compared)'}`);
if (result.ok) console.log(`      ${Object.keys(result.counts).length} tables, ${Object.values(result.counts).reduce((a, b) => a + b, 0)} rows, ${result.triggers} triggers restored`);
for (const problem of result.problems) console.log(`      - ${problem}`);
process.exit(result.ok ? 0 : 1);
