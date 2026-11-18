// #2331, its first criterion: `deep inbox` over asks with a default constructs no date or number formatter, counted by
// count-formatters.cjs preloaded into its process (NODE_OPTIONS=--require), with the hub up and with it down. Each run
// must also write each ask's default and its time as the base does (kit.ts's oracle), and with the hub down say since
// when, so a program that stops writing the times passes nothing. At the base both tests fail on the count alone.
//
// The world is #1463's (makeWorld, unchanged): a real hub in a temp HOME, on its clock at noon today in Asia/Kolkata,
// one session with three open asks whose defaults fall today, tomorrow and in three days, so `when` takes each of its
// three forms. The CLI is the built one (packages/cli/dist/main.js), started from this process with no agent above it.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { cleanup, makeWorld, next1640, NOON, shown, stopHub, type SessionSpec, type World } from '../1463/helpers.ts';
import { deep, tempDir, type Ran } from '../16/helpers.ts';
import { baseParts, countedIn, type Counted, ID, madeText, MINUTE, preloadEnv, whenFrom } from './kit.ts';

afterAll(cleanup, 60_000);

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
/** The fixture reaches each of `when`'s forms: today, tomorrow and another day. */
function formsFailures(asks: readonly AskRow[], now: number): string[] {
  const when = whenFrom(baseParts());
  const said = asks.map((a) => when(a.default_at, now));
  return ['at ', 'tomorrow at ', 'on '].filter((form) => !said.some((s) => s.startsWith(form))).map((form) => `BLOCKED: no fixture ask's default reads "${form}…" (${JSON.stringify(said)})`);
}

describe(ID.formatters, () => {
  test(`${ID.formatters}: deep inbox, the hub up, writes each ask's default and its time and constructs no date or number formatter`, async () => {
    const w = await world();
    const asks = await askRows(w);
    const run = await countedInbox(w);
    console.log(`deep inbox:\n${run.ran.stdout}${run.ran.stderr}`);
    expect(run.ran.code, `deep inbox exits 0 with the hub up: ${shown(run.ran)}`).toBe(0);
    expect(formsFailures(asks, run.before), 'the fixture').toEqual([]);
    expect(defaultFailures(run.ran.stdout, asks, [run.before, run.after]), 'each ask\'s default as today\'s deep inbox writes it').toEqual([]);
    if (new Date(run.after).toDateString() === new Date(NOON).toDateString()) {
      expect(run.ran.stdout, 'the ask that defaults at 16:40 today').toContain("If you don't answer: No, at 16:40");
    }
    expect(formatterFailures(run.records), 'the date and number formatters deep inbox constructed').toEqual([]);
  }, 900_000);

  test(`${ID.formatters}: deep inbox, the hub down, says since when, writes each ask's default and its time, and constructs no date or number formatter`, async () => {
    const w = await world();
    const asks = await askRows(w);
    await stopHub(w.hub);
    const run = await countedInbox(w);
    console.log(`deep inbox, the hub stopped:\n${run.ran.stdout}${run.ran.stderr}`);
    expect(run.ran.code, `deep inbox exits 3 read from the database: ${shown(run.ran)}`).toBe(3);
    // The base's line (list.ts:155), at any minute the hub's last event could carry: by the hub's clock, which started
    // at noon and ran on from its second start, or by the wall clock since this world began.
    const clock = baseParts().clock;
    const since = new Set<string>();
    for (let t = NOON - MINUTE; t <= NOON + 21 * MINUTE + (run.after - w.startedAt); t += MINUTE) since.add(clock(t));
    for (let t = begun - MINUTE; t <= run.after + MINUTE; t += MINUTE) since.add(clock(t));
    const first = run.ran.stdout.split('\n')[0] ?? '';
    const lines = [...since].map((c) => `The hub isn't answering, since ${c}; this is the list its database holds.`);
    expect(lines.includes(first), `deep inbox's first line says the hub isn't answering and since when, as today: ${JSON.stringify(first)}; one of ${JSON.stringify(lines.slice(0, 3))} …`).toBe(true);
    expect(defaultFailures(run.ran.stdout, asks, [run.before, run.after]), 'each ask\'s default as today\'s deep inbox writes it').toEqual([]);
    expect(formatterFailures(run.records), 'the date and number formatters deep inbox constructed').toEqual([]);
  }, 900_000);
});
