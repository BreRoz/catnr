// Usage: node scripts/deploy.mjs production|staging [--dry-run]
// The only supported way to release. It refuses to continue if any safety step fails, and it makes sure
// the thing it deploys is the thing you asked for (a staging build can never go to production).
//   production: clean main branch -> lint -> tests -> BACKUP -> migrate -> build -> check build -> deploy -> verify
//   staging:    build for staging -> migrate staging -> check build -> deploy -> verify
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ENVIRONMENTS, root } from './lib/common.mjs';

const name = process.argv[2], dry = process.argv.includes('--dry-run');
const target = ENVIRONMENTS[name];
if (!target) { console.error('Usage: node scripts/deploy.mjs production|staging [--dry-run]'); process.exit(2); }
const env = { ...process.env, WRANGLER_LOG_PATH: path.join(root, '.wrangler/wrangler.log'), ...(name === 'staging' ? { CLOUDFLARE_ENV: 'staging' } : { CLOUDFLARE_ENV: '' }) };
const run = (cmd, args) => { console.log(`\n> ${cmd} ${args.join(' ')}`); if (!dry) execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env }); };
const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();
const fail = (m) => { console.error(`\nSTOPPED: ${m}`); process.exit(1); };

if (name === 'production') {
  if (out('git', ['status', '--porcelain'])) fail('there are uncommitted changes. Commit them first so the deployed code is the committed code.');
  if (out('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('production deploys come from the main branch.');
  run('npm', ['run', 'lint']);
  run('npm', ['test']);
  run('node', ['scripts/backup.mjs']);
}
run('npx', ['wrangler', 'd1', 'migrations', 'apply', target.database, '--remote', ...target.envFlag]);
run('npm', ['run', 'build']);
if (!dry) {
  const built = JSON.parse(readFileSync(path.join(root, 'dist/server/wrangler.json'), 'utf8'));
  if (built.name !== target.worker) fail(`the build is for worker "${built.name}", not "${target.worker}". Nothing was deployed.`);
  if (built.d1_databases?.[0]?.database_name !== target.database) fail(`the build is bound to database "${built.d1_databases?.[0]?.database_name}", not "${target.database}". Nothing was deployed.`);
  if (built.vars?.ENVIRONMENT !== name) fail(`the build says ENVIRONMENT=${built.vars?.ENVIRONMENT}, not ${name}. Nothing was deployed.`);
}
run('npx', ['wrangler', 'deploy']);
run('node', ['scripts/verify-deploy.mjs', '--env', name]);
console.log(`\nDeployed ${name}. To undo: npx wrangler rollback --name ${target.worker} (see docs/RUNBOOK.md).`);
