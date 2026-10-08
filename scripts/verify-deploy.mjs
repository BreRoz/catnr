// Usage: node scripts/verify-deploy.mjs [--env production|staging] [--offline]
// Checks that a deployment is what the repository says it should be. Read-only: it changes nothing.
// FAIL = fix before relying on it. WARN = look at it. CONFIRM = cannot be checked from here; do it by hand.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { expectedShape, migrationFiles, normalize, SHAPE_SQL, readConfig, remoteQuery, root, targetEnv, wrangler } from './lib/common.mjs';

const target = targetEnv(process.argv), offline = process.argv.includes('--offline');
const results = [];
const add = (status, area, text) => { results.push({ status, area, text }); };
const config = readConfig(), stagingConfig = config.env?.staging ?? {};
const mine = target.name === 'staging' ? { ...config, ...stagingConfig } : config;

// ---- Configuration in the repository (no network) ----
const prodDb = config.d1_databases?.[0], stagingDb = stagingConfig.d1_databases?.[0];
add(mine.vars?.ENVIRONMENT === target.name ? 'PASS' : 'FAIL', 'Config', `ENVIRONMENT is "${mine.vars?.ENVIRONMENT}" (expected "${target.name}")`);
add(mine.d1_databases?.[0]?.database_name === target.database ? 'PASS' : 'FAIL', 'Config', `database binding points at ${mine.d1_databases?.[0]?.database_name} (expected ${target.database})`);
add(prodDb && stagingDb && prodDb.database_id !== stagingDb.database_id ? 'PASS' : 'FAIL', 'Config', 'staging and production use different databases');
add(stagingConfig.vars?.ACCESS_AUD !== config.vars?.ACCESS_AUD || !stagingConfig.vars?.ACCESS_AUD ? 'PASS' : 'FAIL', 'Config', 'staging does not share production’s Access application');
add(stagingConfig.name && stagingConfig.name !== config.name ? 'PASS' : 'FAIL', 'Config', 'staging is a separate worker from production');
if (target.name === 'production') {
  add(config.vars?.ACCESS_TEAM_DOMAIN && config.vars?.ACCESS_AUD ? 'PASS' : 'FAIL', 'Authentication', 'Cloudflare Access team and application are configured (otherwise the site refuses everyone)');
  add(config.triggers?.crons?.length ? 'PASS' : 'FAIL', 'Jobs', `daily clean-up is scheduled (${(config.triggers?.crons || []).join(', ') || 'none'})`);
}
const keyLike = (obj) => Object.entries(obj || {}).filter(([k, v]) => /key|secret|token|password/i.test(k) || /\bsk-[A-Za-z0-9_-]{8,}/.test(String(v))).map(([k]) => k);
for (const [label, vars] of [['production', config.vars], ['staging', stagingConfig.vars]]) {
  const bad = keyLike(vars);
  add(bad.length ? 'FAIL' : 'PASS', 'Secrets', bad.length ? `wrangler.jsonc ${label} vars contains secret-looking values: ${bad.join(', ')}` : `no secret-looking values in ${label} vars (secrets live only in Cloudflare)`);
}

// ---- Secrets must not be tracked, bundled or exposed to the browser ----
const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter((f) => /(^|\/)(\.dev\.vars|\.env)(\.|$)/.test(f) && !/\.example$/.test(f));
add(tracked.length ? 'FAIL' : 'PASS', 'Secrets', tracked.length ? `secret files are committed to git: ${tracked.join(', ')}` : '.dev.vars and .env files are not tracked by git');
const hits = execFileSync('git', ['log', '--all', '--oneline', '-G', 'sk-or-v1-[A-Za-z0-9]{20,}'], { cwd: root, encoding: 'utf8' }).trim();
add(hits ? 'FAIL' : 'PASS', 'Secrets', hits ? 'an OpenRouter key appears in git history (rotate it)' : 'no API key has ever been committed');
function walk(dir) { return existsSync(dir) ? readdirSync(dir).flatMap((f) => { const p = path.join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; }) : []; }
const dist = path.join(root, 'dist');
if (existsSync(dist)) {
  const isText = (p) => /\.(js|mjs|json|html|css|map|txt)$/.test(p);
  const leaked = walk(dist).filter(isText).filter((p) => /sk-or-v1-[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{40,}/.test(readFileSync(p, 'utf8')));
  add(leaked.length ? 'FAIL' : 'PASS', 'Secrets', leaked.length ? `API key found in build output: ${leaked.map((p) => path.relative(root, p)).join(', ')}` : 'no API key in the build output');
  const client = walk(path.join(dist, 'client')).filter(isText).filter((p) => /openrouter\.ai|OPENROUTER_API_KEY|OPENAI_API_KEY/.test(readFileSync(p, 'utf8')));
  add(client.length ? 'FAIL' : 'PASS', 'Secrets', client.length ? `provider names/keys referenced in browser files: ${client.map((p) => path.relative(root, p)).join(', ')}` : 'the browser bundle never mentions the AI provider or its keys (calls are server-side only)');
  const built = existsSync(path.join(dist, 'server/wrangler.json')) ? JSON.parse(readFileSync(path.join(dist, 'server/wrangler.json'), 'utf8')) : null;
  if (built) add(built.name === target.worker && built.d1_databases?.[0]?.database_name === target.database ? 'PASS' : 'WARN', 'Build', `the current build is for "${built.name}" / ${built.d1_databases?.[0]?.database_name}${built.name === target.worker ? '' : ` — not ${target.worker}; run npm run deploy${target.name === 'staging' ? ':staging' : ''} (it rebuilds)`}`);
} else add('WARN', 'Build', 'no build output yet (run npm run build to check bundles)');

if (!offline) {
  // ---- Secrets that exist on the deployed worker ----
  const secrets = wrangler(['secret', 'list', '--format', 'json', ...target.envFlag], { json: true, allowFail: true });
  if (!secrets) add('WARN', 'Secrets', 'could not list secrets (is wrangler logged in?)');
  else {
    const names = secrets.map((s) => s.name), allowed = new Set(['OPENROUTER_API_KEY', 'OPENAI_API_KEY']);
    const strays = names.filter((n) => !allowed.has(n));
    add(strays.length ? 'FAIL' : 'PASS', 'Secrets', strays.length ? `unexpected secret name(s): ${strays.map((n) => (/sk-|key-/i.test(n) ? '"<a key pasted as a NAME>"' : n)).join(', ')} — a pasted key was used as a secret name; rotate that key and delete the secret` : 'only expected secret names exist');
    if (target.name === 'production') add(names.includes('OPENROUTER_API_KEY') || names.includes('OPENAI_API_KEY') ? 'PASS' : 'WARN', 'Secrets', names.includes('OPENROUTER_API_KEY') ? 'OPENROUTER_API_KEY exists (the app uses it only on the server)' : 'no AI provider key set: the assistant runs in simple-text fallback mode');
    else add(names.length ? 'WARN' : 'PASS', 'Secrets', names.length ? 'staging has an AI key; staging should normally have none so tests cannot spend real money' : 'staging has no AI key (cannot spend money)');
  }

  // ---- Database ----
  try {
    const applied = remoteQuery(target.database, 'SELECT name FROM d1_migrations ORDER BY id', target.envFlag).map((r) => r.name), files = migrationFiles();
    add(JSON.stringify(applied) === JSON.stringify(files) ? 'PASS' : 'FAIL', 'Database', `${applied.length} of ${files.length} migrations applied${applied.length === files.length ? ', identical order' : ` — missing: ${files.filter((f) => !applied.includes(f)).join(', ') || 'order differs'}`}`);
    const remote = new Set(normalize(remoteQuery(target.database, SHAPE_SQL, target.envFlag))), want = expectedShape();
    const missing = want.filter((l) => !remote.has(l)), extra = [...remote].filter((l) => !want.includes(l));
    add(!missing.length && !extra.length ? 'PASS' : 'FAIL', 'Database', !missing.length && !extra.length ? `tables, indexes, constraints and triggers match the migrations exactly (${want.length} objects)` : `schema drift — differs: ${[...missing, ...extra].map((l) => l.split('|').slice(0, 2).join(' ')).join('; ')}`);
    const fk = remoteQuery(target.database, 'PRAGMA foreign_key_check', target.envFlag);
    add(fk.length ? 'FAIL' : 'PASS', 'Database', fk.length ? `${fk.length} foreign-key violation(s)` : 'no foreign-key violations (every record belongs to a real owner)');
    const unowned = remoteQuery(target.database, "SELECT COUNT(*) n FROM owners WHERE id LIKE 'legacy:%' OR id='local-owner' OR status<>'active'", target.envFlag)[0]?.n ?? 0;
    add(unowned ? 'WARN' : 'PASS', 'Database', unowned ? `${unowned} quarantined/legacy owner(s) exist` : 'no quarantined or placeholder owners');
    const dev = remoteQuery(target.database, "SELECT COUNT(*) n FROM owners WHERE id IN ('dev@localhost') OR id LIKE '%@localhost'", target.envFlag)[0]?.n ?? 0;
    add(dev ? 'FAIL' : 'PASS', 'Database', dev ? 'development test identity (dev@localhost) has data in this database — a dev build wrote here' : 'no development identity has data here');
    const indexes = remoteQuery(target.database, "SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'", target.envFlag)[0]?.n ?? 0;
    add(indexes >= 15 ? 'PASS' : 'WARN', 'Database', `${indexes} named indexes present`);
  } catch (error) { add('FAIL', 'Database', `could not inspect the database: ${error.message}`); }

  // ---- Live behaviour, from outside, with no credentials ----
  const probe = async (label, url, init, ok, explain) => {
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), ...init });
      const location = r.headers.get('location') || '';
      add(ok(r, location) ? 'PASS' : 'FAIL', 'Authentication', `${label}: HTTP ${r.status}${location ? ` → ${new URL(location, url).host}` : ''} ${explain}`);
    } catch (error) { add('WARN', 'Authentication', `${label}: could not reach ${url} (${error.message})`); }
  };
  const team = config.vars?.ACCESS_TEAM_DOMAIN;
  const blocked = target.name === 'production'
    ? (r, loc) => (r.status === 302 && loc.includes(team)) || r.status === 401 || r.status === 403
    : (r) => r.status === 503 || r.status === 302 || r.status === 401 || r.status === 403;
  const never = { 'x-catnr-user-id': 'intruder@example.com', 'x-catnr-user-email': 'intruder@example.com', 'cf-access-jwt-assertion': 'x.y.z' };
  await probe('anonymous visit to the app', target.url + '/', {}, blocked, 'sends visitors to sign in, not to the app');
  await probe('anonymous API call', target.url + '/api/manage/cats', {}, blocked, 'is refused');
  await probe('API call with forged identity headers and a fake token', target.url + '/api/manage/cats', { headers: never }, blocked, 'is refused (headers cannot be forged)');
  await probe('anonymous status page', target.url + '/_ops/status', {}, blocked, 'is refused');
  await probe('anonymous photo fetch', target.url + '/api/manage/photos?image=x', {}, blocked, 'is refused');
  const history = wrangler(['deployments', 'list', ...target.envFlag], { allowFail: true });
  if (history) add('PASS', 'Release', `latest deployment: ${(history.match(/Created:\s+(\S+)[\s\S]*?(?=\n\nCreated:|$)/g) || []).pop()?.match(/Created:\s+(\S+)/)?.[1] ?? 'unknown'}`);
}

// ---- What a script cannot see: the Access application itself (needs the Zero Trust dashboard) ----
if (target.name === 'production') for (const text of [
  'Zero Trust → Access → Applications → catnr: the policy allows ONLY the intended email addresses (no "Everyone", no wildcard domain).',
  'Same application: Session duration is what you want (shorter = safer, longer = fewer sign-ins on a phone). 1 month is reasonable for one volunteer.',
  'Same application: the application domain covers catnr.bre999.workers.dev; the AUD tag matches ACCESS_AUD in wrangler.jsonc (PASS above shows the live site rejects anything without a valid token).',
  'Workers → catnr → Settings → Domains & Routes: workers.dev and Preview URLs are fine (the worker refuses requests without a valid Access token anyway), but a custom domain would also need to be added to the Access application.',
  'Account → Billing/Notifications: a usage alert exists (AI provider spend is capped in the OpenRouter dashboard, not here).',
]) add('CONFIRM', 'Dashboard', text);

const order = { FAIL: 0, WARN: 1, CONFIRM: 2, PASS: 3 };
console.log(`\nDeployment check: ${target.name} (${target.worker})${offline ? ' — offline checks only' : ''}\n`);
for (const r of [...results].sort((a, b) => order[a.status] - order[b.status])) console.log(`${r.status.padEnd(8)}${r.area.padEnd(16)}${r.text}`);
const fails = results.filter((r) => r.status === 'FAIL').length;
console.log(`\n${results.filter((r) => r.status === 'PASS').length} passed, ${fails} failed, ${results.filter((r) => r.status === 'WARN').length} warnings, ${results.filter((r) => r.status === 'CONFIRM').length} to confirm by hand.`);
process.exit(fails ? 1 : 0);
