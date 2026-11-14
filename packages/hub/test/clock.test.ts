import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtures, type JsonValue } from '@deepbuild/contracts';
import { openRecord } from '@deepbuild/record';
import { afterEach, expect, it } from 'vitest';
import { hubDown, when } from '../src/list.js';
import { ulid } from '../src/wire.js';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
const zone = process.env.TZ;
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

const byLocale = {
  clock: (at: number): string => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
  when(at: number, now: number): string {
    const day = (ms: number) => new Date(ms).toDateString();
    if (day(at) === day(now)) return `at ${byLocale.clock(at)}`;
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (day(at) === tomorrow.toDateString()) return `tomorrow at ${byLocale.clock(at)}`;
    const d = new Date(at);
    return `on ${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })} at ${byLocale.clock(at)}`;
  },
};
const MINUTE = 60_000;
const DAY = 86_400_000;

it.each([
  ['America/Los_Angeles', Date.UTC(2026, 2, 5)],
  ['Europe/London', Date.UTC(2026, 9, 22)],
  ['Australia/Lord_Howe', Date.UTC(2026, 3, 1)],
])('every minute of the week %s changes its clocks reads as the locale\'s formatter writes it', (tz, from) => {
  process.env.TZ = tz;
  const offsets = new Set<number>();
  const differing: string[] = [];
  for (let at = from; at < from + 7 * DAY; at += MINUTE) {
    offsets.add(new Date(at).getTimezoneOffset());
    for (const now of [at - 90 * MINUTE, at - DAY, at - 3 * DAY]) {
      const [got, want] = [when(at, now), byLocale.when(at, now)];
      if (got !== want) differing.push(`${new Date(at).toISOString()} from ${new Date(now).toISOString()}: "${got}", not "${want}"`);
    }
    const [got, want] = [hubDown(at), `The hub isn't answering, since ${byLocale.clock(at)}; this is the list its database holds.`];
    if (got !== want) differing.push(`${new Date(at).toISOString()}: "${got}", not "${want}"`);
  }
  expect(offsets.size, 'the week holds the change').toBe(2);
  expect(differing.slice(0, 5)).toEqual([]);
}, 120_000);

it.each(['Asia/Kathmandu', 'Pacific/Kiritimati', 'UTC'])('every day of two years in %s names its weekday and month as the locale\'s formatter does', (tz) => {
  process.env.TZ = tz;
  const [named, differing] = [new Set<string>(), [] as string[]];
  for (let at = Date.UTC(2026, 0, 1, 12); at < Date.UTC(2028, 0, 1); at += DAY) {
    const [got, want] = [when(at, at - 3 * DAY), byLocale.when(at, at - 3 * DAY)];
    const [, weekday, month] = /^on (\S+) \d+ (\S+) at /.exec(got) ?? [];
    named.add(`${weekday}`).add(`${month}`);
    if (got !== want) differing.push(`${new Date(at).toISOString()}: "${got}", not "${want}"`);
  }
  expect(named.size, 'seven weekdays and twelve months').toBe(19);
  expect(differing.slice(0, 5)).toEqual([]);
}, 120_000);

it('a time that is no time reads as the locale\'s formatter writes it', () => {
  expect(when(Number.NaN, 0)).toBe(byLocale.when(Number.NaN, 0));
  expect(hubDown(Number.NaN)).toBe(`The hub isn't answering, since ${byLocale.clock(Number.NaN)}; this is the list its database holds.`);
});

it('deep status with the hub down says since when in a clock time, and constructs no date formatter to say it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'deep-clock-'));
  try {
    mkdirSync(join(home, '.deepbuild'));
    writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), '{}\n');
    const last = Date.now() - 5 * MINUTE;
    const record = await openRecord({ path: join(home, '.deepbuild', 'ledger.db'), now: () => last });
    const session = '7c4d5e60-0019-4222-8333-000000000001';
    const data = (fixtures('session.start@1')[0] as { data: Record<string, JsonValue> }).data;
    await record.append({ writer: 'hook', actor: 'you', scope: 'you', session }, { v: 1, id: ulid(last), kind: 'session.start', ts: last, data: { ...data, agent: 'claude-code', worktree: home, thread: session } });
    await record.close();
    const [preload, log] = [join(home, 'formatters.mjs'), join(home, 'formatters.log')];
    writeFileSync(preload, `import { appendFileSync } from 'node:fs';
const note = (what) => appendFileSync(${JSON.stringify(log)}, what + '\\n');
for (const name of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
  const format = Date.prototype[name];
  Date.prototype[name] = function (...args) { note(name); return format.apply(this, args); };
}
Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
  construct(target, args) { note('Intl.DateTimeFormat'); return new target(...args); },
  apply(target, self, args) { note('Intl.DateTimeFormat'); return target(...args); },
});
`);
    const result = spawnSync(process.execPath, ['--import', preload, CLI, 'status'], { env: { ...process.env, HOME: home, TZ: 'Asia/Kathmandu' }, encoding: 'utf8' });
    const since = new Date(last).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kathmandu' });
    expect(result.stdout, result.stderr).toContain(`The hub isn't answering, since ${since}; this is the list its database holds.`);
    expect(result.status).toBe(3);
    expect(existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : []).toEqual([]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 60_000);
