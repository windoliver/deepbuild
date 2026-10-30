// #29 AC12, AC23, AC27, AC28, AC29, AC30, AC31: the queue, latest snapshot wins, stale results, on the scheduler's
// virtual clock (README, section 7). Each criterion's wrong program runs through the same assertion and must fail it.
import { describe, expect, it } from 'vitest';
import { simulate, type CheckDef, type ClaimRecord, type Scenario, type SchedulerPlant, type ScriptEvent, type Trace } from '../../../packages/gate/src/index.ts';
import { check, edit, mustFail, prompt, runsOf, script, stop, stopOf } from './helpers.ts';

const sim = (s: Scenario, plant?: SchedulerPlant): Trace => (plant ? simulate(s, { plant }) : simulate(s));
const cfg = { slots: 2, budget_ms: 10_000, hold_ms: 60_000 };
const claimOn = (t: Trace, snapshot: string, session?: string): ClaimRecord => {
  const c = t.claims.find((x) => x.snapshot === snapshot && (session === undefined || x.session === session));
  if (!c) throw Error(`no claim on ${snapshot} in the trace`);
  return c;
};
const queuedFor = (t: Trace, check: string) => t.queue.filter((q) => q.check === check && q.op === 'queued');

describe('AC12 a claim on unchanged sources whose last verdict\'s evidence retention removed runs its checks again', () => {
  const run = (retention: boolean): Trace => {
    const events: ScriptEvent[] = [stop(0, 'S1'), ...(retention ? [{ at: 50_000, kind: 'retention' } as ScriptEvent] : []), stop(100_000, 'S1', { changed: [] })];
    return sim({ config: cfg, sessions: [script('s', 'claude', [check('lint', 2000, { inputs: ['src/**'] }), check('unit', 3000, { inputs: ['src/**'] })], events)] });
  };
  it('AC12 after retention removed the evidence the unchanged stop runs lint and unit again, and carries nothing', () => {
    const t = run(true);
    const second = stopOf(t, 's', 2);
    for (const id of ['lint', 'unit']) {
      expect(second.admitted, `${id} runs again instead of reusing a verdict whose evidence is gone`).toContain(id);
      const again = runsOf(t, id).filter((r) => r.started_at >= 100_000);
      expect(again, `${id} has a new run on the unchanged snapshot`).toHaveLength(1);
      expect(again[0]!.snapshot).toBe('S1');
      expect(claimOn(t, 'S1', 's').checks[id]).toBeDefined();
    }
    const c2 = t.claims[1]!;
    for (const id of ['lint', 'unit']) {
      expect(c2.checks[id]!.carried_from, `${id} carries nothing`).toBeNull();
      expect(c2.checks[id]!.carried_runs).toEqual([]);
      expect(c2.checks[id]!.runs, `${id} lists its new run`).toHaveLength(1);
    }
    expect(second.reply_at, 'both start at 100 s on free slots: reply when the 3 s unit ends').toBe(103_000);
  });
  it('AC12 without the removal the same unchanged stop reuses (the control)', () => {
    const t = run(false);
    expect(t.runs.filter((r) => r.started_at >= 100_000)).toHaveLength(0);
    expect(t.claims[1]!.checks.lint!.carried_from).toBe('S1');
  });
});

describe('AC23 the slow check\'s result is its snapshot\'s, whatever the agent does to the worktree meanwhile', () => {
  const rewritten = (ctx: { snapshot: string }) => ({ took_ms: 30_000, outcome: ctx.snapshot === 'S2' ? ('failed' as const) : ('passed' as const) });
  const run = (plant?: SchedulerPlant): Trace => sim({
    config: cfg,
    sessions: [script('s', 'claude', [
      check('lint', 3000, { inputs: ['src/**'] }),
      check('docs', 2000, { inputs: ['docs/**'] }),
      check('journey', 30_000, { inputs: ['src/**'], run: rewritten }),
    ], [
      stop(0, 'S1', { changed: ['src/cart.ts', 'docs/a.md'] }),
      prompt(5000, 'human'),
      edit(10_000, 'S2'),            // the agent rewrites src/cart.ts while the journey runs
      stop(20_000, 'S2', { changed: ['src/cart.ts'] }),
    ])],
  }, plant);
  const assertion = (t: Trace): void => {
    const [first, second] = runsOf(t, 'journey');
    expect(first, 'the journey ran on the first snapshot').toBeDefined();
    expect(first!.ran_in, 'journey runs in the check\'s own checkout, never the session\'s worktree').toBe('checkout');
    expect(first!.snapshot).toBe('S1');
    expect(first!.result_snapshot, 'journey reports on the snapshot it ran on').toBe('S1');
    expect(first!.outcome, 'the rewritten file\'s failure is not on the first claim: journey').toBe('passed');
    expect(first!.started_at).toBe(3000);
    expect(first!.ended_at).toBe(33_000);
    const c1 = claimOn(t, 'S1', 's');
    expect(c1.checks.journey!.outcome, 'journey on the first claim').toBe('PASS');
    expect(t.deliveries.find((d) => d.check === 'journey' && d.snapshot === 'S1')?.snapshot, 'the verdict names the snapshot commit').toBe('S1');
    expect(c1.stale, 'the first claim is stale once the next claim changed its inputs').toBe(true);
    const c2 = claimOn(t, 'S2', 's');
    expect(second, 'journey runs again on the next snapshot').toBeDefined();
    expect(second!.snapshot).toBe('S2');
    expect(second!.started_at, 'it starts when the first run ends').toBe(33_000);
    expect(runsOf(t, 'journey'), 'journey ran exactly twice').toHaveLength(2);
    expect(c2.checks.journey!.carried_from, 'journey is not carried: its inputs include src/cart.ts').toBeNull();
    expect(runsOf(t, 'lint'), 'lint reruns: its inputs include src/cart.ts').toHaveLength(2);
    expect(runsOf(t, 'docs'), 'docs is not rerun: its inputs do not include src/cart.ts').toHaveLength(1);
    expect(c2.checks.docs!.carried_from, 'docs carries its result').toBe('S1');
    expect(c2.checks.docs!.carried_runs, 'docs lists the run it carries').toEqual(runsOf(t, 'docs').map((r) => r.run));
    expect(c2.checks.docs!.outcome).toBe('PASS');
  };
  it('AC23 the journey\'s result is S1\'s (33 s), the next claim is stale-checked and reruns journey, docs carried', () => assertion(run()));
  it('AC23 a runner that runs checks in the session\'s worktree reports the rewritten file\'s failure, naming journey', async () => {
    await mustFail('runs-in-worktree', () => assertion(run('runs-in-worktree')), ['journey']);
  });
  it('AC23 a runner that reruns every check on the new snapshot fails it too, naming docs', async () => {
    await mustFail('reruns-every-check', () => assertion(run('reruns-every-check')), ['docs']);
  });
});

/** The criterion's four stops, on two slots: a 10 s typecheck, a 300 s journey on one ask. */
function fourStops(ids: [string, string, string, string], journeyEnds: 'passed' | 'failed'): Scenario {
  const [s1, s2, s3, s4] = ids;
  return {
    config: cfg,
    sessions: [script('s', 'claude', [
      check('typecheck', 10_000, { inputs: ['src/**'], ends: { [s3]: 'failed' } }),
      check('journey:checkout', 300_000, { inputs: ['src/**'], ends: { [s1]: journeyEnds } }),
    ], [
      stop(0, s1, { id: 'stop-1' }),
      stop(60_000, s2, { sorted: 'proceed', id: 'stop-2' }),
      stop(120_000, s3, { id: 'stop-3' }),
      stop(180_000, s4, { id: 'stop-4' }),
    ])],
  };
}

describe('AC27 four stops, a 300 s journey: it runs on the first snapshot and reports on it; only the fourth is queued', () => {
  const run = (plant?: SchedulerPlant): Trace => sim(fourStops(['S1', 'S2', 'S3', 'S4'], 'passed'), plant);
  const assertion = (t: Trace): void => {
    const journeys = runsOf(t, 'journey:checkout');
    const first = journeys.find((r) => r.snapshot === 'S1');
    expect(first, 'journey on S1 ran').toBeDefined();
    expect(first!.outcome, 'journey on S1 is not stopped for a newer snapshot').toBe('passed');
    expect(first!.started_at, 'journey on S1 starts when its stop\'s fast lane ends').toBe(10_000);
    expect(first!.ended_at, 'journey on S1 runs on through the three later stops').toBe(310_000);
    expect(first!.result_snapshot, 'journey on S1 reports on S1').toBe('S1');
    const queued = queuedFor(t, 'journey:checkout');
    expect(queued.find((q) => q.snapshot === 'S2'), 'S2 is never queued (a "proceed" kept the agent working)').toBeUndefined();
    expect(queued.find((q) => q.snapshot === 'S3'), 'S3 is never queued (sent back on its typecheck)').toBeUndefined();
    expect(journeys.find((r) => r.snapshot === 'S2' || r.snapshot === 'S3'), 'no run on S2 or S3').toBeUndefined();
    const fourth = queued.find((q) => q.snapshot === 'S4');
    expect(fourth, 'S4 is queued').toBeDefined();
    expect(fourth!.at, 'S4 is queued at 190 s').toBe(190_000);
    const last = journeys.find((r) => r.snapshot === 'S4');
    expect(last, 'journey on S4 ran').toBeDefined();
    expect(last!.started_at, 'journey on S4 starts at 310 s').toBe(310_000);
    expect(journeys).toHaveLength(2);
    const delivered = t.deliveries.find((d) => d.check === 'journey:checkout' && d.snapshot === 'S1');
    expect(delivered, 'the S1 result is reported, labelled as S1\'s').toBeDefined();
    expect(delivered!.at).toBe(310_000);
    expect(delivered!.stale, 'S1\'s result is stale: a newer claim exists').toBe(true);
    expect(delivered!.carried).toBe(false);
    expect([1, 2, 3, 4].map((n) => stopOf(t, 's', n).kind)).toEqual(['ends_turn', 'proceed', 'send_back', 'ends_turn']);
    expect([1, 2, 3, 4].map((n) => stopOf(t, 's', n).reply_at)).toEqual([10_000, 70_000, 130_000, 190_000]);
  };
  it('AC27 journey on S1 runs 10 s to 310 s; S2 and S3 are never queued; S4 is queued at 190 s and starts at 310 s', () => assertion(run()));
  it('AC27 a runner that stops a run when a newer snapshot comes reports nothing for S1', async () => {
    await mustFail('stops-run-on-newer-snapshot', () => assertion(run('stops-run-on-newer-snapshot')), ['S1']);
  });
  it('AC27 a runner that queues every green snapshot queues S2', async () => {
    await mustFail('queues-every-green-snapshot', () => assertion(run('queues-every-green-snapshot')), ['S2']);
  });
  it('AC27 a runner that ignores the fast-lane checks queues S3', async () => {
    await mustFail('ignores-fast-lane-results', () => assertion(run('ignores-fast-lane-results')), ['S3']);
  });
});

describe('AC28 which stops start a slow check', () => {
  const stack = (): NonNullable<CheckDef['stack']> => ({
    steps: [], per_run_ms: 0, kept: true,
    start: (ctx) => ({ processes: [{ name: 'app', pid: 1, cwd: ctx.checkout, reads: [] }], containers: [] }),
  });
  const defs = (o: { typecheck?: 'failed'; repro?: 'failed' }): CheckDef[] => [
    check('typecheck', 4000, { inputs: ['src/**'], ...(o.typecheck ? { ends: o.typecheck } : {}) }),
    check('repro', 3000, { on_base: 'fails', inputs: ['src/**'], ...(o.repro ? { ends: o.repro } : {}) }),
    check('journey', 100_000, { inputs: ['src/**'], deadline_ms: 120_000, stack: stack() }),
  ];
  const run = (plant?: SchedulerPlant): Trace => sim({
    config: { slots: 12, budget_ms: 10_000, hold_ms: 60_000, stop_timeout_ms: 2_700_000 },
    sessions: [
      script('sent-back-typecheck', 'claude', defs({ typecheck: 'failed' }), [stop(0, 'S1')]),
      script('sent-back-repro', 'claude', defs({ repro: 'failed' }), [stop(0, 'S1')]),
      script('proceed', 'claude', defs({}), [stop(0, 'S1', { sorted: 'proceed' })]),
      script('green', 'claude', defs({}), [stop(0, 'S1')]),
      script('codex-proceed', 'codex-observed', defs({}), [stop(0, 'S1', { sorted: 'proceed' })]),
      script('codex-green', 'codex-observed', defs({}), [stop(0, 'S1')]),
    ],
  }, plant);
  const journeyRuns = (t: Trace, session: string) => t.runs.filter((r) => r.session === session && r.check === 'journey');
  const assertion = (t: Trace): void => {
    for (const s of ['sent-back-typecheck', 'sent-back-repro']) {
      expect(journeyRuns(t, s), `the stop of ${s} is sent back: no journey starts`).toHaveLength(0);
      expect(stopOf(t, s, 1).kind).toBe('send_back');
      expect(stopOf(t, s, 1).reply_at).toBe(4000);
    }
    expect(journeyRuns(t, 'proceed'), 'a green stop answered "proceed" starts no journey, a slot being free').toHaveLength(0);
    expect(stopOf(t, 'proceed', 1).kind).toBe('proceed');
    const [green] = journeyRuns(t, 'green');
    expect(green, 'a green stop whose reply ends the turn starts a journey (green)').toBeDefined();
    expect(green!.started_at, 'journey starts when green\'s fast-lane checks end').toBe(4000);
    expect(green!.started_by).toBe('turn_end');
    expect(stopOf(t, 'green', 1).reply_at, 'a Claude stop replies when its fast lane ends').toBe(4000);
    expect(journeyRuns(t, 'codex-proceed'), 'an observed Codex stop answered "proceed" starts no journey').toHaveLength(0);
    const cp = stopOf(t, 'codex-proceed', 1);
    expect(cp.kind).toBe('proceed');
    expect(cp.reply_at, 'codex-proceed gets its reply when its fast-lane checks end').toBe(4000);
    const [cg] = journeyRuns(t, 'codex-green');
    expect(cg, 'the twin whose reply ends the turn starts the journey (codex-green)').toBeDefined();
    expect(cg!.started_at).toBe(4000);
    const twin = stopOf(t, 'codex-green', 1);
    expect(twin.kind).toBe('ends_turn');
    expect(twin.reply_at, 'codex-green is held until the journey lands').toBe(104_000);
    expect(twin.held.slow, 'codex-green: the wait for the journey is a slow hold').toBe(100_000);
    // No stack starts for a run that may not start.
    const started = new Set(t.runs.filter((r) => r.check === 'journey').map((r) => r.run));
    expect(t.stacks.length, 'one stack per journey run that started, none for the stops that keep the agent working').toBe(started.size);
    for (const st of t.stacks) expect(started.has(st.run), `a stack started for ${st.run}, a run that never started`).toBe(true);
    expect(started.size).toBe(2);
  };
  it('AC28 sent-back and "proceed" stops start no journey, green ends-turn stops do, observed Codex waits only on the twin', () => assertion(run()));
  it('AC28 a runner that starts slow checks on every green stop starts the journey after the "proceed", naming the stop', async () => {
    await mustFail('starts-on-every-green-stop', () => assertion(run('starts-on-every-green-stop')), ['proceed']);
  });
  it('AC28 a runner that starts them beside the fast-lane checks starts it on the failing stops, naming the stop', async () => {
    await mustFail('starts-beside-fast-lane', () => assertion(run('starts-beside-fast-lane')), ['sent-back-typecheck']);
  });
});

describe('AC29 a stale result is never delivered as current', () => {
  const S1 = '3f2a1c0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  it('AC29 in the four-stop run the first journey fails at 310 s: no wake, no send-back; the FAIL is on the first claim, which reads stale', () => {
    const t = sim(fourStops([S1, 'S2', 'S3', 'S4'], 'failed'));
    const first = runsOf(t, 'journey:checkout', S1)[0]!;
    expect(first.ended_at).toBe(310_000);
    expect(first.outcome).toBe('failed');
    const fails = t.deliveries.filter((d) => d.check === 'journey:checkout' && d.snapshot === S1 && d.result === 'FAIL');
    expect(fails.length, 'the FAIL is recorded as a delivery event').toBeGreaterThan(0);
    for (const d of fails) {
      expect(d.stale, 'the old snapshot\'s FAIL is stale').toBe(true);
      expect(d.how, 'the old FAIL never wakes the session or sends it back').toBe('recorded_only');
      expect(d.carried).toBe(false);
    }
    expect(t.deliveries.filter((d) => d.at >= 310_000 && (d.how === 'woke' || d.how === 'sent_back')), 'nothing wakes or sends back at 310 s').toEqual([]);
    expect(t.stops.filter((s) => s.session === 's').length, 'no extra stop reply').toBe(4);
    const c1 = claimOn(t, S1);
    expect(c1.checks['journey:checkout']!.outcome, 'the FAIL is recorded on the first claim').toBe('FAIL');
    expect(c1.stale, 'the first claim reads stale').toBe(true);
    const c4 = claimOn(t, 'S4');
    const late = c4.checks['journey:checkout']!.late;
    expect(late, 'the fourth claim names the late result beside its check').not.toBeNull();
    expect(late!.snapshot).toBe(S1);
    expect(late!.outcome).toBe('FAIL');
    expect(late!.stops_back, '"3 stops back"').toBe(3);
  });

  const S1b = 'S1';
  const unitScenario = (plant?: SchedulerPlant): Trace => sim({
    config: cfg,
    sessions: [script('s', 'claude', [
      check('lint', 2000, { inputs: ['src/**'] }),
      check('unit', 20_000, { inputs: ['src/**'], ends: { [S1b]: 'failed' } }),
    ], [
      stop(0, S1b),
      prompt(5000, 'human'),
      edit(6000, 'S2'),
      // the unit FAIL lands at 22 s, while the agent works; the agent stops again before its next tool call
      stop(24_000, 'S2', { changed: ['src/cart.ts'], id: 'stop-2' }),
    ])],
  }, plant);
  const unitAssertion = (t: Trace): void => {
    expect(runsOf(t, 'unit', S1b)[0]!.ended_at).toBe(22_000);
    const second = stopOf(t, 's', 2);
    expect(second.kind, `the claim on ${S1b} is stale: its unit FAIL is not sent back at stop-2's hold`).not.toBe('send_back');
    const late = t.deliveries.filter((d) => d.check === 'unit' && d.snapshot === S1b && d.result === 'FAIL' && d.at >= 24_000);
    for (const d of late) {
      expect(d.how, `unit FAIL of the claim on ${S1b} delivered after the newer claim`).toBe('recorded_only');
      expect(d.stale).toBe(true);
    }
    expect(t.deliveries.filter((d) => d.snapshot === S1b && d.check === 'unit' && d.how === 'sent_back'), `${S1b}'s unit FAIL is never sent back`).toEqual([]);
  };
  it('AC29 a unit FAIL queued for delivery when the agent stops again with its inputs changed is not sent back at the new stop', () => unitAssertion(unitScenario()));
  it('AC29 a runner that checks a delivery when it queues it sends the stale FAIL back, naming the claim', async () => {
    await mustFail('checks-delivery-at-queue', () => unitAssertion(unitScenario('checks-delivery-at-queue')), [S1b]);
  });
});

describe('AC30 a check whose inputs a newer snapshot doesn\'t change isn\'t queued again', () => {
  const run = (plant?: SchedulerPlant): Trace => sim({
    config: cfg,
    sessions: [script('s', 'claude', [
      check('unit', 3000, { inputs: ['src/**'] }),
      check('docs', 90_000, { inputs: ['docs/**'] }),
    ], [
      stop(0, 'S1', { changed: ['src/cart.ts', 'docs/a.md'] }),
      stop(20_000, 'S2', { changed: ['src/cart.ts'] }),
    ])],
  }, plant);
  const assertion = (t: Trace): void => {
    const docs = runsOf(t, 'docs');
    expect(docs, 'docs ran once: running on S1 it carries to the newer claim').toHaveLength(1);
    expect(docs[0]!.snapshot).toBe('S1');
    expect(docs[0]!.ended_at).toBe(93_000);
    expect(queuedFor(t, 'docs').filter((q) => q.snapshot === 'S2'), 'docs queues nothing for S2').toEqual([]);
    const c2 = claimOn(t, 'S2', 's');
    expect(c2.checks.docs!.carried_from, 'docs result is the new claim\'s, marked carried').toBe('S1');
    expect(c2.checks.docs!.carried_runs, 'it lists its run on the earlier snapshot').toEqual([docs[0]!.run]);
    expect(c2.checks.docs!.outcome).toBe('PASS');
    const d = t.deliveries.find((x) => x.check === 'docs' && x.claim === c2.claim);
    expect(d, 'the result is delivered as the newest claim\'s').toBeDefined();
    expect(d!.carried).toBe(true);
    expect(d!.stale).toBe(false);
    expect(d!.at).toBe(93_000);
    expect(runsOf(t, 'unit'), 'unit reruns, its inputs changed').toHaveLength(2);
  };
  it('AC30 docs/** running 90 s: a stop that changes only src/cart.ts queues nothing and its result carries', () => assertion(run()));
  it('AC30 a runner that queues every check at every stop runs the docs check twice, naming it', async () => {
    await mustFail('queues-every-check', () => assertion(run('queues-every-check')), ['docs']);
  });
});

describe('AC31 a check that needs 3 clean runs, its first run going when a newer claim changes its inputs', () => {
  const run = (plant?: SchedulerPlant): Trace => sim({
    config: cfg,
    sessions: [script('s', 'claude', [
      check('lint', 2000, { inputs: ['src/**'] }),
      check('e2e', 40_000, { inputs: ['src/**'], runs: 3 }),
    ], [
      stop(0, 'S1'),
      stop(20_000, 'S2', { changed: ['src/cart.ts'] }),
    ])],
  }, plant);
  const assertion = (t: Trace): void => {
    const runs = runsOf(t, 'e2e');
    expect(runs.map((r) => r.snapshot), 'e2e: one run on S1, then three on S2').toEqual(['S1', 'S2', 'S2', 'S2']);
    expect(runs[0]!.started_at).toBe(2000);
    expect(runs[0]!.ended_at, 'the run going finishes, never stopped').toBe(42_000);
    expect(runs[0]!.outcome).toBe('passed');
    expect(runs.filter((r) => r.snapshot === 'S1'), 'no second run on the older snapshot S1').toHaveLength(1);
    for (let i = 1; i < 4; i++) {
      expect(runs[i]!.started_at, `e2e run ${i + 1} on S2 starts after the one before ended`).toBeGreaterThanOrEqual(runs[i - 1]!.ended_at);
      expect(runs[i]!.started_at, `e2e run ${i + 1} on S2 starts once S2's stop ended its turn`).toBeGreaterThanOrEqual(22_000);
    }
    expect(runs[1]!.started_at).toBe(42_000);
    expect(runs[3]!.ended_at).toBe(162_000);
    expect(t.queue.some((q) => q.check === 'e2e' && q.op === 'replaced' && q.snapshot === 'S1'), 'the queued place of S1 is taken by S2').toBe(true);
  };
  it('AC31 e2e finishes its run on S1 at 42 s, starts no second on S1, and its 3 runs go on S2 from 42 s', () => assertion(run()));
  it('AC31 a runner that finishes the older snapshot\'s three runs first fails this test, naming the run', async () => {
    await mustFail('finishes-older-runs', () => assertion(run('finishes-older-runs')), ['S1']);
  });
});
