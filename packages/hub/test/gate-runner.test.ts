// The gate runner's stale runs (#45): a slow run is outdated only by a newer claim whose snapshot changed its check's
// inputs; a newer claim with the same tree, a question answered and the same words stopped again, carries the run and
// writes no run.stale.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Connection, EventInput } from '@deepbuild/record';
import { GateRunner, type GateOptions } from '../src/gate-runner.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gate-runner-'));
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git('add', '-A');
  git('commit', '-qm', 'one');
  return dir;
}
/** The service's snapshot of a worktree as it stands: its tree written from every change added, as the base-commit service does. */
function checkoutsOf(dir: string): ReturnType<GateOptions['checkouts']> {
  let snapshots = 0;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_INDEX_FILE: join(dir, '.git', 'snapshot-index') } }).toString().trim();
  return {
    budget: () => ({ since: Date.now() }),
    snapshot: async () => { git('add', '-A'); return { commit: `snap${++snapshots}`, wrote: true, tree: git('write-tree') }; },
    checkout: async () => ({ dir, commit: 'snap' }),
    ended: async () => undefined,
  } as unknown as ReturnType<GateOptions['checkouts']>;
}
function runner(dir: string, appended: EventInput[], ends: Map<string, (outcome: string) => void>): GateRunner {
  let runs = 0;
  return new GateRunner({
    raw: async () => [{ ms: 60_000 }], now: () => Date.now(), append: async (_c, input) => { appended.push(input); }, core: {} as Connection,
    start: async () => `run${++runs}`, ended: (run) => new Promise((done) => ends.set(run, done)), slots: () => ({ free: 1 }), budget_ms: 10, hold_ms: 100,
    checkouts: () => checkoutsOf(dir), invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined,
  });
}
const check = { check: 'slow-check', approved: 'x', command: 'sh slow-check', covers: ['R1'], depth: 'unit' as const, on_base: 'passes' as const, asserts: [] };
const until = async (test: () => boolean) => { for (let i = 0; i < 50 && !test(); i++) await new Promise((r) => setTimeout(r, 20)); };

describe('a slow run outdated by a newer claim', () => {
  it('is recorded stale only when the newer claim changed its check\'s inputs, naming that claim; the same tree stopped again outdates nothing', async () => {
    const dir = repo();
    const appended: EventInput[] = [];
    const ends = new Map<string, (outcome: string) => void>();
    const gate = runner(dir, appended, ends);
    const stop = (claim: string) => gate.stop({ session: 'S', claim, task: 'task:1', cwd: dir, base: 'b', requirements: [], checks: [check], stopAt: Date.now() });
    const first = await stop('claim:A');
    expect(first.slow).toEqual(['slow-check']);
    gate.turnEnded('claim:A');
    await until(() => ends.has('run1'));
    expect(ends.has('run1'), 'the slow run started at the turn end').toBe(true);
    // The same tree again: a question answered, the agent stops with the same words.
    const again = await stop('claim:B');
    expect(again.changed, 'nothing changed').toBe(false);
    // Then a real change.
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    const changed = await stop('claim:C');
    expect(changed.changed).toBe(true);
    ends.get('run1')!('passed');
    await until(() => appended.some((e) => e.kind === 'run.stale'));
    const stale = appended.filter((e) => e.kind === 'run.stale');
    expect(stale.map((e) => (e.data as { newer_claim: string }).newer_claim), 'outdated by the claim that changed the tree, never the one that didn\'t').toEqual(['claim:C']);
  }, 30_000);

  it('a run no newer claim changed the inputs of ends with no run.stale', async () => {
    const dir = repo();
    const appended: EventInput[] = [];
    const ends = new Map<string, (outcome: string) => void>();
    const gate = runner(dir, appended, ends);
    const stop = (claim: string) => gate.stop({ session: 'S', claim, task: 'task:1', cwd: dir, base: 'b', requirements: [], checks: [check], stopAt: Date.now() });
    await stop('claim:A');
    gate.turnEnded('claim:A');
    await until(() => ends.has('run1'));
    await stop('claim:B');
    ends.get('run1')!('passed');
    await new Promise((r) => setTimeout(r, 300));
    expect(appended.filter((e) => e.kind === 'run.stale'), 'the run is still the newest tree\'s').toEqual([]);
  }, 30_000);
});
