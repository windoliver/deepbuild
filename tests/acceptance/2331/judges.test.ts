// The judges, held to wrong programs (README). No hub, no build and no criterion tag; they pass at the base.
// - The week comparison (week.test.ts) fails each wrong `when` below in each zone, and the two that go wrong only at a
//   daylight-saving change first differ at that change, so each week reaches its change.
// - The preload (inbox.test.ts) counts each kind of formatter it wraps, changes no result, and counts nothing in a
//   process that formats nothing, so the zero the first criterion asks for is reachable.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { baseParts, compare, countedIn, DAY, inZone, MINUTE, type Parts, preloadEnv, type Week, type When, whenFrom, WEEKS } from './kit.ts';

const pad = (n: number): string => String(n).padStart(2, '0');
const utc = (ms: number): string => `${pad(new Date(ms).getUTCHours())}:${pad(new Date(ms).getUTCMinutes())}`;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Wrong programs: the base's `when` with one part wrong. Make them in the week's zone. */
function wrongs(week: Week): Record<string, When> {
  const p = baseParts();
  const off = new Date(week.start).getTimezoneOffset();
  const twin = (part: Partial<Parts>): When => whenFrom({ ...p, ...part });
  return {
    'the clock in UTC': twin({ clock: utc }),
    "the clock at the week's first offset": twin({ clock: (at) => utc(at - off * MINUTE) }),
    'tomorrow as 24 hours on': twin({ tomorrow: (now) => new Date(now + DAY).toDateString() }),
    'a 12-hour clock': twin({ clock: (at) => { const [h, m] = p.clock(at).split(':'); return `${pad(((Number(h) + 11) % 12) + 1)}:${m}`; } }),
    'the hour unpadded': twin({ clock: (at) => p.clock(at).replace(/^0/, '') }),
    'the clock rounded to the nearest minute': twin({ clock: (at) => p.clock(Math.round(at / MINUTE) * MINUTE) }),
    'the calendar day in UTC': twin({ day: (ms) => new Date(ms).toISOString().slice(0, 10), tomorrow: (now) => new Date(now + DAY).toISOString().slice(0, 10) }),
    'the date of the month in UTC': twin({ date: (at) => new Date(at).getUTCDate() }),
    'the weekday in UTC': twin({ weekday: (at) => WEEKDAYS[new Date(at).getUTCDay()]! }),
    "next month's name": twin({ month: (at) => { const d = new Date(at); return p.month(new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()); } }),
  };
}

describe('the week comparison', () => {
  for (const week of WEEKS) {
    test(`in ${week.zone}, it fails each wrong when, the daylight-saving ones first at the change`, async () => {
      await inZone(week, () => {
        const want = whenFrom(baseParts());
        const firsts = Object.entries(wrongs(week)).map(([name, wrong]) => [name, compare(week, wrong, want, true).mismatches[0]] as const);
        console.log(firsts.map(([name, m]) => `${week.zone}, ${name}: ${m ? `${m.call} gave ${JSON.stringify(m.got)} for ${JSON.stringify(m.want)}` : 'no difference'}`).join('\n'));
        expect(firsts.filter(([, m]) => !m).map(([name]) => name), 'wrong programs the comparison passed').toEqual([]);
        const first = new Map(firsts);
        const frozen = first.get("the clock at the week's first offset")!;
        expect(frozen.at, `the first clock it gets wrong is at or after ${week.zone}'s change: ${frozen.call}`).toBeGreaterThanOrEqual(week.change);
        const tomorrow = first.get('tomorrow as 24 hours on')!;
        expect(tomorrow.now > week.change - DAY - MINUTE && tomorrow.now <= week.change, `the first "tomorrow" it gets wrong is from the day before ${week.zone}'s change: ${tomorrow.call}`).toBe(true);
      });
    }, 300_000);
  }
});

/** `script` run by node with the preload: what it printed and every record the preload wrote. */
function preloaded(script: string, preload = true): { stdout: string; argvs: string[][]; made: string[] } {
  const dir = mkdtempSync(join(tmpdir(), 'db2331-'));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, TZ: 'UTC' };
    delete env.NODE_OPTIONS;
    const r = spawnSync(process.execPath, ['-e', script], { env: preload ? { ...env, ...preloadEnv(dir) } : env, encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0) throw Error(`node -e failed: exit ${r.status}, ${r.stderr}`);
    const records = countedIn(dir);
    return { stdout: r.stdout, argvs: records.map((c) => c.argv), made: records.flatMap((c) => c.made.map((m) => m.what)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the preload', () => {
  const EVERY = `process.stdout.write(JSON.stringify([
    new Date(0).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    new Date(0).toLocaleDateString('en-GB', { weekday: 'short' }),
    new Date(0).toLocaleString('en-GB'),
    new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(0),
    Intl.DateTimeFormat('en-GB').resolvedOptions().timeZone,
    new Intl.NumberFormat('en-GB').format(1234.5),
    (1234.5).toLocaleString('en-GB'),
    (1234n).toLocaleString('en-GB'),
    new Intl.DateTimeFormat() instanceof Intl.DateTimeFormat,
  ]));`;

  test('counts each formatter it wraps, and changes no result', () => {
    const plain = preloaded(EVERY, false);
    const counted = preloaded(EVERY);
    expect(counted.stdout, 'the same results with the preload as without').toBe(plain.stdout);
    for (const what of ['Date.prototype.toLocaleTimeString', 'Date.prototype.toLocaleDateString', 'Date.prototype.toLocaleString', 'Intl.DateTimeFormat', 'Intl.NumberFormat', 'Number.prototype.toLocaleString', 'BigInt.prototype.toLocaleString']) {
      expect(counted.made, `the preload counts ${what}`).toContain(what);
    }
    expect(counted.made.filter((w) => w === 'Intl.DateTimeFormat'), 'Intl.DateTimeFormat with new and without, three times').toHaveLength(3);
  });

  test("counts the base's clock, and nothing in a process that formats nothing", () => {
    const base = preloaded(`new Date(0).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });`);
    expect(base.made, "the base's clock").toEqual(['Date.prototype.toLocaleTimeString']);
    const none = preloaded('process.stdout.write(String(new Date(0).getHours()))');
    expect(none.argvs, 'node -e left its record').toHaveLength(1);
    expect(none.made, 'nothing counted').toEqual([]);
  });
});
