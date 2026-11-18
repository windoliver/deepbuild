// Test-side tools for #2331 (README): the criteria and their IDs, the preload's records, the three weeks across a
// daylight-saving change, and the oracle, the text `when` (and so `clock`) wrote at base 1c4d1f0e, built here from the
// base's own expressions so the program under test is never its own judge.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- The criteria, as issue #2331 writes them (updatedAt 2026-11-15T07:52:50Z), and their IDs as
// scripts/proof-change.mjs makes them: `#2331.` and the first 8 hex digits of SHA-256 of the text, white space collapsed.
export const CRITERIA = {
  formatters: '`deep inbox` over an ask with a default constructs no date or number formatter, counted by a preload that wraps `Intl.DateTimeFormat` and the `toLocale*String` methods',
  text: 'For every minute of a week across a daylight-saving change, in three time zones, `clock` and `when` return what they return today',
  regression: '`tests/acceptance/1463/` passes as it does on main',
} as const;
const idOf = (text: string): string => `#2331.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;
// Static trace discovery: #2331.04651a1b (formatters), #2331.aee6e8f0 (unchanged local-time text).
export const ID = { formatters: idOf(CRITERIA.formatters), text: idOf(CRITERIA.text) } as const;

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK_MINUTES = 7 * 24 * 60;

// ---- The preload (count-formatters.cjs).

export const PRELOAD = fileURLToPath(new URL('./count-formatters.cjs', import.meta.url));
export interface Made { what: string; where: string }
export interface Counted { pid: number; argv: string[]; made: Made[] }
/** The environment that loads the preload into a node process and has it write its record into `dir`. */
export const preloadEnv = (dir: string): Record<string, string> => ({ NODE_OPTIONS: `--require ${JSON.stringify(PRELOAD)}`, DEEP_2331_FORMATTERS: dir });
/** Every record the preload wrote into `dir`, one per process that loaded it and exited. */
export function countedIn(dir: string): Counted[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Counted);
}
export const madeText = (made: readonly Made[]): string => made.map((m) => `${m.what} from ${m.where}`).join('\n  ');

// ---- The weeks: in each zone a week of minutes, from local midnight three days before its change. `offsets` are what
// getTimezoneOffset reads at the week's start and at its end, and `edge` the clock times either side of the change,
// so a process that doesn't keep the zone's time is BLOCKED, never compared in the wrong zone.

export interface Week { zone: string; what: string; start: number; change: number; offsets: [number, number]; edge: [number, string][] }
export const WEEKS: readonly Week[] = [
  {
    zone: 'America/New_York',
    what: 'whose clocks go back an hour at 02:00 on Sun 1 Nov 2026, so 01:00-01:59 comes twice',
    start: Date.UTC(2026, 9, 29, 4),
    change: Date.UTC(2026, 10, 1, 6),
    offsets: [240, 300],
    edge: [[Date.UTC(2026, 10, 1, 5, 30), '01:30'], [Date.UTC(2026, 10, 1, 6, 30), '01:30']],
  },
  {
    zone: 'Australia/Lord_Howe',
    what: 'whose clocks go forward half an hour at 02:00 on Sun 4 Oct 2026, from UTC+10:30 to UTC+11',
    start: Date.UTC(2026, 8, 30, 13, 30),
    change: Date.UTC(2026, 9, 3, 15, 30),
    offsets: [-630, -660],
    edge: [[Date.UTC(2026, 9, 3, 15, 29), '01:59'], [Date.UTC(2026, 9, 3, 15, 30), '02:30']],
  },
  {
    zone: 'America/Havana',
    what: 'whose clocks go forward an hour at midnight on Sun 8 Mar 2026, so that day starts at 01:00',
    start: Date.UTC(2026, 2, 5, 5),
    change: Date.UTC(2026, 2, 8, 5),
    offsets: [300, 240],
    edge: [[Date.UTC(2026, 2, 8, 4, 59), '23:59'], [Date.UTC(2026, 2, 8, 5, 0), '01:00']],
  },
];

/**
 * How far `at` is from `now` in each comparison: the same minute (so `when(at, at)` is "at " and `clock(at)` for every
 * minute), the minute's last millisecond, a minute back, half a day to two days on, and a day back.
 */
export const OFFSETS: readonly number[] = [0, MINUTE - 1, -MINUTE, 12 * HOUR, 24 * HOUR, 25 * HOUR, 36 * HOUR, 48 * HOUR, -DAY];

// ---- The oracle.

export type When = (at: number, now: number) => string;
/** The parts `when` is made of: the clock time, the calendar day, tomorrow's, and the weekday, date and month. */
export interface Parts { clock(at: number): string; day(ms: number): string; tomorrow(now: number): string; weekday(at: number): string; date(at: number): number; month(at: number): string }

const memo = (f: (at: number) => string): ((at: number) => string) => {
  const seen = new Map<number, string>();
  return (at) => {
    let s = seen.get(at);
    if (s === undefined) seen.set(at, (s = f(at)));
    return s;
  };
};

/**
 * The base's parts, each its own expression at 1c4d1f0e (packages/hub/src/list.ts lines 33, 39, 41-43 and 45). Make them
 * after the zone is set: the formatted ones are remembered by instant, so the comparison doesn't pay for them twice.
 */
export function baseParts(): Parts {
  return {
    clock: memo((at) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })),
    day: (ms) => new Date(ms).toDateString(),
    tomorrow: (now) => {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toDateString();
    },
    weekday: memo((at) => new Date(at).toLocaleDateString('en-GB', { weekday: 'short' })),
    date: (at) => new Date(at).getDate(),
    month: memo((at) => new Date(at).toLocaleDateString('en-GB', { month: 'short' })),
  };
}

/** `when` as the base composes it (list.ts lines 38-46): "at 16:40" today, "tomorrow at 16:40", else "on Wed 11 Nov at 16:40". */
export function whenFrom(p: Parts): When {
  return (at, now) => {
    if (p.day(at) === p.day(now)) return `at ${p.clock(at)}`;
    if (p.day(at) === p.tomorrow(now)) return `tomorrow at ${p.clock(at)}`;
    return `on ${p.weekday(at)} ${p.date(at)} ${p.month(at)} at ${p.clock(at)}`;
  };
}
/** What `when` returns today, in this process's time zone. */
export const oracleWhen = (): When => whenFrom(baseParts());

// ---- The zone and the comparison.

/** Runs `run` with this process in `week`'s zone (TZ), BLOCKED unless both Date and the locale formatter keep its time. */
export async function inZone<T>(week: Week, run: () => Promise<T> | T): Promise<T> {
  const was = process.env.TZ;
  process.env.TZ = week.zone;
  try {
    const offsets = [week.start, week.start + 7 * DAY].map((t) => new Date(t).getTimezoneOffset());
    const clock = baseParts().clock;
    const edge = week.edge.map(([t]) => clock(t));
    if (offsets[0] !== week.offsets[0] || offsets[1] !== week.offsets[1] || edge.some((c, i) => c !== week.edge[i]![1])) {
      throw Error(`BLOCKED: this process doesn't keep ${week.zone}'s time with TZ set: offsets ${offsets.join(', ')} and clock times ${edge.join(', ')}, where the zone has ${week.offsets.join(', ')} and ${week.edge.map(([, c]) => c).join(', ')}`);
    }
    return await run();
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

export interface Mismatch { call: string; got: unknown; want: string; at: number; now: number }
const shown = (ms: number): string => `${new Date(ms).toISOString()} (${new Date(ms).toString().slice(0, 24)} here)`;

/**
 * `subject` against `want` for every minute of `week` as `now`, each with `at` at every offset: how many were compared,
 * how many differ, and the first dozen that do (only the first with `first`).
 */
export function compare(week: Week, subject: When, want: When, first = false): { checked: number; total: number; mismatches: Mismatch[] } {
  const mismatches: Mismatch[] = [];
  let checked = 0;
  let total = 0;
  for (let i = 0; i < WEEK_MINUTES; i++) {
    const now = week.start + i * MINUTE;
    for (const d of OFFSETS) {
      const at = now + d;
      const got: unknown = subject(at, now);
      const wanted = want(at, now);
      checked++;
      if (got === wanted) continue;
      total++;
      if (mismatches.length < 12) mismatches.push({ call: `when(${shown(at)}, ${shown(now)})`, got, want: wanted, at, now });
      if (first) return { checked, total, mismatches };
    }
  }
  return { checked, total, mismatches };
}
