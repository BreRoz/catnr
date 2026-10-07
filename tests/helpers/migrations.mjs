import { readdir, readFile } from 'node:fs/promises';
// Every checked-in migration, in order. Tests build databases from these files alone.
const dir = new URL('../../drizzle/', import.meta.url);
export const migrationNames = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
export const migrations = await Promise.all(migrationNames.map((f) => readFile(new URL(f, dir), 'utf8')));
