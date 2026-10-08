import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { tsFileURL } from './load-ts.mjs';
// The money module has no imports of its own; tests load it as a data: URL like the other app modules.
const js = ts.transpileModule(await readFile(new URL('../../app/money.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
export const moneyURL = `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
// The report modules import more of the app than money does, so they are linked as the transpiled files.
const reportsURL = await tsFileURL('app/reports/queries.ts'), definitionsURL = await tsFileURL('app/reports/definitions.ts');
const logURL = await tsFileURL('app/ops/log.ts'), limitsURL = await tsFileURL('app/ops/limits.ts');
export const linkMoney = (src) => src.replaceAll('from "../../money"', `from "${moneyURL}"`).replaceAll('from "../../reports/queries"', `from "${reportsURL}"`).replaceAll('from "../../reports/definitions"', `from "${definitionsURL}"`).replaceAll('from "../../ops/log"', `from "${logURL}"`).replaceAll('from "../../ops/limits"', `from "${limitsURL}"`);
