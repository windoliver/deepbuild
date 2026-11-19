// AC2: packages/cli/src holds no list of the five verdicts in order. The first test reads the real source; the
// rest prove the reader: it fails on a second list planted in a copy of that source, in each form a list takes,
// and passes on verdicts used one at a time and on prose in comments. Nothing under packages/ is written.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CLI_SRC, show, verdictLists, verdictListsUnder } from './helpers.ts';

const LABEL = 'packages/cli/src';
const temps: string[] = [];
afterAll(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });
/** A copy of packages/cli/src in a temporary folder: the planted twin's start. */
function twin(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-1882-twin-'));
  temps.push(dir);
  cpSync(CLI_SRC, dir, { recursive: true });
  return dir;
}

// A second list, in each form one takes. Every plant is appended to the real main.ts, so its first line is known.
const PLANTS: { form: string; code: string }[] = [
  { form: "the base's own array", code: "const order2: string[] = ['FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'PASS'];" },
  { form: "the design's order, double-quoted, as const, over several lines with a comment between entries", code: 'const order2 = [\n  "FAIL",\n  "INVALID", // above BLOCKED\n  "BLOCKED",\n  /* then */ "INCONCLUSIVE",\n  "PASS",\n] as const;' },
  { form: 'a reversed array in backticks', code: 'const order2 = [`PASS`, `INCONCLUSIVE`, `BLOCKED`, `INVALID`, `FAIL`];' },
  { form: 'a record of ranks', code: 'const rank2: Record<string, number> = { FAIL: 0, BLOCKED: 1, INVALID: 2, INCONCLUSIVE: 3, PASS: 4 };' },
  { form: 'a map of pairs', code: "const rank2 = new Map<string, number>([['FAIL', 0], ['INVALID', 1], ['BLOCKED', 2], ['INCONCLUSIVE', 3], ['PASS', 4]]);" },
  { form: 'one string split into five', code: "const order2 = 'FAIL BLOCKED INVALID INCONCLUSIVE PASS'.split(' ');" },
  { form: 'a switch that ranks', code: "function rank2(v: string): number {\n  switch (v) {\n    case 'FAIL': return 0;\n    case 'BLOCKED': return 1;\n    case 'INVALID': return 2;\n    case 'INCONCLUSIVE': return 3;\n    case 'PASS': return 4;\n    default: return 5;\n  }\n}" },
  { form: 'a chain of comparisons', code: "const rank2 = (v: string): number => (v === 'FAIL' ? 0 : v === 'BLOCKED' ? 1 : v === 'INVALID' ? 2 : v === 'INCONCLUSIVE' ? 3 : v === 'PASS' ? 4 : 5);" },
  { form: 'a union type', code: "type Order2 = 'FAIL' | 'INVALID' | 'BLOCKED' | 'INCONCLUSIVE' | 'PASS';" },
];

describe('AC2 packages/cli/src holds no list of the five verdicts in order', () => {
  it('AC2 no file under packages/cli/src holds a list of the five verdicts', () => {
    const { files, hits } = verdictListsUnder(CLI_SRC, LABEL);
    expect(files, 'precondition: the reader read the CLI source').toContain('main.ts');
    expect(hits.map(show), 'AC2: packages/cli/src keeps no order of its own; the worst verdict is conformance\'s').toEqual([]);
  });

  it.each(PLANTS)('AC2 the reader fails on a second list planted in main.ts: $form', ({ code }) => {
    const dir = twin();
    const before = verdictListsUnder(dir, LABEL).hits.map(show);
    const real = readFileSync(join(dir, 'main.ts'), 'utf8');
    const first = real.split('\n').length + 1;
    writeFileSync(join(dir, 'main.ts'), `${real}\n${code}\n`);
    const after = verdictListsUnder(dir, LABEL).hits;
    const planted = after.filter((hit) => hit.file === `${LABEL}/main.ts` && hit.line >= first);
    expect(planted.map(show), 'the planted list is reported, once, in main.ts, at its own lines').toHaveLength(1);
    expect(planted[0]!.line).toBeLessThanOrEqual(first + 3);
    expect(after.map(show), 'and nothing else is').toEqual([...before, show(planted[0]!)]);
  });

  it('AC2 the reader fails on a second list planted in a new file at any depth', () => {
    const dir = twin();
    const before = verdictListsUnder(dir, LABEL).hits.map(show);
    mkdirSync(join(dir, 'run', 'lib'), { recursive: true });
    writeFileSync(join(dir, 'run', 'lib', 'rank.ts'), `// ranks\nexport const order = ['FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE', 'PASS'];\n`);
    writeFileSync(join(dir, 'ranks.mjs'), `export const ranks = { FAIL: 0, INVALID: 1, BLOCKED: 2, INCONCLUSIVE: 3, PASS: 4 };\n`);
    const after = verdictListsUnder(dir, LABEL).hits.map(show);
    expect(after).toEqual([...before, `${LABEL}/ranks.mjs:1 lists FAIL, INVALID, BLOCKED, INCONCLUSIVE, PASS`, `${LABEL}/run/lib/rank.ts:2 lists FAIL, BLOCKED, INVALID, INCONCLUSIVE, PASS`].sort((a, b) => a.localeCompare(b)));
  });

  it('AC2 the reader passes verdicts used one at a time, four of the five, and the precedence line in a comment', () => {
    const clean = [
      '// The worst verdict is conformance\'s: FAIL > INVALID > BLOCKED > INCONCLUSIVE > PASS.',
      '/** One of FAIL, INVALID, BLOCKED, INCONCLUSIVE and PASS. */',
      'export function run(verdicts: string[], tests: number, passed: number, say: (verdict: string, message: string) => number): number {',
      '  /* never PASS: FAIL, INVALID, BLOCKED or INCONCLUSIVE */',
      "  if (!verdicts.every((v) => v === 'PASS')) return say(verdicts[0]!, 'not a pass');",
      "  if (tests === 0) return say('INVALID', 'run outcome passed with no tests run: a run that ran nothing proves nothing');",
      "  if (passed !== tests) return say('INVALID', 'the counts do not agree with the outcome');",
      "  return say('PASS', 'run code passed reads PASS');",
      '}',
      "export const help = 'deep land [judge]   judge each open PR, or land the PASSes one at a time';",
      "export const undecided = ['INVALID', 'BLOCKED', 'INCONCLUSIVE'];",
      "export const notPass = ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'];",
      "export const failed = 'FAILED'; export const PASS_MARK = 'ok'; export const blocked = 'BLOCKED';",
    ].join('\n');
    expect(verdictLists(clean, 'clean.ts').map(show)).toEqual([]);
    // The same text with the comment's line as code is a list: comments are what was skipped, not the names.
    expect(verdictLists(`${clean}\nexport const line = 'FAIL > INVALID > BLOCKED > INCONCLUSIVE > PASS';`, 'clean.ts').map(show)).toEqual(['clean.ts:14 lists FAIL, INVALID, BLOCKED, INCONCLUSIVE, PASS']);
  });
});
