// A world for the library tests: a real record on SQLite in a temp folder (#14), the real asks core (#318) and
// budget ledger (#86) on it, the real supervisor (#236) with a lease pool, and the runner opened on all of them
// through its public entry, `@deepbuild/runner` (README, The surface under test), with a clock the test moves.
// The runner's environment (the hub's, which its allowlist filters) holds the four nesting variables, as a hub
// started from a Claude Code terminal would; they are in this process's environment too while the world is
// open, so a runner that reads process.env instead still meets them. Nothing here stands in for the runner.

import { join } from 'node:path';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { openAsks, type Asks } from '../../../packages/asks/src/index.ts';
import { openLedger, type Ledger } from '../../../packages/budget/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';
import { openRunner, type JobRecord, type JobSpec, type Plant, type Runner } from '../../../packages/runner/src/index.ts';
import { ACCOUNT, DAY, NESTING, home, tempDir } from './helpers.ts';

/** The question card in the app: the trusted path an answer takes. */
export const card: Connection = { writer: 'app', actor: 'you', scope: 'you' };

/** Real time plus an offset the test moves: processes and grace periods stay real, windows and waits can be passed. */
export interface Clock { now(): number; advance(ms: number): void }
export function makeClock(): Clock {
  let offset = 0;
  return { now: () => Date.now() + offset, advance: (ms) => { offset += ms; } };
}

/** A job's price, as the ledger's lookup gives it: a job that bills an API key reserves this against a budget. */
export const PRICE_USD = 0.5;

export interface WorldOptions {
  /** The login shell's PATH that setup recorded. */
  loginPath: string;
  /** Added to the hub's environment (the four nesting variables are always in it). */
  env?: Record<string, string>;
  reservePct?: number;
  plant?: Plant;
}
export interface World {
  dir: string;
  root: string;
  clock: Clock;
  record: RecordStore;
  asks: Asks;
  ledger: Ledger;
  sup: Supervisor;
  runner: Runner;
  events(kind?: string): Promise<Event[]>;
  close(): Promise<void>;
}

export async function openWorld(o: WorldOptions): Promise<World> {
  const dir = tempDir();
  const h = home();
  const root = join(h, '.deepbuild');
  const clock = makeClock();
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(NESTING)) { saved[key] = process.env[key]; process.env[key] = value; }
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: clock.now });
  const asks = await openAsks({ record, now: clock.now, deliver: () => undefined });
  const ledger = await openLedger({ record, asks, now: clock.now, price: async () => PRICE_USD });
  const sup = await openSupervisor({
    record, asks, now: clock.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } },
    resources: [{ kind: 'worktree', keys: ['wt-1'] }],
  });
  const env: Record<string, string> = { HOME: h, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8', SECRET_NOT_ALLOWLISTED: 'dh159-hub-only', ...NESTING, ...(o.env ?? {}) };
  const runner = await openRunner({
    record, asks, supervisor: sup, ledger, now: clock.now, root, loginPath: o.loginPath, env,
    settings: { plan: { reserve_pct: o.reservePct ?? 10 }, asks: { unblock: { deadline_ms: 2 * DAY } } },
    ...(o.plant ? { plant: o.plant } : {}),
  });
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
  return {
    dir, root, clock, record, asks, ledger, sup, runner, events,
    close: async () => {
      try {
        await runner.close();
        await sup.close();
        await record.close();
      } finally {
        for (const [key, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    },
  };
}

/** The data of an event, as a plain object. */
export const dataOf = (e: Event): Record<string, unknown> => e.data as Record<string, unknown>;

/** A job of the kind given, on Claude Code, with a prompt of `@` lines for the fake (README, The fake CLI). */
export function job(kind: JobSpec['kind'], prompt: string, over: Partial<JobSpec> = {}): JobSpec {
  return { kind, agent: 'claude-code', prompt, deadline_ms: 120_000, ...over };
}
/** A window reading with room: 5% of the 5-hour window used, for the account (by default the fake sign-in's). */
export async function room(w: World, account = ACCOUNT): Promise<void> {
  await w.runner.report({ agent: 'claude-code', account, rate_limits: claudeLimits(5, w.clock.now() + 3 * 3_600_000) });
}
/** Runs a job to its end, and its stdout as the runner read it. */
export async function runJob(w: World, spec: JobSpec): Promise<{ rec: JobRecord; stdout: string }> {
  const rec = await w.runner.run(spec);
  return { rec, stdout: await w.runner.output(rec.job) };
}

/** Claude Code's status line `rate_limits`, as the forwarder hands it on: percent used and reset time (Unix seconds). */
export function claudeLimits(fiveHourUsed: number, resetsAtMs: number, sevenDayUsed = 20): Record<string, unknown> {
  return {
    five_hour: { used_percentage: fiveHourUsed, resets_at: Math.floor(resetsAtMs / 1000) },
    seven_day: { used_percentage: sevenDayUsed, resets_at: Math.floor((resetsAtMs + 5 * DAY) / 1000) },
  };
}
