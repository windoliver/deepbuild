// Shared test-side tools for issue #1348's acceptance tests (README): the word list kept in the repo, the lane that
// fails a listed word, run exactly as scripts/lanes.mjs lists its commands, and the dump of every string the lane's
// fixture run shows. Nothing here stands in for DeepBuild: every string judged comes from the lane's own dump, and
// every verdict on a string is read against the repo's own word list.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
/** The one word list in the repo (README, contract 1). */
export const WORD_LIST = join(REPO, 'contracts/plain-words.json');
/** The lane's name in `checks` of scripts/lanes.mjs (README, contract 2). */
export const LANE = 'plain words';

/** Each criterion's ID: `#1348.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #1348.d4f7c3ae';
export const AC2 = 'AC2 #1348.51e3c238';
export const AC3 = 'AC3 #1348.97af66a9';
export const AC4 = 'AC4 #1348.bf9fc2cc';

/** The planted card line, and the same line on a session's page (README, plants). */
export const PR_LINE = 'PR #12 is ready for review';
/** The planted failure's output, a stack trace, as the fixture run's failure for the task `Cart totals` carries it. */
export const TRACE = readFileSync(fileURLToPath(new URL('./fixtures/trace.txt', import.meta.url)), 'utf8').trimEnd();
export const TRACE_LINES = TRACE.split('\n').map((line) => line.trim()).filter(Boolean);
/** Pieces of the trace that no plain surface may show: its error, its frames' names, its paths and its line numbers. */
export const TRACE_PIECES = ['TypeError', 'Cannot read properties', 'sumCart', 'applyDiscount', '/srv/shop', 'cart.ts', 'discount.ts', ':41:17', ':12:5'];
export const FAILED_TASK = 'Cart totals';

/** The surfaces that use only plain words (the issue's Scope). Every other surface in a dump is a detail view. */
export const PLAIN = ['card', 'page', 'notification', 'end_notice', 'deep'] as const;
/** The four the fixture run must show, each at least once (AC2). */
export const FOUR = ['card', 'page', 'notification', 'end_notice'] as const;
/** The plain words the issue gives. */
export const EXPECTED: Record<string, string> = { issue: 'task', landed: 'finished', verdict: 'result', session: 'agent at work' };
/** The internal words the issue names (its title and its problem), each of which the list must map. */
export const NAMED = ['issue', 'PR', 'commit', 'branch', 'landed', 'verdict', 'session', 'repo'];

export const isPlain = (surface: string): boolean => (PLAIN as readonly string[]).includes(surface);

/**
 * The word list, read from the repo. Fails, never passes, when it is missing, empty, or lacks a word or a plain word
 * the issue gives, so no test here can pass on an empty list.
 */
export function words(): Record<string, string> {
  if (!existsSync(WORD_LIST)) throw Error(`BLOCKED: no word list at ${WORD_LIST}`);
  const read = JSON.parse(readFileSync(WORD_LIST, 'utf8')) as { words?: unknown };
  const list = read.words;
  if (typeof list !== 'object' || list === null || Array.isArray(list)) throw Error(`${WORD_LIST}: "words" is not an object of internal word to plain word`);
  for (const [word, plain] of Object.entries(list)) {
    if (typeof plain !== 'string' || !plain.trim()) throw Error(`${WORD_LIST}: "${word}" has no plain word`);
  }
  const map = list as Record<string, string>;
  const missing = NAMED.filter((word) => !(word in map));
  if (missing.length) throw Error(`${WORD_LIST} maps none of: ${missing.join(', ')}`);
  for (const [word, plain] of Object.entries(EXPECTED)) {
    if (map[word] !== plain) throw Error(`${WORD_LIST} maps "${word}" to ${JSON.stringify(map[word])}, not "${plain}"`);
  }
  return map;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The listed words a text holds, read here, independently of the lane: whole words, any case, with a plural ending. */
export function listedIn(text: string, list: Record<string, string>): string[] {
  return Object.keys(list).filter((word) => new RegExp(`(?<![A-Za-z0-9])${escape(word)}(?:s|es)?(?![A-Za-z0-9])`, 'i').test(text));
}

export type Shown = { surface: string; text: string; row?: string };
export type Row = { id: string; problem: null | { happened: string; next: string } };
export type Dump = { shown: Shown[]; rows: Row[] };
export type LaneRun = { status: number; output: string; dump: Dump };

/** The dump's shape (README, contract 3), checked whole: a missing or malformed field is missing evidence, never a pass. */
function readDump(path: string): Dump {
  if (!existsSync(path)) throw Error(`the lane wrote no dump at $DEEP_PLAIN_WORDS_DUMP (${path})`);
  const dump = JSON.parse(readFileSync(path, 'utf8')) as Partial<Dump>;
  if (!Array.isArray(dump.shown)) throw Error('the dump has no "shown" list');
  if (!Array.isArray(dump.rows)) throw Error('the dump has no "rows" list');
  for (const item of dump.shown) {
    if (typeof item?.surface !== 'string' || typeof item.text !== 'string') throw Error(`a shown string without a surface or text: ${JSON.stringify(item)}`);
    if ('row' in item && typeof item.row !== 'string') throw Error(`a shown string whose row is not an id: ${JSON.stringify(item)}`);
  }
  for (const row of dump.rows) {
    if (typeof row?.id !== 'string') throw Error(`a row without an id: ${JSON.stringify(row)}`);
    const problem = row.problem;
    if (problem !== null && (typeof problem?.happened !== 'string' || typeof problem.next !== 'string')) throw Error(`row ${row.id}: problem is neither null nor {happened, next}`);
  }
  return dump as Dump;
}

type Lane = { name: string; commands: string[][] };

/**
 * Runs the lane named `plain words` exactly as scripts/lanes.mjs lists it: each command in order, from the repo's root,
 * with DEEP_HUB_PLANT set to `plant` (or unset) and DEEP_PLAIN_WORDS_DUMP naming a fresh file. The lane's status is
 * its first command's non-zero exit, else 0, as a lane fails on any command that fails.
 */
export async function lane(plant?: string): Promise<LaneRun> {
  const lanes = (await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href)) as { checks?: Lane[] };
  const found = lanes.checks?.find((entry) => entry.name === LANE);
  if (!found) throw Error(`BLOCKED: scripts/lanes.mjs lists no lane named "${LANE}" in checks`);
  if (!found.commands.length) throw Error(`BLOCKED: the "${LANE}" lane runs no command`);
  const dir = mkdtempSync(join(tmpdir(), 'dp1348-'));
  const dumpPath = join(dir, 'dump.json');
  const env: NodeJS.ProcessEnv = { ...process.env, DEEP_PLAIN_WORDS_DUMP: dumpPath };
  delete env.DEEP_HUB_PLANT;
  if (plant) env.DEEP_HUB_PLANT = plant;
  let status = 0;
  let output = '';
  try {
    for (const [command, ...args] of found.commands) {
      const run = spawnSync(command!, args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: 40 * 60_000 });
      if (run.error) throw Error(`BLOCKED: the "${LANE}" lane's command ${command} ${args.join(' ')} did not run: ${run.error.message}`);
      output += `${run.stdout ?? ''}\n${run.stderr ?? ''}\n`;
      if (status === 0 && run.status !== 0) status = run.status ?? 1;
    }
    return { status, output, dump: readDump(dumpPath) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The page strings of the row a text names, and that row. Fails when no page row shows the text. */
export function rowShowing(dump: Dump, text: string): { row: Row; strings: string[] } {
  const id = dump.shown.find((item) => item.surface === 'page' && item.row !== undefined && item.text.includes(text))?.row;
  if (id === undefined) throw Error(`no page row shows "${text}"`);
  const row = dump.rows.find((entry) => entry.id === id);
  if (!row) throw Error(`the page shows "${text}" in row ${id}, which "rows" doesn't list`);
  return { row, strings: dump.shown.filter((item) => item.surface === 'page' && item.row === id).map((item) => item.text) };
}

/** Lane output lines, for a failure message. */
export const tail = (output: string, lines = 40): string => output.trim().split('\n').slice(-lines).join('\n');
