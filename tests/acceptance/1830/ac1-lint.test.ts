// #1830 AC1: a lint over tests/acceptance fails any judgeLimit call that gives no loads, naming the file and line; it
// lists none once the redrafts land.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { expect, test } from 'vitest';
import { checkout, copyScripts, lanes, lint, root, twins } from './helpers.ts';

/** Where the planted suite sits in a scratch checkout. */
const PLANTED = 'tests/acceptance/9830';

/**
 * Lays twins/lint/<set>/ into the scratch checkout `at` as a suite at PLANTED, each file without its .txt, and returns
 * `<path>:<line>` for each line the twins mark `// finding`.
 */
function plant(at: string, set: 'findings' | 'clean'): string[] {
  const from = join(twins, 'lint', set);
  const marked: string[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const source = join(directory, name);
      if (statSync(source).isDirectory()) {
        walk(source);
        continue;
      }
      const path = `${PLANTED}/${relative(from, source).replace(/\.txt$/, '')}`;
      mkdirSync(dirname(join(at, path)), { recursive: true });
      copyFileSync(source, join(at, path));
      readFileSync(source, 'utf8').split('\n').forEach((line, index) => {
        if (line.trimEnd().endsWith('// finding')) marked.push(`${path}:${index + 1}`);
      });
    }
  };
  walk(from);
  return marked.sort();
}

test('AC1 #1830.c80971bc the lint fails each planted judgeLimit call that gives no loads, by name, through its module, through a variable and inside a lane string, naming its file and line', () => {
  const at = checkout();
  const expected = [...plant(at, 'findings'), ...plant(at, 'clean')].sort();
  expect(expected, 'the planted findings').toHaveLength(8);
  const { result, fails, passes, output } = lint(at);
  expect([...fails].sort(), `the lint lists exactly the planted calls that give no loads:\n${output}`).toEqual(expected);
  expect(result.status, output).toBe(1);
  expect(passes, `no PASS line beside a finding:\n${output}`).toBe(0);
});

test('AC1 #1830.c80971bc calls that give loads or a spread, a local judgeLimit called with positional arguments, type signatures, comments, a README and a twins/ folder are not findings: the lint prints PASS loads', () => {
  const at = checkout();
  expect(plant(at, 'clean')).toEqual([]);
  const { result, fails, passes, output } = lint(at);
  expect(fails, `none of the planted calls is a finding:\n${output}`).toEqual([]);
  expect(passes, `one PASS loads line:\n${output}`).toBe(1);
  expect(result.status, output).toBe(0);
});

test('AC1 #1830.c80971bc an original a redraft replaced is listed with its file and line until its redraft folder exists under the root', async () => {
  const original = 'tests/acceptance/568/judge.test.mjs';
  const redraft = 'tests/acceptance/568-redraft-1830/';
  const { redrafted } = await lanes();
  expect(redrafted?.[original], `scripts/lanes.mjs's redrafted maps ${original} to ${redraft}`).toBe(redraft);
  // The original's calls, each on one line as judgeLimit({ ... }); its first line names one in a comment.
  const calls = readFileSync(join(root, original), 'utf8').split('\n').flatMap((line, index) =>
    /\bjudgeLimit\(\{/.test(line) && !line.trimStart().startsWith('//') ? [`${original}:${index + 1}`] : []);
  expect(calls.length, `${original} calls judgeLimit`).toBeGreaterThan(0);
  const at = checkout();
  copyScripts(original, at);
  const before = lint(at);
  expect([...before.fails].sort(), `with no redraft folder under the root, each call of the original is listed:\n${before.output}`).toEqual(calls.sort());
  expect(before.result.status, before.output).toBe(1);
  expect(copyScripts(redraft, at).length, `${redraft} holds the redraft's files`).toBeGreaterThan(0);
  const after = lint(at);
  expect(after.fails, `once ${redraft} exists under the root, the original is not read and the redraft's calls give loads:\n${after.output}`).toEqual([]);
  expect(after.passes, after.output).toBe(1);
  expect(after.result.status, after.output).toBe(0);
});

test('AC1 #1830.c80971bc over this checkout the lint lists none once the redrafts land, and the lint lane runs it', async () => {
  for (const at of [undefined, root]) {
    const { result, fails, passes, output } = lint(at);
    expect(fails, `the lint over this checkout${at ? ' (--root)' : ''} lists no judgeLimit call that gives no loads:\n${output}`).toEqual([]);
    expect(passes, output).toBe(1);
    expect(result.status, output).toBe(0);
  }
  const { checks } = await lanes();
  const lane = (checks as Array<{ name: string; commands: string[][] }>).find(({ name }) => name === 'lint');
  expect(lane?.commands.some((command) => command.some((part) => String(part).replaceAll('\\', '/').endsWith('scripts/loads-lint.mjs'))), 'the lint lane (scripts/lanes.mjs checks, name lint) runs scripts/loads-lint.mjs').toBe(true);
});
