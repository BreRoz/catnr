// Usage: node scripts/flag.mjs <ai|photo_uploads|imports> <on|off> ["reason"] [--env staging]
//        node scripts/flag.mjs list [--env staging]
// Emergency switches. Takes effect on the very next request - no deploy needed. "off" never deletes anything:
// the feature just stops accepting new work. Records, history and exports keep working.
import { remoteQuery, targetEnv } from './lib/common.mjs';

const target = targetEnv(process.argv), envAt = process.argv.indexOf('--env');
const [name, state, ...rest] = process.argv.slice(2).filter((_, i) => envAt < 0 || (i + 2 !== envAt && i + 2 !== envAt + 1));
const NAMES = ['ai', 'photo_uploads', 'imports'];
const show = () => { const rows = remoteQuery(target.database, 'SELECT name, enabled, reason, updated_at FROM ops_flags ORDER BY name', target.envFlag); console.log(`Switches on ${target.name} (anything not listed is ON):`); for (const r of rows) console.log(`  ${r.name.padEnd(14)} ${r.enabled ? 'ON ' : 'OFF'}  ${r.updated_at}  ${r.reason ?? ''}`); if (!rows.length) console.log('  (none set)'); };
if (name === 'list') { show(); process.exit(0); }
if (!NAMES.includes(name) || !['on', 'off'].includes(state)) { console.error(`Usage: node scripts/flag.mjs <${NAMES.join('|')}> <on|off> ["reason"] [--env staging]`); process.exit(2); }
const reason = (rest.filter((a) => !a.startsWith('--')).join(' ') || '').replace(/'/g, "''").slice(0, 200);
remoteQuery(target.database, `INSERT INTO ops_flags(name,enabled,reason) VALUES('${name}',${state === 'on' ? 1 : 0},${reason ? `'${reason}'` : 'NULL'}) ON CONFLICT(name) DO UPDATE SET enabled=excluded.enabled, reason=excluded.reason, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`, target.envFlag);
show();
