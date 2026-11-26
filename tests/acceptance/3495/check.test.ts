// AC5 of #3495: the lint lane's text check holds the closed table to the design.
//
// The table is contracts/plain-states.json, beside the list of plain words (README, Pinned 1), and the check is
// `node scripts/plain-states-check.mjs`, a command of the lint lane in scripts/lanes.mjs (README, Pinned 2). Each
// planted table is a file this test writes under /tmp, the shipped table with one row changed, handed to the real check
// with `--table <file>`: the checkout never changes, and the check reads the design and the list of plain words from
// the checkout as it does for the shipped table. Any machine: it builds nothing and starts nothing.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CHECK_NAME, ID, namingFailures, passFailures, TABLE, type CheckRun } from './judges.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CHECK = 'scripts/plain-states-check.mjs';
const SHIPPED = 'contracts/plain-states.json';
const T = 10 * 60_000;
const made: string[] = [];
afterAll(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** The check, run from the checkout: on the shipped table, or on `table`. */
function check(table?: string): CheckRun {
  if (!existsSync(join(REPO, CHECK))) return { code: null, stdout: '', stderr: `the repo holds no check at ${CHECK}` };
  // deadline: a check that hangs is stopped and reads as a failure, never as a pass
  const ran = spawnSync(process.execPath, [join(REPO, CHECK), ...(table ? ['--table', table] : [])], { cwd: REPO, encoding: 'utf8', timeout: T, maxBuffer: 16 * 1024 * 1024 });
  return { code: ran.status, stdout: ran.stdout ?? '', stderr: `${ran.stderr ?? ''}${ran.error ? ` ${ran.error.message}` : ''}` };
}
type States = Record<string, string | null>;
/** The shipped table's rows, by the state's word; what's wrong with the file when it holds none. */
function shipped(): States | string {
  let read: string;
  try { read = readFileSync(join(REPO, SHIPPED), 'utf8'); } catch { return `the repo holds no table at ${SHIPPED}, beside contracts/plain-words.json`; }
  let states: unknown;
  try { states = (JSON.parse(read) as { states?: unknown } | null)?.states; } catch { return `${SHIPPED} isn't JSON`; }
  return states !== null && typeof states === 'object' && !Array.isArray(states) ? (states as States) : `${SHIPPED} holds no "states" object of rows by word`;
}
/** A planted table: the shipped one after `change`, in a file of its own under /tmp. */
function planted(change: (states: States) => void): string {
  const states = shipped();
  if (typeof states === 'string') return expect.fail(states);
  const copy = { ...states };
  change(copy);
  const dir = mkdtempSync('/tmp/ds3495-');
  made.push(dir);
  const file = join(dir, 'plain-states.json');
  writeFileSync(file, `${JSON.stringify({ states: copy }, null, 2)}\n`);
  return file;
}
const none = (failures: readonly string[], what: string): void => expect(failures.length, `${what}:\n${failures.join('\n')}\n`).toBe(0);
/** The shipped table passes the check: every planted table's test holds the real program to this first. */
const passes = (): void => none(passFailures(check()), 'the check passes the shipped table, which each planted table must fail');

describe(`AC5 ${ID.check} the check holds the table to the design`, () => {
  it(`AC5 ${ID.check}: the table holds a row for each word of States people see, the design's sentence for six and the word as it is for nine, and the lint lane's check passes it`, async () => {
    const states = shipped();
    if (typeof states === 'string') expect.fail(states);
    else {
      expect(Object.keys(states).sort(), `${SHIPPED} holds one row for each of the fifteen words`).toEqual(TABLE.map((t) => t.word).sort());
      for (const t of TABLE) expect(states[t.word], `${SHIPPED} gives ${t.word} ${t.sentence === null ? 'no sentence: the word reads as it is (null)' : "the design's sentence, word for word"}`).toBe(t.sentence);
    }
    const { checks } = (await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href)) as { checks: { name: string; commands: string[][] }[] };
    const lint = checks.filter((lane) => lane.name === 'lint');
    expect(lint.some((lane) => lane.commands.some((c) => c[0] === process.execPath && JSON.stringify(c.slice(1)) === JSON.stringify([CHECK]))), `the lint lane in scripts/lanes.mjs runs node ${CHECK}`).toBe(true);
    none(passFailures(check()), `node ${CHECK} on the shipped table ("PASS ${CHECK_NAME} …", exit 0)`);
  }, T);

  it(`AC5 ${ID.check} wrong program: a planted table with no row for INVALID fails, naming the state`, () => {
    passes();
    none(namingFailures(check(planted((states) => { delete states.INVALID; })), 'INVALID'), 'the check on a table with no row for INVALID');
  }, T);

  it(`AC5 ${ID.check} wrong program: a planted sentence that holds "passed" for PASS fails, naming the word`, () => {
    passes();
    const sentence = 'passed, and the checks agree';
    none(namingFailures(check(planted((states) => { states.PASS = sentence; })), 'passed', sentence), `the check on a table whose sentence for PASS is "${sentence}"`);
  }, T);

  it(`AC5 ${ID.check} wrong program: a planted sentence that holds "verdict" fails for any state, naming the word`, () => {
    passes();
    const failures = TABLE.flatMap((t) => {
      const sentence = t.sentence === null ? 'its verdict is still to come' : `${t.sentence}, by its verdict`;
      return namingFailures(check(planted((states) => { states[t.word] = sentence; })), 'verdict', sentence).map((f) => `with "${sentence}" for ${t.word}: ${f}`);
    });
    none(failures, 'the check on a table with "verdict" in one state\'s sentence, each of the fifteen states in turn');
  }, T);
});
