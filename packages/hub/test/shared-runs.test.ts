// #1018's scope beyond its criteria: the readings sharing makes per repo (runs saved and their slot time, runs that
// waited on another session's run and how long), and a result pruned with its evidence never carrying.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordedRun } from '@deepbuild/gate';
import { GateRunner, type GateOptions, type RunKey } from '../src/gate-runner.js';
import type { KeyFacts } from '../src/shared-runs.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 5));
const SHA = 'a'.repeat(64);
const record = (run: string, read = ['src/a.ts']): RecordedRun => ({
  run, outcome: 'passed', testsRun: 1, failures: [], evidence: [], read, mask: null, exit: null,
  output: { stdout: '', stderr: '', sha256: { stdout: SHA, stderr: SHA } }, attempts: [], seeded: [], contract: null,
});

/** A gate whose runs end as the hub's do: recorded and keyed before `ended` resolves; `release` ends the runs held. */
function world(o: { kept?: boolean; hold?: boolean; dir?: string; read?: string[]; variants?: 'none' | 'unstartable' } = {}) {
  const started: { check: string; claim: string }[] = [];
  const finished: { run: string; check: string; key: KeyFacts }[] = [];
  const readings: { source: string; value: number; unit: string }[] = [];
  const keys = new Map<string, RunKey>();
  const held: (() => void)[] = [];
  const checkout = o.dir ?? mkdtempSync(join(tmpdir(), 'dh1018-unit-'));
  if (!o.dir) {
    dirs.push(checkout);
    mkdirSync(join(checkout, 'src'));
    writeFileSync(join(checkout, 'src/a.ts'), 'a\n');
  }
  const checkouts = {
    budget: () => ({ since: 0 }),
    snapshot: async () => ({ commit: 'c1', wrote: true }),
    checkout: async (r: { runs: string[] }) => {
      if (o.variants === 'unstartable' && r.runs.some((t) => t.includes('variant'))) throw Error('the snapshot is gone');
      return { dir: checkout, commit: 'c1' };
    },
    ended: async () => undefined,
  };
  let now = 0;
  const gate: GateRunner = new GateRunner({
    raw: async (q) => (q.includes('FROM runs WHERE id') ? [{ ms: 4000 }] : []), now: () => now, core: {} as GateOptions['core'],
    append: async (_c, e) => { if (e.kind === 'reading.recorded') { const d = e.data as { source: string; value: number; unit: string }; readings.push({ source: d.source, value: d.value, unit: d.unit }); } },
    start: async (r) => { started.push({ check: r.check, claim: r.claim }); const run = `run:${started.length}`; keys.set(run, r.key!); return run; },
    ended: async (run) => {
      if (o.hold) await new Promise<void>((done) => held.push(done));
      now += 1500;
      gate.recorded(run, record(run, o.read));
      finished.push({ run, check: keys.get(run)!.check, key: await gate.keyed(keys.get(run)!, run, record(run, o.read)) });
      return 'passed';
    },
    slots: () => ({ free: 4 }), budget_ms: 60_000, hold_ms: 60_000,
    checkouts: () => checkouts as unknown as ReturnType<GateOptions['checkouts']>,
    invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined, kept: async () => o.kept ?? true,
  });
  const claim = (session: string, n: number) => gate.stop({
    session, claim: `claim:${n}`, task: 'task:1', cwd: checkout, base: 'b', requirements: [], stopAt: now,
    checks: [{ check: 'c.sh', approved: 'a', command: "sh 'c.sh'", covers: ['R1'], depth: 'unit', on_base: 'passes', asserts: [], expected_ms: 1, ...(o.variants ? { held_out: [{ files: { 'test/fixture.json': SHA } }] } : {}) }],
  });
  return { gate, started, finished, readings, held, claim, checkout };
}

describe('#1018 readings, per repo', () => {
  it('a check carried from another session records a run saved and the slot time its source run took', async () => {
    const w = world();
    await w.claim('s1', 1);
    await w.claim('s2', 2);
    expect(w.started).toEqual([{ check: 'c.sh', claim: 'claim:1' }]);
    expect(w.readings.map((r) => [r.source.split(' · ')[0], r.value, r.unit])).toEqual([
      ['runs saved by carrying across sessions', 1, 'runs'], ['slot time saved by carrying across sessions', 4000, 'ms'],
    ]);
  });

  it('a check that waits on another session\'s run records the wait and how long it took', async () => {
    const w = world({ hold: true });
    const first = w.claim('s1', 1);
    for (let i = 0; i < 50 && !w.held.length; i++) await tick();
    const second = w.claim('s2', 2);
    for (let i = 0; i < 10; i++) await tick();
    w.held.shift()!();
    await Promise.all([first, second]);
    expect(w.started).toHaveLength(1);
    const waited = w.readings.filter((r) => r.source.startsWith('runs that waited') || r.source.startsWith('time waited'));
    expect(waited.map((r) => [r.source.split(' · ')[0], r.unit])).toEqual([["runs that waited on another session's run", 'runs'], ["time waited on another session's run", 'ms']]);
    expect(waited[1]!.value).toBe(1500);
  });
});

describe('#1018 a result is pruned with its evidence', () => {
  it('a run whose evidence the store no longer keeps never carries: the next claim runs its own', async () => {
    const w = world({ kept: false });
    await w.claim('s1', 1);
    await w.claim('s2', 2);
    expect(w.started.map((s) => s.claim)).toEqual(['claim:1', 'claim:2']);
    expect(w.readings).toEqual([]);
  });
});

describe('#1018 kept in the record, by key', () => {
  it('a restarted hub reads each kept key again as its own check\'s: copies under other checks never count for it', async () => {
    const before = world();
    await before.claim('s1', 1);
    const [ran] = before.finished;
    const row = (run: string, check: string) => ({ run, check, outcome: 'passed', tests_run: 1, findings: [], evidence: [SHA, SHA], key: ran!.key });
    const after = world({ dir: before.checkout });
    after.gate.kept([row(ran!.run, ran!.check), ...[1, 2, 3].map((n) => row(`run:k${n}`, `kept-${n}.sh`))]);
    await after.claim('s2', 2);
    expect(after.started).toEqual([]);
    expect(after.gate.verdictOf('claim:2')?.checks.find((c) => c.check === 'c.sh')?.counted).toEqual([ran!.run]);
  });
});

describe('#1018 what never carries', () => {
  it('a key whose held-out variant never ran neither passes its own claim nor carries to another', async () => {
    const w = world({ variants: 'unstartable' });
    await w.claim('s1', 1);
    expect(w.gate.verdictOf('claim:1')?.outcome).not.toBe('PASS');
    await w.claim('s2', 2);
    expect(w.started.map((s) => s.claim)).toEqual(['claim:1', 'claim:2']);
  });

  it('a run that read only its check\'s own files saw no code under test, so the next claim runs its own', async () => {
    const w = world({ read: ['test/a.test.ts'] });
    await w.claim('s1', 1);
    await w.claim('s2', 2);
    expect(w.started.map((s) => s.claim)).toEqual(['claim:1', 'claim:2']);
  });

  it('after a restart, a kept run whose record isn\'t whole in the record (a retried test) is not read again', async () => {
    const before = world();
    await before.claim('s1', 1);
    const [ran] = before.finished;
    const after = world({ dir: before.checkout });
    after.gate.kept([{ run: ran!.run, check: ran!.check, outcome: 'passed', tests_run: 1, findings: [], evidence: [SHA, SHA], key: { ...ran!.key, plain: false } }]);
    await after.claim('s2', 2);
    expect(after.started.map((s) => s.claim)).toEqual(['claim:2']);
  });
});
