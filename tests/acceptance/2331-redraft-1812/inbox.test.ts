// #2331, its first criterion (#2331.04651a1b): `deep inbox` over asks with a default constructs no date or number
// formatter, counted by count-formatters.cjs preloaded into its process (NODE_OPTIONS=--require), here with the hub down.
// A blind redraft after #1812 (REDRAFT.md) of the second test of tests/acceptance/2331/inbox.test.ts, the one test of
// that suite whose expectation #1812 changes; the file's first test, with the hub up, stands as it is. Everything here is
// the frozen test's, copied unchanged, except its check (c), the line that says the hub isn't answering:
// - #1812 makes that line one sentence, the same from every command: that the hub isn't answering, since when if the
//   record says, and the one fix, `deep hub start` in a home that is set up, else `deep setup`; BLOCKED stays a verdict's
//   word (#1812's Scope, its first item; the design's deep CLI row; #1812's suite, Surfaces 1). The sentence may be on
//   stdout or stderr and other lines may be printed (#1812's suite, Surfaces 1 and its reading 4), so it is read as
//   #1812's suite reads it, the first line of the output, stdout then stderr, that says the hub isn't answering, no
//   longer stdout's first line held to the base's words. This home is set up: makeWorld writes #1002's
//   setup-finished.json, the marker the CLI reads, so the one fix is `deep hub start`.
// - What #2331 held of the line is kept: it says since when as today's clock writes it, "since HH:MM" at a minute the
//   hub could have stopped, the time whole, and deep inbox constructs no formatter to write it.
//
// The world is #1463's (makeWorld, unchanged): a real hub in a temp HOME, on its clock at noon today in Asia/Kolkata,
// one session with three open asks whose defaults fall today, tomorrow and in three days, so `when` takes each of its
// three forms. The CLI is the built one (packages/cli/dist/main.js), started from this process with no agent above it.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { cleanup, makeWorld, next1640, NOON, shown, stopHub, type SessionSpec, type World } from '../1463/helpers.ts';
import { deep, tempDir, type Ran } from '../16/helpers.ts';
import { baseParts, countedIn, type Counted, ID, madeText, MINUTE, preloadEnv, whenFrom } from '../2331/kit.ts';

afterAll(cleanup, 60_000);

// ---- Copied unchanged from tests/acceptance/2331/inbox.test.ts: the fixture, the run and the checks (b) and (e).

/** `days` on from `from`'s day, at hh:mm in this process's zone. */
const dayAt = (days: number, hh: number, mm: number) => (from: number): number => {
  const d = new Date(from);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hh, mm).getTime();
};
const SPECS: SessionSpec[] = [
  { key: 'cart', repo: 'shop', title: 'Cart totals', calls: 1, stop: true, asks: [
    { kind: 'choice', question: 'Ship the cart page today?', options: [['yes', 'Yes'], ['no', 'No']], default: 'no', deadline: next1640 },
    { kind: 'choice', question: 'Merge the tax fix in the morning?', options: [['yes', 'Yes'], ['wait', 'Wait a day']], default: 'wait', deadline: dayAt(1, 7, 5) },
    { kind: 'taste', question: 'Which header colour on the login page?', options: [['blue', 'Blue header'], ['green', 'Green header']], default: 'blue', deadline: dayAt(3, 9, 5) },
  ] },
];

/** When this file began its world, by the wall clock. */
let begun = 0;
let made: Promise<World> | undefined;
function world(): Promise<World> {
  if (!made) {
    begun = Date.now();
    made = makeWorld(SPECS, { clock: NOON });
  }
  return made;
}

/** An open ask's row as `deep inbox --json` gives it (#1463): its handle, question, default's label and deadline. */
interface AskRow { id: string; title: string; default: string; default_at: number }
let rows: AskRow[] | undefined;
/** The fixture's asks, read once with the hub up; BLOCKED unless all three are there with their defaults. */
async function askRows(w: World): Promise<AskRow[]> {
  if (rows) return rows;
  const r = await deep(w.home, ['inbox', '--json'], { timeoutMs: 120_000 });
  let parsed: unknown;
  try { parsed = (JSON.parse(r.stdout) as { rows?: unknown }).rows; } catch { parsed = undefined; }
  const found = (Array.isArray(parsed) ? (parsed as AskRow[]) : []).filter((a) => typeof a?.id === 'string' && a.id.startsWith('ask:') && typeof a.default === 'string' && typeof a.default_at === 'number');
  if (found.length !== 3) throw Error(`BLOCKED: deep inbox --json doesn't hold the fixture's three asks with a default: ${shown(r)}`);
  return (rows = found);
}

/** `deep inbox` with the preload in its process: what it printed, when it ran, and each record the preload wrote. */
async function countedInbox(w: World): Promise<{ ran: Ran; before: number; after: number; records: Counted[] }> {
  const dir = join(tempDir(), 'formatters');
  mkdirSync(dir);
  const before = Date.now();
  const ran = await deep(w.home, ['inbox'], { env: preloadEnv(dir), timeoutMs: 120_000 });
  return { ran, before, after: Date.now(), records: countedIn(dir) };
}

/** No record from deep inbox's own process, or any formatter made, each named with where it was made. */
function formatterFailures(records: readonly Counted[]): string[] {
  if (!records.some((c) => c.argv.includes('inbox'))) return [`the preload left no record from deep inbox's process, so nothing was counted (records from: ${JSON.stringify(records.map((c) => c.argv))})`];
  const all = records.flatMap((c) => c.made);
  return all.length ? [`deep inbox constructed ${all.length} date or number formatter${all.length === 1 ? '' : 's'}:\n  ${madeText(all)}`] : [];
}

/** Today's text for each ask's default, for a `now` from just before the run to just after it. */
const wantedDefaults = (a: AskRow, nows: readonly number[]): string[] => {
  const when = whenFrom(baseParts());
  return [...new Set(nows.map((now) => `If you don't answer: ${a.default}, ${when(a.default_at, now)}`))];
};
/** Each ask's line, the one holding its handle, holds its default and its time as the base writes them. */
function defaultFailures(stdout: string, asks: readonly AskRow[], nows: readonly number[]): string[] {
  const lines = stdout.split('\n');
  return asks.flatMap((a) => {
    const line = lines.find((l) => l.includes(a.id));
    if (line === undefined) return [`no line of deep inbox holds ${a.id} (${a.title})`];
    const wants = wantedDefaults(a, nows);
    return wants.some((want) => line.includes(want)) ? [] : [`${a.id} (${a.title}): its line lacks ${wants.map((want) => JSON.stringify(want)).join(' or ')}: ${JSON.stringify(line)}`];
  });
}

// ---- Check (c), redrafted after #1812: the one sentence.

/** A line that names the hub and says it isn't answering, read as #1812's suite reads one (its helpers.ts: SENTENCE). */
const SENTENCE = /\bhub\b.*\b(?:isn't|isn’t|is not) answering\b/i;
/**
 * `line` says since when at the clock time `c` (HH:MM) as today's clock writes it: "since 16:40", the time whole, as the
 * frozen test held it between "since " and ";": no seconds after it, and no 12-hour clock's am or pm.
 */
const saysSince = (line: string, c: string): boolean => new RegExp(`\\bsince ${c}(?!:?\\d)(?!\\s*[ap]\\.?m\\b)`, 'i').test(line);
/**
 * What is wrong with the one sentence of `deep inbox`, the hub down in a home that is set up: the first line of its
 * output, stdout then stderr, that says the hub isn't answering must say since when as today's clock writes one of
 * `since`'s minutes (#2331, as the frozen test held it), and name on that same line the one fix, `deep hub start`, and
 * neither `deep setup` nor BLOCKED, a verdict's word (#1812: its Scope's first item; its suite's Surfaces 1).
 */
function sentenceFailures(r: Ran, since: ReadonlySet<string>): string[] {
  const line = `${r.stdout}\n${r.stderr}`.split('\n').find((l) => SENTENCE.test(l));
  if (line === undefined) return ["no line of deep inbox's output says the hub isn't answering"];
  const out: string[] = [];
  if (![...since].some((c) => saysSince(line, c))) out.push(`it doesn't say since when as today's clock writes it, "since HH:MM" at one of the ${since.size} minutes the hub could have stopped (${[...since].slice(0, 3).join(', ')} …)`);
  if (!line.includes('deep hub start')) out.push("it doesn't name the one fix in a home that is set up, deep hub start");
  if (line.includes('deep setup')) out.push('it names deep setup, the fix for a home that isn\'t set up');
  if (/\bBLOCKED\b/.test(line)) out.push("it holds BLOCKED, a verdict's word");
  return out.length ? [`the line that says the hub isn't answering, ${JSON.stringify(line)}: ${out.join('; ')}`] : [];
}

describe(ID.formatters, () => {
  test(`${ID.formatters}: deep inbox, the hub down, says since when and the one fix, deep hub start, writes each ask's default and its time, and constructs no date or number formatter (redraft 1812)`, async () => {
    const w = await world();
    const asks = await askRows(w);
    await stopHub(w.hub);
    const run = await countedInbox(w);
    console.log(`deep inbox, the hub stopped:\n${run.ran.stdout}${run.ran.stderr}`);
    expect(run.ran.code, `deep inbox exits 3 read from the database: ${shown(run.ran)}`).toBe(3);
    // Any minute the hub's last event could carry (unchanged): by the hub's clock, which started at noon and ran on from
    // its second start, or by the wall clock since this world began.
    const clock = baseParts().clock;
    const since = new Set<string>();
    for (let t = NOON - MINUTE; t <= NOON + 21 * MINUTE + (run.after - w.startedAt); t += MINUTE) since.add(clock(t));
    for (let t = begun - MINUTE; t <= run.after + MINUTE; t += MINUTE) since.add(clock(t));
    expect(sentenceFailures(run.ran, since), `deep inbox says in one sentence that the hub isn't answering, since when as today, and the one fix: ${shown(run.ran)}`).toEqual([]);
    expect(defaultFailures(run.ran.stdout, asks, [run.before, run.after]), 'each ask\'s default as today\'s deep inbox writes it').toEqual([]);
    expect(formatterFailures(run.records), 'the date and number formatters deep inbox constructed').toEqual([]);
  }, 900_000);
});
