// Usage: node scripts/ops-report.mjs [--env production|staging] [--hours 24]
// A plain-language health report from the operational log. Read-only. Run it daily, after any release,
// and whenever something feels wrong. Prints "ATTENTION" lines first for anything that needs a look.
import { remoteQuery, targetEnv } from './lib/common.mjs';

const target = targetEnv(process.argv);
const hi = process.argv.indexOf('--hours'), hours = hi >= 0 ? Number(process.argv[hi + 1]) : 24;
const since = new Date(Date.now() - hours * 3600_000).toISOString();
const q = (sql) => remoteQuery(target.database, sql, target.envFlag);
const counts = Object.fromEntries(q(`SELECT kind, COUNT(*) n FROM ops_events WHERE at>='${since}' GROUP BY kind`).map((r) => [r.kind, r.n]));
const n = (k) => counts[k] ?? 0;
const last = (kind) => q(`SELECT MAX(at) at FROM ops_events WHERE kind='${kind}'`)[0]?.at ?? null;
const durations = q(`SELECT duration_ms d FROM ops_events WHERE kind='ai_call' AND duration_ms IS NOT NULL AND at>='${since}' ORDER BY duration_ms`).map((r) => r.d);
const pct = (p) => (durations.length ? durations[Math.min(durations.length - 1, Math.floor(durations.length * p))] : null);
const busiest = q(`SELECT owner_hash, COUNT(*) n FROM ops_events WHERE kind='ai_call' AND at>='${since}' GROUP BY owner_hash ORDER BY n DESC LIMIT 1`)[0];
const replays = q(`SELECT owner_hash, COUNT(*) n FROM ops_events WHERE kind='retry_replay' AND at>='${since}' GROUP BY owner_hash ORDER BY n DESC LIMIT 1`)[0];
const flags = q('SELECT name, enabled, reason, updated_at FROM ops_flags');
const recent = q(`SELECT at, kind, route, status, detail FROM ops_events WHERE kind IN ('api_error','db_error','ai_failure','ai_invalid','job_failure','upload_rejected') AND at>='${since}' ORDER BY at DESC LIMIT 10`);
const lastJob = last('job_ok'), lastJobFail = last('job_failure');

const attention = [];
if (n('api_error')) attention.push(`${n('api_error')} server error(s) — see the list below`);
if (n('db_error')) attention.push(`${n('db_error')} database error(s)`);
const calls = n('ai_call'), bad = n('ai_failure');
if (bad && calls && bad / calls >= 0.2) attention.push(`assistant failing ${Math.round((100 * bad) / calls)}% of the time (${bad} of ${calls}) — check the provider, or switch the assistant off (docs/RUNBOOK.md)`);
if (n('limit_hit')) attention.push(`${n('limit_hit')} usage limit(s) hit — is something looping, or is it simply a busy day?`);
if (replays && replays.n >= 20) attention.push(`${replays.n} retried requests from one user — a client may be stuck in a retry loop`);
if (n('auth_failure') >= 5) attention.push(`${n('auth_failure')} refused sign-ins that reached the app — someone is probing, or Access is misconfigured`);
if (n('job_failure') || lastJobFail && (!lastJob || lastJobFail > lastJob)) attention.push('the daily clean-up job failed');
if (target.name === 'production' && (!lastJob || Date.now() - new Date(lastJob) > 26 * 3600_000)) attention.push(`the daily clean-up job has not reported success in over 26 hours (last: ${lastJob ?? 'never'})`);
for (const f of flags) if (!f.enabled) attention.push(`"${f.name}" is switched OFF since ${f.updated_at}${f.reason ? ` (${f.reason})` : ''}`);

console.log(`Operations report — ${target.name} — last ${hours} hours\n`);
console.log(attention.length ? attention.map((a) => `ATTENTION  ${a}`).join('\n') : 'Nothing needs attention.');
console.log(`\nAssistant calls: ${calls}   failed: ${bad}   unreadable answers: ${n('ai_invalid')}   latency p50/p95: ${pct(0.5) ?? '-'} / ${pct(0.95) ?? '-'} ms`);
console.log(`Busiest user: ${busiest ? `${busiest.n} assistant calls` : 'none'}   (limits: see app/ops/limits.ts)`);
console.log(`Errors: server ${n('api_error')}, database ${n('db_error')}   Slow requests (5s+): ${n('slow_request')}`);
console.log(`Rejected uploads: ${n('upload_rejected')}   Refused sign-ins: ${n('auth_failure')}   Limits hit: ${n('limit_hit')}   Safe retries replayed: ${n('retry_replay')}`);
console.log(`Daily job last succeeded: ${lastJob ?? 'never'}`);
if (recent.length) { console.log('\nMost recent problems:'); for (const r of recent) console.log(`  ${r.at}  ${r.kind}  ${r.route ?? ''}  ${r.status ?? ''}  ${r.detail ?? ''}`); }
process.exit(attention.length ? 1 : 0);
