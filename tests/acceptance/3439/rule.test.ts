// #3439 AC1 (#3439.fead997e): "No file under `packages/` calls `setFlagsFromString`. A planted call fails the repo
// rule, naming the file and the line."
//
// The rule is reached only as `node scripts/repo-rules.mjs`, the lint lane's command: in this checkout, read-only, and
// in a scratch git repository that holds a copy of this checkout's scripts/ and the planted files (README: The rule).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { REPO, cleanup } from '../27/helpers.ts';
import { AC, listed, repoRules, scratch, type Rules } from './helpers.ts';

afterEach(cleanup, 120_000);

const NAME = 'setFlagsFromString';
/** A call of it, however it is reached: `setFlagsFromString(…)`, `v8.setFlagsFromString(…)`. */
const CALL = /\bsetFlagsFromString\s*\(/;
/** The rule's failures: each FAIL line with the indented lines under it, as one text. */
function failures(run: Rules): string[] {
  const blocks: string[] = [];
  let open = false;
  for (const line of run.lines) {
    if (/^(FAIL|INVALID|BLOCKED|PASS|NOTE)\b/.test(line)) {
      open = line.startsWith('FAIL');
      if (open) blocks.push(line);
    } else if (open && /^\s+\S/.test(line)) blocks[blocks.length - 1] += `\n${line}`;
  }
  return blocks;
}
/** Whether a failure names `path` and, on the same line, the line number `at`. */
const names = (block: string, path: string, at: number): boolean => block.split('\n').some((line) => line.includes(path) && RegExp(`(?<!\\d)${at}(?!\\d)`).test(line.split(path).join(' ')));

it(`${AC.rule} no file under packages/ calls setFlagsFromString, and the repo rule fails nothing of this checkout for it`, () => {
  // This suite's own reading of the tree, so the criterion's first sentence doesn't rest on the rule it also tests:
  // every file git lists under packages/, each line that calls it and isn't a comment's.
  const calls: string[] = [];
  for (const path of listed('packages')) {
    let text: string;
    try { text = readFileSync(join(REPO, path), 'utf8'); } catch { continue; }
    if (!text.includes(NAME) || text.slice(0, 8000).includes('\0')) continue;
    text.split('\n').forEach((line, index) => { if (CALL.test(line) && !/^\s*(\/\/|\/?\*)/.test(line)) calls.push(`${path}:${index + 1}`); });
  }
  expect(calls, `${AC.rule} no file under packages/ calls ${NAME}; these lines do: ${calls.join(', ')}`).toEqual([]);

  const run = repoRules(REPO);
  const failed = run.lines.filter((line) => /^(FAIL|INVALID|BLOCKED)\b/.test(line) && line.includes(NAME));
  expect(failed, `${AC.rule} node scripts/repo-rules.mjs fails nothing in this checkout over ${NAME}`).toEqual([]);
}, 900_000);

it(`${AC.rule} a planted call of setFlagsFromString under packages/ fails the repo rule, naming the file and the line`, () => {
  const filler = (lines: number) => Array.from({ length: lines }, (_, i) => `export const line${i + 1} = ${i + 1};`).join('\n');
  // A named import called at line 41 of a TypeScript source, and the module's member called at line 17 of a script.
  const named = { path: 'packages/hub/src/planted-settle.ts', at: 41, text: `import { ${NAME} } from 'node:v8';\n${filler(39)}\n${NAME}('--expose-gc');\n` };
  const member = { path: 'packages/cli/src/planted-member.mjs', at: 17, text: `import v8 from 'node:v8';\n${filler(15)}\nv8.${NAME}('--expose-gc');\n` };
  // The same file with the call's line taken out: the rule has nothing to name it for.
  const clean = { path: 'packages/hub/src/planted-clean.ts', text: `import { getHeapStatistics } from 'node:v8';\n${filler(39)}\nexport const heap = getHeapStatistics();\n` };
  const cwd = scratch({ [named.path]: named.text, [member.path]: member.text, [clean.path]: clean.text });
  const run = repoRules(cwd);
  const failed = failures(run);
  const said = `node scripts/repo-rules.mjs printed (exit ${run.status}):\n${run.lines.join('\n').slice(0, 3000)}\n${run.stderr.slice(0, 600)}`;
  for (const plant of [named, member])
    expect(failed.some((block) => names(block, plant.path, plant.at)), `${AC.rule} the planted call at ${plant.path}:${plant.at} fails the repo rule, in a FAIL that names the file and the line ${plant.at}; ${said}`).toBe(true);
  expect(failed.filter((block) => block.includes(clean.path)), `${AC.rule} a file under packages/ with no such call is named by no failure; ${said}`).toEqual([]);
}, 900_000);
