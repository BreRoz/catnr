import { readdir, readFile } from 'node:fs/promises';
import { loadTs } from './load-ts.mjs';

// The assistant API (app/api/assistant) is a set of small modules behind route.ts. Tests load the real modules
// (transpiled, not mocked); only the Worker's `cloudflare:workers` import is replaced, by `env` below.
export const loadRoute = async (env) => {
  globalThis.__catnrEnv = env;
  return loadTs('app/api/assistant/route.ts');
};

/** The text of every module in app/api/assistant, (plus app/config.ts), for tests that check a source-level contract. */
export const assistantSource = async () => {
  const dir = new URL('../../app/api/assistant/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.ts')).sort();
  const config = await readFile(new URL('../../app/config.ts', import.meta.url), 'utf8');
  return [config, ...(await Promise.all(files.map((f) => readFile(new URL(f, dir), 'utf8'))))].join('\n');
};

/** The home screen is a container (app/rescue-client.tsx) plus small components in app/home; this is all of them. */
export const homeScreenSource = async () => {
  const dir = new URL('../../app/home/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.tsx')).sort();
  const parts = await Promise.all(files.map((f) => readFile(new URL(f, dir), 'utf8')));
  return [await readFile(new URL('../../app/rescue-client.tsx', import.meta.url), 'utf8'), ...parts].join('\n');
};
