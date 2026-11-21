// Test-side tools for the #2977 acceptance tests: a supervisor opened on a real record and asks core in a temp folder,
// in one of the planted worlds whose sandbox reports don't show through the first filter, and what the tests read of
// it: its `log stream` children (ps, ppid = this process) and the record's sandbox.denied events. Nothing here starts,
// times or filters a stream itself: every stream is the supervisor's.
//
// Safety: every folder is under the OS temp dir (deep2977-*) and removed after its test; no network; the only
// processes stopped are the supervisor's own, by its close().
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openAsks } from '@deepbuild/asks';
import { openRecord } from '@deepbuild/record';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));

/** Each criterion's ID (scripts/proof-change.mjs `criterionId` over the live issue's text), which starts its tests' names. */
export const AC = {
  1: '#2977.04fdc1bc',
  2: '#2977.0d3f7721',
  3: '#2977.cd253437',
} as const;

/** The planted worlds the issue names: the first filter shows nothing; under the second, the second shows nothing either. */
export type World = 'reports-other-subsystem' | 'reports-other-process';

/** The issue's bound on the first sandboxed start, from openSupervisor resolving (AC1). */
export const FIRST_START_MS = 5_000;

export interface Opened {
  dir: string;
  record: Awaited<ReturnType<typeof openRecord>>;
  sup: Awaited<ReturnType<typeof openSupervisor>>;
  /** performance.now() when openSupervisor resolved. */
  openedAt: number;
  close(): Promise<void>;
}

/** A new supervisor in `world`, with `in/` (writable to its runs) and `outside/` (not) in a fresh temp folder. */
export async function open(world: World): Promise<Opened> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep2977-')));
  mkdirSync(join(dir, 'in'));
  mkdirSync(join(dir, 'outside'));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } }, plant: world });
  const openedAt = performance.now();
  return {
    dir, record, sup, openedAt,
    async close() {
      try { await sup.close(); } finally {
        await record.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/** Every `log stream` that is this process's own child, as ps shows it (its full command line). */
export function streams(): string[] {
  return spawnSync('ps', ['-A', '-ww', '-o', 'ppid=,command='], { encoding: 'utf8' }).stdout.split('\n')
    .filter((line) => Number(line.trim().split(/\s+/)[0]) === process.pid && line.includes('/usr/bin/log stream'));
}

/** The record's sandbox.denied events for `run`. */
export async function deniedFor(record: Opened['record'], run: string): Promise<{ run: string; operation: string; target: string }[]> {
  return (await record.read({ after: 0, kinds: ['sandbox.denied'] })).map((e) => e.data as { run: string; operation: string; target: string }).filter((d) => d.run === run);
}

export const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
