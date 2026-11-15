// #1888 AC3: `packages/gate/src` holds one function that reads a Makefile rule. The sources are read, never run:
// `readers.ts` finds the functions by what their code does, knowing no name or file. The same reading then runs on
// temp copies of the sources with a second reader planted, in two styles, which it must find, and with two functions
// planted that read lines but no Makefile rule, which it must not. No tracked file is changed.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { named, readersUnder, sourcesUnder, type Reader } from './readers.ts';

const AC3 = '#1888.b67d81e0';
const SRC = fileURLToPath(new URL('../../../packages/gate/src', import.meta.url));

const made: string[] = [];
afterAll(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

/** The criterion: the sources hold one function that reads a Makefile rule. */
const holdsOne = (readers: readonly Reader[]): boolean => readers.length === 1;
const key = (readers: readonly Reader[]): string[] => readers.map((r) => `${r.file} ${r.name}`).sort();

/** A second reader, written as neither of the base's two is: regular expressions for the rule's header and its recipe. */
const PLANT_REGEX = `
function plantedRecipe1888(makefile: string, goal: string): string | null {
  const rows = makefile.split('\\n');
  const head = rows.findIndex((row) => new RegExp(\`^(?:\\\\S+ +)*\${goal}(?: +\\\\S+)* *:\`).test(row));
  if (head < 0) return null;
  let end = head + 1;
  while (end < rows.length && /^\\t/.test(rows[end]!)) end += 1;
  return rows.slice(head + 1, end).map((row) => row.slice(1)).join('\\n');
}
`;
/** A second reader with no regular expression: the colon and the tab as strings. */
const PLANT_STRINGS = `
export const plantedRule1888 = (makefile: string, goal: string): string[] => {
  const rows = makefile.split('\\n');
  const head = rows.findIndex((row) => !row.startsWith('\\t') && row.includes(':') && row.slice(0, row.indexOf(':')).split(' ').includes(goal));
  const recipe: string[] = [];
  for (let i = head + 1; head >= 0 && i < rows.length && rows[i]!.startsWith('\\t'); i += 1) recipe.push(rows[i]!.slice(1));
  return recipe;
};
`;
/** Two functions that read lines and colons but no Makefile rule: a detector that counted these would prove nothing. */
const PLANT_TWINS = `
function plantedHeaders1888(text: string): Record<string, string> {
  return Object.fromEntries(text.split('\\n').map((row) => /^\\s*([\\w-]+)\\s*:\\s*(.*)$/.exec(row)).filter((m) => m !== null).map((m) => [m[1]!, m[2]!]));
}
const plantedOutdent1888 = (text: string): string => text.split('\\n').map((row) => row.replace(/^\\s+/, '').split('\\t').join(' ')).join('\\n');
`;

/** The readers in a temp copy of the sources with `plant` added at the end of `file`. */
function readersWith(file: string, plant: string): Reader[] {
  const copy = mkdtempSync(join(tmpdir(), 'deep-1888-src-'));
  made.push(copy);
  cpSync(SRC, copy, { recursive: true });
  writeFileSync(join(copy, file), `${readFileSync(join(copy, file), 'utf8')}\n${plant}`);
  return readersUnder(copy);
}

it(`${AC3} packages/gate/src holds one function that reads a Makefile rule: a planted second reader fails this reading of the sources`, () => {
  if (!existsSync(SRC) || sourcesUnder(SRC).length === 0) throw new Error(`BLOCKED: no TypeScript source under ${SRC}`);
  const before = readFileSync(join(SRC, sourcesUnder(SRC)[0]!), 'utf8');
  const real = readersUnder(SRC);
  // The plants go where no reader is, so each is one more function, never a change to one found.
  const elsewhere = sourcesUnder(SRC).find((file) => !real.some((r) => r.file === file));
  if (elsewhere === undefined) throw new Error('BLOCKED: every source file holds a reader, so no file is free for the plant');

  // The detector, proven on its plants before its count is read.
  const plants: [string, string, string][] = [['regular expressions', 'plantedRecipe1888', PLANT_REGEX], ['strings', 'plantedRule1888', PLANT_STRINGS]];
  for (const [style, name, plant] of plants) {
    const planted = readersWith(elsewhere, plant);
    expect.soft(key(planted), `a second reader written with ${style}, planted in a copy of ${elsewhere}, is found, and nothing else changes`).toEqual([...key(real), `${elsewhere} ${name}`].sort());
    if (holdsOne(real)) expect.soft(holdsOne(planted), `with the second reader (${style}) planted, the sources no longer hold one: ${named(planted)}`).toBe(false);
  }
  expect.soft(key(readersWith(elsewhere, PLANT_TWINS)), 'two planted functions that read lines and colons, but no Makefile rule, are not counted').toEqual(key(real));
  expect.soft(readFileSync(join(SRC, sourcesUnder(SRC)[0]!), 'utf8'), 'the sources themselves are untouched').toBe(before);

  // The criterion.
  expect.soft(real.length, real.length === 0
    ? 'no function under packages/gate/src reads as a Makefile rule reader, though the floor reads Makefile rules (AC2): the reader is outside what this detector sees (README, its limits), or outside packages/gate/src'
    : `packages/gate/src holds ${real.length} functions that read a Makefile rule, not one: ${named(real)}`).toBe(1);
  expect(holdsOne(real)).toBe(true);
});
