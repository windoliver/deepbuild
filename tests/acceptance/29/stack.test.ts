// #29 AC33 (the tree a stack served) and AC34 (a stack's start in the lanes). README sections 6 and 7, rules 2, 3, 11, 12.
import { describe, expect, it } from 'vitest';
import {
  attributeStack, simulate, type CheckDef, type Scenario, type SchedulerPlant, type StackDef, type StackRecords, type Trees,
} from '../../../packages/gate/src/index.ts';
import { check, edit, mustFail, prompt, runsOf, script, stop, stopOf } from './helpers.ts';

const W = '/tmp/dh29-stack/live';
const A = '/tmp/dh29-stack/checkout-A';
const B = '/tmp/dh29-stack/checkout-B';
const TREES: Trees = { checkout: A, worktree: W, others: [B], digests: { [`${A}/app`]: 'sha256:aaaa' } };
const none: StackRecords = { processes: [], containers: [] };
const good: StackRecords = {
  processes: [{ name: 'app-server', pid: 4101, cwd: `${A}/app`, reads: [`${A}/app/src/cart.ts`] }],
  containers: [{ name: 'db', binds: [`${A}/data`], image: { name: 'shop-app:test', built_from: { context: `${A}/app`, digest: 'sha256:aaaa' } } }],
};

// ---- AC33: the core works out the tree a stack served, from the supervisor's records.
describe('AC33 the tree a stack served, from the supervisor\'s records', () => {
  it('AC33 every record in the run\'s checkout: it served the checkout', () => {
    expect(attributeStack(good, TREES)).toEqual({ served: 'checkout' });
    expect(attributeStack(none, TREES), 'a stack with no records places nothing elsewhere').toEqual({ served: 'checkout' });
  });
  const cases: { name: string; records: StackRecords; kind: 'process' | 'mount' | 'image'; tree: string; named: string[] }[] = [
    { name: 'a host process whose working folder is in the live worktree', kind: 'process', tree: W, named: ['dev-server', `${W}/web`],
      records: { ...good, processes: [{ name: 'dev-server', pid: 4200, cwd: `${W}/web`, reads: [] }] } },
    { name: 'a host process that works in the checkout but read files of the live worktree', kind: 'process', tree: W, named: ['reloader'],
      records: { ...good, processes: [{ name: 'reloader', pid: 4201, cwd: `${A}/app`, reads: [`${W}/web/src/cart.ts`] }] } },
    { name: 'a container bind mount in the live worktree', kind: 'mount', tree: W, named: [`${W}/uploads`],
      records: { ...good, containers: [{ name: 'web', binds: [`${W}/uploads`], image: good.containers[0]!.image }] } },
    { name: 'an image built from a context in the live worktree', kind: 'image', tree: W, named: ['shop-app:live'],
      records: { ...good, containers: [{ name: 'web', binds: [], image: { name: 'shop-app:live', built_from: { context: `${W}/app`, digest: 'sha256:aaaa' } } }] } },
    { name: 'an image built from a checkout context whose digest differs from the checkout\'s files', kind: 'image', tree: A, named: ['shop-app:stale'],
      records: { ...good, containers: [{ name: 'web', binds: [], image: { name: 'shop-app:stale', built_from: { context: `${A}/app`, digest: 'sha256:bbbb' } } }] } },
    { name: 'a swap partway through the run to a newer snapshot\'s checkout', kind: 'process', tree: B, named: ['swapped'],
      records: { ...good, processes: [...good.processes, { name: 'swapped', pid: 4300, cwd: `${B}/app`, reads: [] }] } },
  ];
  for (const c of cases) {
    it(`AC33 ${c.name}: another tree, naming it`, () => {
      const r = attributeStack(c.records, TREES);
      expect(r.served, c.name).toBe('other');
      if (r.served !== 'other') return;
      expect(r.kind).toBe(c.kind);
      if (c.kind !== 'image' || c.tree === W) expect(r.tree).toBe(c.tree);
      for (const n of c.named) expect(r.named, `names ${n}`).toContain(n);
    });
  }
  it('AC33 a record the core can\'t place is unknown, naming it, never the checkout', () => {
    const image = attributeStack({ ...good, containers: [{ name: 'web', binds: [], image: { name: 'shop-app:mystery', built_from: null } }] }, TREES);
    expect(image.served).toBe('unknown');
    if (image.served === 'unknown') { expect(image.kind).toBe('image'); expect(image.named).toContain('shop-app:mystery'); }
    const proc = attributeStack({ ...good, processes: [{ name: 'daemon', pid: 4400, cwd: '/opt/nowhere', reads: [] }] }, TREES);
    expect(proc.served).toBe('unknown');
    if (proc.served === 'unknown') { expect(proc.kind).toBe('process'); expect(proc.named).toContain('daemon'); }
  });
  it('AC33 a gate that takes the environment\'s word for the tree reads the live worktree\'s process as the checkout and fails', async () => {
    await mustFail('takes-environments-word', () => expect(attributeStack(cases[0]!.records, TREES, { plant: 'takes-environments-word' }).served).toBe('other'));
  });
});

// ---- AC33 in the scheduler: a journey on a stack its environment starts.
type Mode = 'good' | 'warm-from-worktree' | 'always-worktree';
function stackFor(mode: Mode): StackDef {
  return {
    steps: [{ name: 'install', median_ms: 5000, inputs: ['package-lock.json'] }], per_run_ms: 1000, kept: true,
    start: ({ attempt, kept_product, checkout, worktree }) => {
      const fromWorktree = mode === 'always-worktree' || (mode === 'warm-from-worktree' && attempt === 1 && kept_product);
      const cwd = fromWorktree ? `${worktree}/web` : `${checkout}/web`;
      return { processes: [{ name: 'dev-server', pid: 5000 + attempt, cwd, reads: [] }], containers: [] };
    },
  };
}
function stackScenario(mode: Mode, plant?: SchedulerPlant) {
  const journey: CheckDef = check('journey:checkout', 300_000, { inputs: ['src/**'], stack: stackFor(mode), worktree_fails_on: 'B', ends: 'passed' });
  const sc: Scenario = {
    config: { slots: 2 },
    sessions: [script('V', 'claude', [check('unit', 2000, { inputs: ['src/**'] }), journey],
      [prompt(0), edit(500, 'A'), stop(1000, 'A', { id: 'A' }), edit(1500, 'B')])],
  };
  return simulate(sc, plant ? { plant } : {});
}
const J = 'journey:checkout';
describe('AC33 the scheduler: a journey runs on a stack from its own checkout', () => {
  it('AC33 the journey runs on a stack started from A\'s checkout, reads A\'s value, and its run records A\'s tree as served', () => {
    const t = stackScenario('good');
    const [r, ...more] = runsOf(t, J);
    expect(more, 'one run').toEqual([]);
    expect(r!.snapshot).toBe('A');
    expect(r!.result_snapshot).toBe('A');
    expect(r!.ran_in).toBe('checkout');
    expect(r!.outcome, 'the run reads $18.00 (A\'s), though the worktree now holds B').toBe('passed');
    expect(r!.stack?.served).toEqual({ served: 'checkout' });
    expect(r!.stack?.from).toBe('checkout');
    expect(t.claims[0]!.verdict).toBe('PASS');
  });
  it('AC33 a warm stack a planted environment started from the live worktree: the run is uncounted naming the process\'s folder and the worktree; the next run, from A\'s checkout with no kept product, counts', () => {
    const t = stackScenario('warm-from-worktree');
    const rs = runsOf(t, J);
    expect(rs.map((r) => r.outcome), 'uncounted, then counted').toEqual(['uncounted', 'passed']);
    expect(rs[0]!.reason).toContain(`${W}/web`);
    expect(rs[0]!.reason).toContain(W);
    expect(rs[0]!.stack?.served.served).toBe('other');
    expect(rs[0]!.stack?.attempt).toBe(1);
    expect(rs[1]!.stack?.attempt, 'the next run on that snapshot').toBe(2);
    expect(rs[1]!.stack?.kept_product, 'gets a stack with no kept product').toBe(false);
    expect(rs[1]!.stack?.served).toEqual({ served: 'checkout' });
    expect(rs[1]!.snapshot).toBe('A');
    expect(t.claims[0]!.checks[J]!.outcome).toBe('PASS');
    expect(t.claims[0]!.verdict).toBe('PASS');
  });
  it('AC33 a planted environment that always starts from the worktree makes the run missing and the check BLOCKED, naming the process\'s folder, never INCONCLUSIVE, PASS or FAIL', () => {
    const t = stackScenario('always-worktree');
    const rs = runsOf(t, J);
    expect(rs.map((r) => r.outcome)).toEqual(['uncounted', 'missing']);
    expect(rs[1]!.reason).toContain(`${W}/web`);
    expect(t.claims[0]!.checks[J]!.outcome).toBe('BLOCKED');
    expect(t.claims[0]!.verdict).toBe('BLOCKED');
  });
  it('AC33 a gate runner that takes the environment\'s word counts the planted runs and fails, naming the run', async () => {
    await mustFail('takes-environments-word, warm', () => {
      const t = stackScenario('warm-from-worktree', 'takes-environments-word');
      for (const r of runsOf(t, J)) expect(r.outcome, `run ${r.run} served ${JSON.stringify(r.stack?.served)}`).not.toBe('passed');
    }, ['run ']);
    await mustFail('takes-environments-word, always', () => {
      const t = stackScenario('always-worktree', 'takes-environments-word');
      for (const r of runsOf(t, J)) expect(['uncounted', 'missing'], `run ${r.run}`).toContain(r.outcome);
    }, ['run ']);
  });
});

// ---- AC34: the lanes add the start the stack needs now.
const LOCK = 'package-lock.json';
function warm(changed: string[], plant?: SchedulerPlant) {
  const stack: StackDef = {
    steps: [
      { name: 'install', median_ms: 60_000, inputs: [LOCK] },
      { name: 'migrate', median_ms: 20_000, inputs: [LOCK, 'migrations/**'] },
      { name: 'seed', median_ms: 10_000, inputs: [LOCK, 'seed/**'] },
    ],
    per_run_ms: 3000, kept: true,
    start: ({ checkout }) => ({ processes: [{ name: 'app', pid: 6001, cwd: `${checkout}/web`, reads: [] }], containers: [] }),
  };
  const sc: Scenario = {
    config: { budget_ms: 10_000, slots: 2 },
    sessions: [script('W', 'claude', [check('lint', 1000, { inputs: ['src/**'] }), check(J, 4000, { inputs: ['src/**', LOCK], stack })],
      [prompt(0), edit(500, 'S1', changed), stop(1000, 'S1', { changed, checkout_ms: 1000, id: 'W1' })])],
  };
  return simulate(sc, plant ? { plant } : {});
}
function ac34(plant?: SchedulerPlant) {
  const a = warm(['src/cart.ts'], plant);
  const s = stopOf(a, 'W', 1);
  expect(s.admitted, `check ${J}: 4 s + 3 s per run from a 1 s checkout ends at 8 s, inside the budget: fast lane`).toContain(J);
  expect(s.reply_at, `check ${J}: the reply comes when it ends`).toBe(1000 + 8000);
  expect(s.verdict, `check ${J}: its verdict is in the hold's reply`).toBe('PASS');
  const ra = runsOf(a, J)[0]!;
  expect(ra.lane).toBe('fast');
  expect(ra.expected_ms, 'expected adds the per-run part').toBe(7000);
  expect(ra.took_ms, 'a run\'s time leaves out its stack\'s start').toBe(4000);

  const b = warm(['src/cart.ts', LOCK], plant);
  const sb = stopOf(b, 'W', 1);
  expect(sb.slow, `check ${J}: 4 + 3 + 90 s doesn't fit: slow lane from the start`).toContain(J);
  expect(sb.admitted, `check ${J}: not admitted`).not.toContain(J);
  expect(sb.reply_at, 'the reply comes when the other checks end').toBe(1000 + 1000 + 1000);
  expect(sb.line).toContain('1 check running · about 2 min');
  const rb = runsOf(b, J)[0]!;
  expect(rb.lane).toBe('slow');
  expect(rb.expected_ms, `check ${J}: expected adds the median of each step that will run and the per-run part`).toBe(97_000);
  expect(rb.took_ms, 'a run\'s recorded time leaves out its stack\'s start').toBe(4000);
  expect(rb.stack?.steps, 'the start is recorded step by step').toEqual([{ name: 'install', ms: 60_000 }, { name: 'migrate', ms: 20_000 }, { name: 'seed', ms: 10_000 }]);
  expect(rb.stack?.attempt).toBe(1);
}
describe('AC34 a stack\'s start in the lanes', () => {
  it('AC34 a journey on a warm stack is fast-lane; the lockfile change makes install, migrate and seed run again and sends it to the slow lane, "1 check running · about 2 min"', () => ac34());
  it('AC34 a runner that sizes the lane by the journey\'s own runs alone puts the second in the fast lane and fails, naming the check', () => mustFail('sizes-lane-by-run-alone', () => ac34('sizes-lane-by-run-alone'), [`check ${J}`]));
  it('AC34 a stack\'s start runs only for a run that may start: a stop whose reply keeps the agent working starts none for its slow check', () => {
    const changed = ['src/cart.ts', LOCK];
    const sc: Scenario = {
      config: { budget_ms: 10_000, slots: 2 },
      sessions: [script('K', 'claude', [check('lint', 1000, { inputs: ['src/**'] }), check(J, 4000, { inputs: ['src/**', LOCK], stack: { steps: [{ name: 'install', median_ms: 60_000, inputs: [LOCK] }], per_run_ms: 3000, kept: true, start: ({ checkout }) => ({ processes: [{ name: 'app', pid: 6002, cwd: `${checkout}/web`, reads: [] }], containers: [] }) } })],
        [prompt(0), edit(500, 'S1', changed), stop(1000, 'S1', { changed, sorted: 'proceed' })])],
    };
    const t = simulate(sc);
    expect(stopOf(t, 'K', 1).kind).toBe('proceed');
    expect(runsOf(t, J), 'no run of the slow check').toEqual([]);
    expect(t.stacks, 'no stack started for it').toEqual([]);
  });
});
