// The gate runner's stale runs (#45): a slow run is outdated only by a newer claim whose snapshot changed its check's
// inputs; a newer claim with the same tree, a question answered and the same words stopped again, carries the run and
// writes no run.stale.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Connection, EventInput } from '@deepbuild/record';
import { GateRunner } from '../src/gate-runner.js';

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

describe('a slow run outdated by a newer claim', () => {
  it('is recorded stale only when the newer claim changed its check\'s inputs, naming that claim; the same tree stopped again outdates nothing', async () => {
    const dir = repo();
    const appended: EventInput[] = [];
    const ends = new Map<string, (outcome: string) => void>();
    let runs = 0;
    const gate = new GateRunner({
      raw: async () => [{ ms: 60_000 }],
      now: () => Date.now(),
      append: async (_c, input) => { appended.push(input); },
      core: {} as Connection,
      start: async () => `run${++runs}`,
      ended: (run) => new Promise((done) => ends.set(run, done)),
      slots: () => ({ free: 1 }),
      budget_ms: 10,
      hold_ms: 100,
    });
    const check = { check: 'slow-check', approved: 'x', on_base: 'passes' as const };
    const stop = (claim: string) => gate.stop({ session: 'S', claim, cwd: dir, checks: [check], stopAt: Date.now() });
    const first = await stop('claim:A');
    expect(first.slow).toEqual(['slow-check']);
    gate.turnEnded('claim:A');
    for (let i = 0; i < 50 && !ends.has('run1'); i++) await new Promise((r) => setTimeout(r, 20));
    expect(ends.has('run1'), 'the slow run started at the turn end').toBe(true);
    // The same tree again: a question answered, the agent stops with the same words.
    const again = await stop('claim:B');
    expect(again.changed, 'nothing changed').toBe(false);
    // Then a real change.
    writeFileSync(join(dir, 'a.txt'), 'two\n');
    const changed = await stop('claim:C');
    expect(changed.changed).toBe(true);
    ends.get('run1')!('passed');
    for (let i = 0; i < 50 && !appended.some((e) => e.kind === 'run.stale'); i++) await new Promise((r) => setTimeout(r, 20));
    const stale = appended.filter((e) => e.kind === 'run.stale');
    expect(stale.map((e) => (e.data as { newer_claim: string }).newer_claim), 'outdated by the claim that changed the tree, never the one that didn\'t').toEqual(['claim:C']);
  }, 30_000);

  it('a run no newer claim changed the inputs of ends with no run.stale', async () => {
    const dir = repo();
    const appended: EventInput[] = [];
    const ends = new Map<string, (outcome: string) => void>();
    let runs = 0;
    const gate = new GateRunner({
      raw: async () => [{ ms: 60_000 }], now: () => Date.now(), append: async (_c, input) => { appended.push(input); }, core: {} as Connection,
      start: async () => `run${++runs}`, ended: (run) => new Promise((done) => ends.set(run, done)), slots: () => ({ free: 1 }), budget_ms: 10, hold_ms: 100,
    });
    const check = { check: 'slow-check', approved: 'x', on_base: 'passes' as const };
    await gate.stop({ session: 'S', claim: 'claim:A', cwd: dir, checks: [check], stopAt: Date.now() });
    gate.turnEnded('claim:A');
    for (let i = 0; i < 50 && !ends.has('run1'); i++) await new Promise((r) => setTimeout(r, 20));
    await gate.stop({ session: 'S', claim: 'claim:B', cwd: dir, checks: [check], stopAt: Date.now() });
    ends.get('run1')!('passed');
    await new Promise((r) => setTimeout(r, 300));
    expect(appended.filter((e) => e.kind === 'run.stale'), 'the run is still the newest tree\'s').toEqual([]);
  }, 30_000);
});
