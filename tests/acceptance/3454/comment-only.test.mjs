// #3454 acceptance, AC6: `scripts/comment-only.mjs <path>` says whether the files changed under a path hold the code
// their merge base does, comments and white space aside. Each change is a commit on top of the scratch repository's
// base, with origin/main left at the base. The change that removes only comments passes first, so a script that fails
// everything can't satisfy a test, and one that passes everything fails the plant.
import test from 'node:test';
import { assertFailsNaming, assertNotNamed, assertPasses, commentOnly, commit, onlyScript, put, repo } from './helpers.mjs';

const SUM = 'packages/fixture/src/sum.ts';
const SCALE = 'packages/other/src/scale.ts';

/** The file at the base, with a comment of each kind, one of them the only thing between `typeof` and `b`. */
const commentedSum = [
  '// Adds two counts.',
  'export function sum(a: number, b: number): number {',
  '  /* both */ return a /* left */ + b; // the total',
  '}',
  '',
  '/**',
  ' * Says what kind a value is.',
  ' */',
  'export const kind = (b: unknown): string => typeof/* of */b;',
  '',
].join('\n');

/** The same code with no comment: `operator` between a and b, and `kindOf` as the last expression. */
const bare = ({ operator = '+', kindOf = 'typeof b' } = {}) => [
  'export function sum(a: number, b: number): number {',
  `  return a ${operator} b;`,
  '}',
  '',
  `export const kind = (b: unknown): string => ${kindOf};`,
  '',
].join('\n');

const scale = (by) => `export const scale = (n: number): number => n * ${by};\n`;
const start = (t) => repo(t, { [SUM]: commentedSum, [SCALE]: scale(2) });

test('#3454.74c0b5ea AC6: scripts/comment-only.mjs passes a change that removes only comments, and fails one that edits a line of code, naming the file; a code edit outside the path is not its to judge', (t) => {
  onlyScript();
  const cwd = start(t);
  put(cwd, SUM, bare());
  put(cwd, SCALE, scale(3));
  commit(cwd, 'comments removed under packages/fixture; code edited under packages/other');
  const removed = commentOnly(cwd, 'packages/fixture');
  assertNotNamed(removed, SUM);
  assertPasses(removed, `(${SUM} lost its comments and nothing else; ${SCALE} is outside the path)`);
  assertFailsNaming(commentOnly(cwd, 'packages/other'), SCALE, '(n * 2 became n * 3 under this path)');
  put(cwd, SUM, bare({ operator: '-' }));
  commit(cwd, 'a line of code edited');
  assertFailsNaming(commentOnly(cwd, 'packages/fixture'), SUM, '(return a + b became return a - b)');
});

test('#3454.74c0b5ea AC6: scripts/comment-only.mjs passes typeof/* of */b turned into typeof b, and fails it turned into typeofb, naming the file', (t) => {
  onlyScript();
  const cwd = start(t);
  put(cwd, SUM, bare());
  commit(cwd, 'comments removed, a space where one held two tokens apart');
  assertPasses(commentOnly(cwd, 'packages/fixture'), '(typeof/* of */b became typeof b: the same tokens)');
  put(cwd, SUM, bare({ kindOf: 'typeofb' }));
  commit(cwd, 'the comment between typeof and b removed with nothing in its place');
  assertFailsNaming(commentOnly(cwd, 'packages/fixture'), SUM, '(typeof/* of */b became typeofb: one name where two tokens were)');
});
