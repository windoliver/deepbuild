// #1018's scope beyond its criteria: the readings sharing makes per repo (runs saved and their slot time, runs that
// waited on another session's run and how long), and a result pruned with its evidence never carrying.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RecordedRun } from '@deepbuild/gate';
import { GateRunner, type DefinitionState, type GateOptions, type RunKey, type StatePin } from '../src/gate-runner.js';
import type { KeyFacts } from '../src/shared-runs.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 5));
const SHA = 'a'.repeat(64);
const record = (run: string, read = ['src/a.ts']): RecordedRun => ({
  run, outcome: 'passed', testsRun: 1, failures: [], evidence: [], read, mask: null, exit: null,
  output: { stdout: '', stderr: '', sha256: { stdout: SHA, stderr: SHA } }, attempts: [], seeded: [], contract: null,
});

/** A workspace's state reading (#67): what a claim's checkout holds now, and what was pinned at the lock. */
const pin = (reading: string) => (): StatePin => ({ digests: [reading], files: { 'state/now.json': reading }, pinned: { 'state/lock.json': reading } });

/**
 * A gate whose runs end as the hub's do: recorded and keyed before `ended` resolves; `release` ends the runs held.
 * `records` changes a run's record (the nth run started, and whether it's a held-out variant's).
 */
function world(o: {
  kept?: boolean | ((evidence: string[]) => boolean); hold?: boolean; dir?: string; read?: string[]; variants?: 'none' | 'unstartable' | 'second-unstartable';
  records?: (n: number, variant: boolean) => Partial<RecordedRun>; runs?: number; definition?: DefinitionState; onBase?: 'fails'; state?: (session: string) => StatePin;
  /** The check's depth, and whether the checkout's done.yaml has an environment, so a journey runs on its stack (#580). */
  depth?: 'unit' | 'integration' | 'journey' | 'live'; stacked?: boolean; variantDirs?: boolean;
  /** A timing check (#352), whose result is the machine's load's as much as its files'. */
  timing?: boolean;
} = {}) {
  const started: { check: string; claim: string }[] = [];
  const finished: { run: string; check: string; key: KeyFacts }[] = [];
  const readings: { source: string; value: number; unit: string }[] = [];
  const keys = new Map<string, RunKey>();
  const unkeyed = new Set<string>();
  const bases: string[] = [];
  const held: (() => void)[] = [];
  /** Each variant run's checkout, and whether it held the claim's state reading when it started. */
  const variantStates: (string | null)[] = [];
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
      if (o.variants === 'second-unstartable' && r.runs.some((t) => t.endsWith('variant 2'))) throw Error('the snapshot is gone');
      if (o.variantDirs && r.runs.some((t) => t.includes('variant'))) { const dir = mkdtempSync(join(tmpdir(), 'dh1018-unit-')); dirs.push(dir); return { dir, commit: 'c1' }; }
      return { dir: checkout, commit: 'c1' };
    },
    baseCheckout: async () => ({ dir: checkout, commit: 'b', standIns: [] }),
    ended: async () => undefined,
  };
  let now = 0;
  const gate: GateRunner = new GateRunner({
    raw: async (q) => (q.includes('FROM runs WHERE id') ? [{ ms: 4000 }] : []), now: () => now, core: {} as GateOptions['core'],
    append: async (_c, e) => { if (e.kind === 'reading.recorded') { const d = e.data as { source: string; value: number; unit: string }; readings.push({ source: d.source, value: d.value, unit: d.unit }); } },
    start: async (r) => {
      started.push({ check: r.check, claim: r.claim });
      const run = `run:${started.length}`;
      keys.set(run, r.key ?? { check: r.check, stem: '', dir: r.cwd, claim: r.claim, session: '', base: false, withheld: r.overlay !== undefined });
      if (r.key?.base) bases.push(r.claim);
      if (r.overlay) variantStates.push(existsSync(join(r.cwd, 'state/now.json')) ? readFileSync(join(r.cwd, 'state/now.json'), 'utf8') : null);
      if (!r.key) unkeyed.add(run);
      return run;
    },
    ended: async (run) => {
      if (o.hold) await new Promise<void>((done) => held.push(done));
      now += 1500;
      const r = { ...record(run, o.read), ...o.records?.(Number(run.slice(4)), keys.get(run)!.withheld) };
      gate.recorded(run, r);
      if (!unkeyed.has(run)) finished.push({ run, check: keys.get(run)!.check, key: await gate.keyed(keys.get(run)!, run, r) });
      return r.outcome;
    },
    slots: () => ({ free: 4 }), budget_ms: 60_000, hold_ms: 60_000,
    checkouts: () => checkouts as unknown as ReturnType<GateOptions['checkouts']>,
    ...(o.stacked ? { stacked: () => true } : {}),
    invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined, kept: async (evidence) => (typeof o.kept === 'function' ? o.kept(evidence) : o.kept ?? true),
  });
  const claim = (session: string, n: number) => gate.stop({
    session, claim: `claim:${n}`, task: 'task:1', cwd: checkout, base: 'b', requirements: [], stopAt: now, ...(o.definition ? { definition: o.definition } : {}),
    ...(o.state ? { state: o.state(session) } : {}),
    checks: [{
      check: 'c.sh', approved: 'a', command: "sh 'c.sh'", covers: ['R1'], depth: o.depth ?? 'unit', on_base: o.onBase ?? 'passes', asserts: [], expected_ms: 1, ...(o.runs ? { runs: o.runs } : {}), ...(o.timing ? { timing: true } : {}),
      ...(o.variants ? { held_out: o.variants === 'second-unstartable' ? [{ files: { 'test/fixture.json': SHA } }, { files: { 'test/fixture.json': 'b'.repeat(64) } }] : [{ files: { 'test/fixture.json': SHA } }] } : {}),
    }],
  });
  return { gate, started, finished, readings, held, claim, checkout, bases, variantStates };
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

describe("#352 a timing check on another session's files", () => {
  it("lands on no key: the next session's claim on the same files runs its own, under its own load", async () => {
    const w = world({ timing: true });
    await w.claim('s1', 1);
    await w.claim('s2', 2);
    expect(w.started.map((s) => s.claim), 'each claim runs the timing check itself').toEqual(['claim:1', 'claim:2']);
    expect(w.finished, 'no run of it is keyed').toEqual([]);
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

describe('#1018 a workspace\'s state reading (#67) is part of the key', () => {
  it('a base run on another reading pinned at the lock never carries: each claim runs its own base', async () => {
    const readings: Record<string, string> = { s1: '{"open":1}', s2: '{"open":2}' };
    const w = world({ onBase: 'fails', read: ['c.sh', 'src/a.ts'], state: (session) => pin(readings[session]!)() });
    await w.claim('s1', 1);
    await w.claim('s2', 2);
    expect(w.bases).toEqual(['claim:1', 'claim:2']);
  });

  it('a base run on the same pinned reading still runs once for both sessions', async () => {
    const w = world({ onBase: 'fails', read: ['c.sh', 'src/a.ts'], state: pin('{"open":1}') });
    await w.claim('s1', 1);
    await w.claim('s2', 2);
    expect(w.bases).toEqual(['claim:1']);
  });

  it('a held-out variant runs on the claim\'s state reading, written into its own checkout', async () => {
    const w = world({ variants: 'none', variantDirs: true, state: pin('{"open":1}') });
    await w.claim('s1', 1);
    expect(w.variantStates).toEqual(['{"open":1}']);
  });

  it('a drift rerun runs the held-out variants again on the new reading, and the old reading\'s never count', async () => {
    // Reading 1: the run passes and its variant fails. Reading 2: the run passes and its variant fails again.
    const w = world({ variants: 'none', state: pin('{"open":1}'), records: (_n, variant) => (variant ? { outcome: 'failed', failures: [{ test: 'case', file: 'test/a.ts', line: 1, stack: null, assertion: true, message: 'no' }] } : {}) });
    await w.claim('s1', 1);
    expect(w.gate.rerun('claim:1', ['c.sh'], pin('{"open":2}')())).toBe(true);
    for (let i = 0; i < 200 && w.started.length < 4; i++) await tick();
    for (let i = 0; i < 20; i++) await tick();
    expect(w.started.length, 'the rerun runs the check and its variant').toBe(4);
    // A failed variant beside a passing run reads INCONCLUSIVE, never the PASS of a rerun without it.
    const check = w.gate.verdictOf('claim:1')?.checks.find((c) => c.check === 'c.sh');
    expect(check?.counted, 'only the new reading\'s run and variant count').toEqual(['run:3', 'run:4']);
    expect(check?.outcome).toBe('INCONCLUSIVE');
  });
});

describe('#1018 a journey on a warm stack (#580)', () => {
  it('a journey\'s drift rerun whose stack served another tree runs once more on a fresh stack, which counts', async () => {
    const w = world({ depth: 'journey', state: pin('{"open":1}'), records: (n) => (n === 2 ? { outcome: 'uncounted', mask: 'its stack served another tree' } : {}) });
    await w.claim('s1', 1);
    expect(w.gate.rerun('claim:1', ['c.sh'], pin('{"open":2}')())).toBe(true);
    for (let i = 0; i < 200 && w.started.length < 3; i++) await tick();
    for (let i = 0; i < 20; i++) await tick();
    expect(w.started.length, 'the run, the rerun, and the rerun once more').toBe(3);
    expect(w.gate.verdictOf('claim:1')?.checks.find((c) => c.check === 'c.sh')?.outcome).toBe('PASS');
  });

  it('a held-out variant whose stack served another tree is a missing run, never one left out', async () => {
    const w = world({ variants: 'none', records: (_n, variant) => (variant ? { outcome: 'uncounted', mask: 'its stack served another tree' } : {}) });
    await w.claim('s1', 1);
    const v = w.gate.verdictOf('claim:1')!;
    expect(v.outcome).toBe('BLOCKED');
    // Its reason is the withheld one: a variant's own cause never shows.
    expect(v.reasons.join(' ')).toContain('a held-out variant of its fixtures never ran');
  });

  it('a journey\'s held-out variant whose stack served another tree runs once more on a fresh stack, which counts', async () => {
    const w = world({ variants: 'none', depth: 'journey', records: (n, variant) => (variant && n === 2 ? { outcome: 'uncounted', mask: 'its stack served another tree' } : {}) });
    await w.claim('s1', 1);
    expect(w.started.length, 'the run, its variant, and the variant once more').toBe(3);
    expect(w.gate.verdictOf('claim:1')?.outcome).toBe('PASS');
  });

  it('another session\'s claim neither carries nor waits on a journey run on its stack', async () => {
    const w = world({ depth: 'journey', stacked: true, hold: true });
    const first = w.claim('s1', 1);
    for (let i = 0; i < 50 && !w.held.length; i++) await tick();
    const second = w.claim('s2', 2);
    for (let i = 0; i < 50 && w.held.length < 2; i++) await tick();
    expect(w.started, 'the second claim starts its own run while the first is going').toEqual([{ check: 'c.sh', claim: 'claim:1' }, { check: 'c.sh', claim: 'claim:2' }]);
    for (const done of w.held.splice(0)) done();
    await Promise.all([first, second]);
    expect(w.finished, 'neither run is keyed').toEqual([]);
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

describe('#1018 kept keys read again after a restart, review findings', () => {
  /** Real reports list one attempt for each test, as checks-command reads them. */
  const tested = (): Partial<RecordedRun> => ({ attempts: [{ test: 't', outcome: 'passed' }] });

  it('a kept run whose tests each ran once is read again: the next session\'s claim carries it', async () => {
    const before = world({ records: tested });
    await before.claim('s1', 1);
    const [ran] = before.finished;
    const after = world({ dir: before.checkout });
    after.gate.kept([{ run: ran!.run, check: ran!.check, outcome: 'passed', tests_run: 1, findings: [], evidence: [SHA, SHA], key: ran!.key }]);
    await after.claim('s2', 2);
    expect(after.started).toEqual([]);
  });

  it('a key with a run that can\'t be read again carries nothing after a restart, though its other runs can', async () => {
    const before = world();
    await before.claim('s1', 1);
    const [ran] = before.finished;
    const after = world({ dir: before.checkout });
    after.gate.kept([
      { run: ran!.run, check: ran!.check, outcome: 'passed', tests_run: 1, findings: [], evidence: [SHA, SHA], key: ran!.key },
      { run: 'run:x', check: ran!.check, outcome: 'failed', tests_run: 1, findings: ['t (src/a.ts:1): boom'], evidence: [SHA, SHA], key: { ...ran!.key, claim: 'claim:3', session: 'session:s3', plain: false } },
    ]);
    await after.claim('s2', 2);
    expect(after.started.map((s) => s.claim)).toEqual(['claim:2']);
  });

  it('a kept run whose failures don\'t all survive run.finished is never read again', async () => {
    const failure = (file: string) => ({ test: 't', file, line: 3, stack: null, assertion: true, message: 'boom' });
    const parens = world({ records: () => ({ outcome: 'failed', failures: [failure('app/(shop)/c.test.ts')] }) });
    await parens.claim('s1', 1);
    expect(parens.finished[0]!.key.plain).toBe(false);
    const many = world({ records: () => ({ outcome: 'failed', failures: Array.from({ length: 21 }, (_, i) => failure(`test/c${i}.test.ts`)) }) });
    await many.claim('s1', 1);
    expect(many.finished[0]!.key.plain).toBe(false);
  });
});

describe('#1018 review findings on carrying', () => {
  it('a check whose second held-out variant never runs never passes, however many claims run its first', async () => {
    const w = world({ variants: 'second-unstartable' });
    await w.claim('s1', 1);
    await w.claim('s3', 3);
    await w.claim('s2', 2);
    expect(w.gate.verdictOf('claim:2')?.outcome).not.toBe('PASS');
  });

  it('a run pruned with its evidence counts for no claim, the one that runs its own beside it included', async () => {
    const PRUNED = 'c'.repeat(64);
    const w = world({ runs: 2, kept: (evidence) => !evidence.includes(PRUNED), records: (n) => (n === 1 ? { output: { stdout: '', stderr: '', sha256: { stdout: PRUNED, stderr: SHA } } } : {}) });
    await w.claim('s1', 1);
    await w.claim('s2', 2);
    expect(w.gate.verdictOf('claim:2')?.checks.find((c) => c.check === 'c.sh')?.counted).toEqual(['run:2']);
  });

  it('a run that read only its check\'s script and test files saw no code under test, so the next claim runs its own', async () => {
    const w = world({ read: ['c.sh', 'test/a.test.ts'] });
    await w.claim('s1', 1);
    await w.claim('s2', 2);
    expect(w.started.map((s) => s.claim)).toEqual(['claim:1', 'claim:2']);
  });

  it('a key whose check\'s own run was pruned carries nothing from its held-out variant\'s run alone', async () => {
    const PRUNED = 'c'.repeat(64);
    const w = world({ variants: 'none', kept: (evidence) => !evidence.includes(PRUNED), records: (n) => (n === 1 ? { output: { stdout: '', stderr: '', sha256: { stdout: PRUNED, stderr: SHA } } } : {}) });
    await w.claim('s1', 1);
    await w.claim('s2', 2);
    expect(w.started.map((s) => s.claim)).toEqual(['claim:1', 'claim:1', 'claim:2', 'claim:2']);
  });

  it('a carried check never reaches through its key\'s held-out variant\'s run, its check\'s own run pruned', async () => {
    const PRUNED = 'c'.repeat(64);
    let pruned = false;
    const w = world({
      variants: 'none', kept: (evidence) => !(pruned && evidence.includes(PRUNED)),
      records: (n, variant) => (variant ? { read: ['src/a.ts', 'test/fixture.json'] } : n === 1 ? { output: { stdout: '', stderr: '', sha256: { stdout: PRUNED, stderr: SHA } } } : {}),
    });
    await w.claim('s1', 1);
    await w.claim('s2', 2);
    pruned = true;
    await w.claim('s3', 3);
    expect(w.gate.reached('claim:2') ?? []).not.toContain('test/fixture.json');
  });

  it('a claim whose check is carried reaches the files its key\'s runs read', async () => {
    const w = world();
    await w.claim('s1', 1);
    await w.claim('s2', 2);
    expect(w.started.map((s) => s.claim)).toEqual(['claim:1']);
    expect(w.gate.reached('claim:2')).toEqual(['src/a.ts']);
  });

  it('a carried failure replies at once while the definition is still to lock', async () => {
    const w = world({ definition: 'waiting', records: () => ({ outcome: 'failed', failures: [{ test: 't', file: 'test/a.test.ts', line: 1, stack: null, assertion: true, message: 'boom' }] }) });
    await w.claim('s1', 1);
    const replied = await Promise.race([w.claim('s2', 2).then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), 3000))]);
    expect(w.started.map((s) => s.claim)).toEqual(['claim:1']);
    expect(replied, 'the carried FAIL goes back at once, not at the end of the hold').toBe(true);
  });

  it('a held-out variant\'s attempts name none of its tests, and its flake still reads INCONCLUSIVE', async () => {
    const w = world({ variants: 'none', records: (_n, variant) => (variant ? { attempts: [{ test: 'secret case', outcome: 'failed' }, { test: 'secret case', outcome: 'passed' }] } : {}) });
    await w.claim('s1', 1);
    const v = w.gate.verdictOf('claim:1')!;
    expect(JSON.stringify(v)).not.toContain('secret case');
    expect(v.outcome).toBe('INCONCLUSIVE');
  });
});
