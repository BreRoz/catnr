// Starts everything the browser tests need and keeps it running until stopped:
//   1. a scripted fake AI provider,
//   2. a fresh local database built from the checked-in migrations only,
//   3. the app itself, as the "e2e" wrangler environment (no Access sign-in, localhost identity, fake AI URL).
// Playwright launches this through `webServer` (see playwright.config.mjs).
import { spawn, execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startFakeAi } from './fake-ai.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const state = path.join(root, '.wrangler-e2e');
const AI_PORT = 8788, APP_PORT = Number(process.env.E2E_PORT || 3100);
const env = { ...process.env, CLOUDFLARE_ENV: 'e2e', E2E_STATE_DIR: state, WRANGLER_LOG_PATH: path.join(root, '.wrangler/wrangler.log'), WRANGLER_SEND_METRICS: 'false' };

rmSync(state, { recursive: true, force: true });
mkdirSync(state, { recursive: true });
// Per-environment dev vars: the fake key only switches the AI path on; the URL only works because ENVIRONMENT=e2e.
writeFileSync(path.join(root, '.dev.vars.e2e'), `OPENROUTER_API_KEY=e2e-fake-key\nAI_TEST_BASE_URL=http://127.0.0.1:${AI_PORT}/v1/chat/completions\n`);

// An (empty) per-environment file stops a developer's own .dev.vars - which blanks the Access settings - from applying.
writeFileSync(path.join(root, '.dev.vars.e2e-locked'), '# intentionally empty\n');
await startFakeAi(AI_PORT);
execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'catnr-e2e-db', '--local', '--env', 'e2e', '--persist-to', state], { cwd: root, stdio: 'inherit', env });
const app = spawn('npx', ['vinext', 'dev', '--port', String(APP_PORT)], { cwd: root, stdio: 'inherit', env });
// A second copy with the real (production) Access settings and its own empty state: it must refuse everyone (signin.spec.mjs).
const locked = spawn('npx', ['vinext', 'dev', '--port', String(APP_PORT + 1)], { cwd: root, stdio: 'inherit', env: { ...env, CLOUDFLARE_ENV: 'e2e-locked', E2E_STATE_DIR: path.join(state, 'locked') } });
const stop = () => { app.kill('SIGTERM'); locked.kill('SIGTERM'); rmSync(path.join(root, '.dev.vars.e2e'), { force: true }); rmSync(path.join(root, '.dev.vars.e2e-locked'), { force: true }); process.exit(0); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
app.on('exit', (code) => process.exit(code ?? 1));
