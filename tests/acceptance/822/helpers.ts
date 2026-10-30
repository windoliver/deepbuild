// Test-side tools for the #822 acceptance tests: temp folders and a temp HOME, the stand-in `claude` a runner job
// launches, the runner's world (a real record, asks core, budget ledger and supervisor, and the runner opened on
// them through its public entry), the real clock kept aside from Vitest's fake one, and the matcher for "names the
// field and the value". Nothing here stands in for the runner, the check kind or the extension host: the tests reach
// them only through the public entries the README names.
//
// Safety: every folder is under /tmp/dh822-* (real paths, which Seatbelt matches); HOME is a temp folder for this
// process and every child; the agent's own CLAUDE*, DEEP_* and ANTHROPIC_* variables are removed first; no `claude`
// here is real, nothing signs in, calls a model or reaches the network; and a process is stopped only by the PID or
// process group a test's own run recorded, never by name or port.

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, vi } from 'vitest';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openLedger } from '../../../packages/budget/src/index.ts';
import { openRecord, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openRunner, type JobRecord, type JobSpec, type Runner } from '../../../packages/runner/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const MINUTE = 60_000;
export const DAY = 86_400_000;
/** The largest delay Node keeps for a timer: 2³¹ − 1 ms, about 24.8 days. */
export const MAX_TIMER = 2 ** 31 - 1;
/** The issue's long deadline. */
export const THIRTY_DAYS = 30 * DAY;

// The real timers, kept before any test installs Vitest's fake ones: the tests' own waits run on them.
const realSetTimeout = globalThis.setTimeout;
export const realSleep = (ms: number): Promise<void> => new Promise((resolve) => { realSetTimeout(resolve, ms); });
/** Real-time poll until `test` holds or `ms` pass; whether it held. */
export async function until(test: () => boolean | Promise<boolean>, ms = 10_000): Promise<boolean> {
  const end = realNow() + ms;
  while (realNow() < end) {
    if (await test()) return true;
    await realSleep(25);
  }
  return test();
}
/** Whether a promise has settled, read after the microtasks queued so far ran. */
export function tracked<T>(p: Promise<T>): { promise: Promise<T>; settled: () => boolean } {
  let done = false;
  const promise = p.finally(() => { done = true; });
  promise.catch(() => undefined);
  return { promise, settled: () => done };
}
// The real clock, kept the same way: the tests' own polls read it.
const realNow = performance.now.bind(performance);
/**
 * The fake clock the criteria name: Vitest's fake timers for every timer, `Date` and `performance.now`, moving with
 * real time too, so processes, sandboxes and graces still run while the test moves days ahead at once. A program may
 * read any of these clocks for a deadline; they all move together.
 */
export function fakeClock(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'], shouldAdvanceTime: true, advanceTimeDelta: 20 });
}
/** Moves the fake clock ahead in steps of at most a day, running each timer that comes due and the work it queues. */
export async function advance(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= DAY) await vi.advanceTimersByTimeAsync(Math.min(left, DAY));
}

for (const key of Object.keys(process.env)) {
  if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key.startsWith('ANTHROPIC_') || key === 'AI_AGENT') delete process.env[key];
}

// ---- Temp folders, all removed after the file.
const made: string[] = [];
export function tempDir(tag: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh822-${tag}-`));
  made.push(dir);
  return dir;
}
/** Process groups a test's runs started, stopped by their recorded IDs if still there when the file ends. */
const groups = new Set<number>();
export const own = (pgid: number | undefined): void => { if (pgid) groups.add(pgid); };
export const alive = (pid: number | undefined): boolean => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};
export function stopOwn(): void {
  for (const pgid of groups) { try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ } }
  groups.clear();
}

// ---- HOME: a temp folder for this process and every child, with the account Claude Code keeps beside its sign-in.
export const ACCOUNT = '0b0b0b0b-1111-4222-8333-444444444444';
const HOME = tempDir('home');
process.env.HOME = HOME;
writeFileSync(join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT } }));

afterAll(() => {
  vi.useRealTimers();
  stopOwn();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---- The stand-in `claude`: its version as the facts cover it, and as a job a line of output, then it holds.
const VERSION = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions.at(-1)!;
/**
 * A folder holding a `claude` that, launched as a job, reads its prompt, prints its session and runs on, printing
 * nothing more. The shell stays its group's leader (no `exec`): on this base the supervisor can't prove, and so
 * can't stop, a job whose leader was replaced by an exec of /bin/sleep (README, Open points).
 */
export function standIn(): string {
  const bin = join(tempDir('bin'), 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh
for a in "$@"; do [ "$a" = --version ] && { echo "${VERSION} (Claude Code)"; exit 0; }; done
cat >/dev/null
echo '{"type":"system","subtype":"init","session_id":"00000000-0000-4000-8000-000000000822"}'
sleep 3600
`, { mode: 0o755 });
  return bin;
}

// ---- The runner's world.
export interface World {
  record: RecordStore;
  asks: Asks;
  sup: Supervisor;
  runner: Runner;
  events(kind?: string): Promise<Event[]>;
  /** Whether the supervisor recorded a process starting under this job's own run. */
  launched(job: string): Promise<boolean>;
  close(): Promise<void>;
}
const limits = (used: number, resetsAtMs: number) => ({
  five_hour: { used_percentage: used, resets_at: Math.floor(resetsAtMs / 1000) },
  seven_day: { used_percentage: 1, resets_at: Math.floor((resetsAtMs + 5 * DAY) / 1000) },
});
/**
 * A record, asks core, budget ledger and supervisor on a temp folder, and the runner opened on them through
 * `@deepbuild/runner`, every clock `Date.now` (so the fake clock moves them all); with a window reading that has room,
 * so a job it may start starts at once.
 */
export async function openWorld(): Promise<World> {
  const dir = tempDir('world');
  const bin = standIn();
  const now = (): number => Date.now();
  const record = await openRecord({ path: join(dir, 'ledger.db'), now });
  const asks = await openAsks({ record, now, deliver: () => undefined });
  const ledger = await openLedger({ record, asks, now, price: async () => 0.5 });
  const sup = await openSupervisor({ record, asks, now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const runner = await openRunner({
    record, asks, supervisor: sup, ledger, now, root: join(dir, 'root'), loginPath: `${bin}:/usr/bin:/bin`,
    env: { HOME, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
    settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 2 * DAY } } },
  });
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: limits(5, Date.now() + 3 * 3_600_000) });
  const events = async (kind?: string): Promise<Event[]> => {
    const all: Event[] = [];
    for (let after = 0; ;) {
      const page = await record.read({ after, limit: 1000 });
      all.push(...page);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.log_pos;
    }
    return kind ? all.filter((e) => e.kind === kind) : all;
  };
  let closed = false;
  return {
    record, asks, sup, runner, events,
    launched: async (job) => (await events('process.starting')).some((e) => (e.data as { run?: unknown }).run === job),
    close: async () => {
      if (closed) return;
      closed = true;
      for (const j of await runner.list().catch(() => [] as JobRecord[])) {
        if (j.state === 'running' || j.state === 'waiting') await runner.cancel(j.job).catch(() => undefined);
      }
      await runner.close().catch(() => undefined);
      await sup.close().catch(() => undefined);
      await record.close().catch(() => undefined);
    },
  };
}
/** A read job on Claude Code, the prompt the stand-in reads and ignores. */
export const job = (over: Partial<JobSpec> = {}): JobSpec => ({ kind: 'read', agent: 'claude-code', prompt: 'Read the notes.', ...over });

// ---- "Naming the field and the value".
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
/** The value as written, as its own token: `0` in "deadline_ms 0 isn't…" but not the 0 in "run:01K…" or "10". */
export function namesValue(text: string, value: string): boolean {
  return new RegExp(`(?<![\\w.-])${escape(value)}(?![\\w]|\\.\\d)`).test(text);
}
/** The values a caller can set that aren't a positive whole number of milliseconds, as the issue lists them. */
export const BAD: { value: number; written: string }[] = [
  { value: 0, written: '0' },
  { value: -5, written: '-5' },
  { value: 1.5, written: '1.5' },
  { value: Number.NaN, written: 'NaN' },
  { value: Number.POSITIVE_INFINITY, written: 'Infinity' },
];
/** Every string a value holds, one a line: what it says in words, without the JSON around it (a `"line":0` names no 0). */
const words = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(words) : v && typeof v === 'object' ? Object.values(v).flatMap(words) : [];
/** What a refusal said: a thrown error's message, or the words of what came back. */
export async function outcomeOf<T>(work: () => Promise<T>): Promise<{ threw: boolean; text: string; value?: T }> {
  try {
    const value = await work();
    return { threw: false, text: words(value).join('\n'), value };
  } catch (error) {
    return { threw: true, text: error instanceof Error ? error.message : String(error) };
  }
}
