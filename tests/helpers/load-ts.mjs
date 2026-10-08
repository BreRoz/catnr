import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from 'typescript';

// Loads a TypeScript module (and every relative module it imports) without a bundler: each file is
// transpiled into a temp directory with its relative imports pointed at the transpiled copies.
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = await mkdtemp(path.join(tmpdir(), 'catnr-ts-'));
const done = new Map();

async function transpile(file) {
  if (done.has(file)) return done.get(file);
  const target = path.join(out, path.relative(root, file)).replace(/\.tsx?$/, '.mjs');
  done.set(file, target);
  // The Worker's runtime import is replaced by an object the test supplies (see helpers/assistant.mjs).
  const source = (await readFile(file, 'utf8')).replace(/import \{ env \} from "cloudflare:workers";/, 'const env = globalThis.__catnrEnv;');
  let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const specifiers = [...js.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
  for (const spec of new Set(specifiers)) {
    const base = path.resolve(path.dirname(file), spec);
    const resolved = ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find(existsSync);
    if (!resolved) throw new Error(`Cannot resolve ${spec} from ${file}`);
    const dep = await transpile(resolved);
    let relative = path.relative(path.dirname(target), dep);
    if (!relative.startsWith('.')) relative = `./${relative}`;
    js = js.replaceAll(`"${spec}"`, `"${relative}"`).replaceAll(`'${spec}'`, `'${relative}'`);
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, js);
  return target;
}

export const loadTs = async (relative) => import(pathToFileURL(await transpile(path.join(root, relative))).href);

/** file: URL of the transpiled copy, for tests that stitch modules together by source replacement. */
export const tsFileURL = async (relative) => pathToFileURL(await transpile(path.join(root, relative))).href;
