// A holder's agent reads ended only when the process table says its PID is gone or another process's: a table that
// can't be read (ps failing to start, as under heavy load, or stopping on a signal) proves nothing, so the lease stays
// its holder's. #237's suite reads only a table that answers. `ps` is the OS's, so only its start is stood in for.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openRecord, ulid, type RecordStore } from '@deepbuild/record';
import { openLeases } from '../src/index.js';

const ps = vi.hoisted(() => ({ fails: null as null | { code: string | number | null; signal?: string } }));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: ((file: string, ...rest: unknown[]) => {
      const done = rest.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
      if (file !== '/bin/ps' || !ps.fails) return (actual.execFile as (...a: unknown[]) => unknown)(file, ...rest);
      setImmediate(() => done(Object.assign(new Error(`ps failed: ${String(ps.fails!.code)}`), ps.fails), '', ''));
      return undefined;
    }) as typeof actual.execFile,
  };
});

const T0 = Date.UTC(2026, 10, 5, 12, 0, 0);
const now = (): number => T0;
const SCREEN = { name: 'screen', match: 'exact', cap: 10, cooldown: 0, cost: 0 };
const screen = { host: 'local', kind: 'screen', key: 'screen-1' };
const startOf = (pid: number): string => execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();

let dir: string;
let record: RecordStore;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deep-leases-'));
  record = await openRecord({ path: join(dir, 'record.db'), now });
});
afterEach(async () => {
  ps.fails = null;
  await record.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('a holder whose agent the process table can\'t be read for', () => {
  for (const fails of [{ code: 'EAGAIN' }, { code: 'ENOENT' }, { code: 2 }, { code: null, signal: 'SIGKILL' }]) {
    it(`keeps its lease while ps fails with ${JSON.stringify(fails)}, and loses it once the table shows the agent gone`, async () => {
      const table = await openLeases({ record, now });
      await table.declare('test-screens', SCREEN);
      const holder = `session:${ulid(T0)}`;
      // This process stands for the agent: it runs, at the start the table reads for it.
      const granted = await table.lease({ holder, agent: { pid: process.pid, start: startOf(process.pid) } }, screen, 'exclusive');
      expect(granted.status).toBe('granted');

      ps.fails = fails;
      await table.tick();
      expect((await table.leases()).map((v) => v.lease.holder), 'a failed read of the process table ends no holder').toEqual([holder]);
      expect((await record.read({ after: 0 })).filter((e) => e.kind === 'session.gone' || e.kind === 'lease.released').map((e) => e.kind)).toEqual([]);

      // The same PID read again, now at another start: the agent is gone, and its lease with it.
      ps.fails = null;
      const again = await table.lease({ holder: `session:${ulid(T0 + 1)}`, agent: { pid: process.pid, start: 'Thu Jan  1 00:00:00 2026' } }, { ...screen, key: 'screen-2' }, 'exclusive');
      expect(again.status).toBe('granted');
      await table.tick();
      expect((await table.leases()).map((v) => v.lease.resource.key)).toEqual(['screen-1']);
    });
  }
});
