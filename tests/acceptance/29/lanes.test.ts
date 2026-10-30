// #29 AC2, AC19, AC20, AC25, AC26: the fast and slow lanes, on the scheduler's virtual clock (README, section 7).
// Each criterion's wrong program is run through the same assertion function and must fail it.
import { describe, expect, it } from 'vitest';
import { simulate, type CheckDef, type Scenario, type SchedulerPlant, type Trace } from '../../../packages/gate/src/index.ts';
import { check, mustFail, runsOf, script, stop, stopOf } from './helpers.ts';

const sim = (s: Scenario, plant?: SchedulerPlant): Trace => (plant ? simulate(s, { plant }) : simulate(s));
const cfg = { slots: 2, budget_ms: 10_000, hold_ms: 60_000 };

describe('AC2 a slow check leaves the claim pending and delivers its verdict when done', () => {
  const run = (plant?: SchedulerPlant): Trace => sim({
    config: cfg,
    sessions: [script('s', 'claude', [check('lint', 2000, { inputs: ['src/**'] }), check('journey', 60_000, { inputs: ['src/**'] })], [stop(0, 'S1')])],
  }, plant);
  const assertion = (t: Trace): void => {
    expect(t.stops.length, 'one stop, one hold reply').toBe(1);
    const reply = stopOf(t, 's', 1);
    expect(reply.reply_at, 'the hold replies when the fast lane ends').toBe(2000);
    expect(reply.kind).toBe('ends_turn');
    expect(reply.verdict, 'the claim is pending at the reply, not PASS').toBe('pending');
    expect(reply.line, 'the line names the check still running').toContain('running');
    expect(reply.slow).toEqual(['journey']);
    const [journey] = runsOf(t, 'journey');
    expect(journey, 'journey ran').toBeDefined();
    expect(journey!.lane).toBe('slow');
    expect(journey!.started_at, 'the slow run starts when the turn ends').toBe(2000);
    expect(journey!.ended_at).toBe(62_000);
    expect(journey!.started_by).toBe('turn_end');
    const claim = t.claims[0]!;
    expect(claim.verdict, 'the verdict lands when the slow check ends').toBe('PASS');
    expect(claim.checks.journey!.outcome).toBe('PASS');
    const delivered = t.deliveries.find((d) => d.claim === claim.claim && d.check === 'journey' && d.result === 'PASS');
    expect(delivered, 'the journey verdict is delivered').toBeDefined();
    expect(delivered!.at, 'delivered when it landed').toBe(62_000);
  };
  it('AC2 a slow check leaves the claim pending and delivers its verdict at 62 s', () => assertion(run()));
});

describe('AC19 a claim on unchanged sources reuses the last verdict instead of running again', () => {
  const run = (plant?: SchedulerPlant): Trace => sim({
    config: cfg,
    sessions: [script('s', 'claude', [check('lint', 2000, { inputs: ['src/**'] }), check('unit', 3000, { inputs: ['src/**'] })],
      [stop(0, 'S1'), stop(100_000, 'S1', { changed: [] })])],
  }, plant);
  const assertion = (t: Trace): void => {
    const again = t.runs.filter((r) => r.started_at >= 100_000);
    for (const id of ['lint', 'unit']) expect(again.filter((r) => r.check === id), `${id} ran again on unchanged sources`).toHaveLength(0);
    expect(t.runs, 'two runs in all, from the first stop').toHaveLength(2);
    const second = stopOf(t, 's', 2);
    expect(second.admitted, 'nothing admitted on unchanged sources').toEqual([]);
    expect(second.slow).toEqual([]);
    expect(second.reply_at, 'held for the validity gate alone').toBe(100_000);
    expect(second.verdict).toBe('PASS');
    const c2 = t.claims[1]!;
    for (const id of ['lint', 'unit']) {
      expect(c2.checks[id]!.carried_from, `${id} carries from the first snapshot`).toBe('S1');
      expect(c2.checks[id]!.carried_runs.length, `${id} lists the run it carries`).toBeGreaterThan(0);
      expect(c2.checks[id]!.outcome).toBe('PASS');
    }
  };
  it('AC19 an unchanged stop reuses the last verdict and starts no run', () => assertion(run()));
  it('AC19 a runner that reruns every check fails this test, naming the check', async () => {
    await mustFail('reruns-every-check', () => assertion(run('reruns-every-check')), ['lint']);
  });
});

describe('AC20 one hold reply, after the second check ends, carrying both checks', () => {
  const run = (plant?: SchedulerPlant): Trace => sim({
    config: cfg,
    sessions: [script('s', 'claude', [check('c2', 2000, { ends: 'failed' }), check('c8', 8000)], [stop(0, 'S1', { id: 'stop-1' })])],
  }, plant);
  const assertion = (t: Trace): void => {
    expect(t.stops.filter((s) => s.session === 's'), 'one hold reply for stop-1').toHaveLength(1);
    const reply = stopOf(t, 's', 1);
    expect(reply.stop).toBe('stop-1');
    expect(reply.reply_at, 'stop-1 replies after the second check ends, at 8 s, not at the first verdict').toBe(8000);
    expect([...reply.counted].sort(), 'stop-1 counts both checks').toEqual(['c2', 'c8']);
    expect(reply.line, 'stop-1 line counts both checks').toMatch(/1\/2/);
    expect(reply.verdict).toBe('FAIL');
    expect(reply.kind).toBe('send_back');
    expect([...reply.admitted].sort()).toEqual(['c2', 'c8']);
    expect(runsOf(t, 'c2')[0]!.ended_at).toBe(2000);
    expect(runsOf(t, 'c8')[0]!.ended_at).toBe(8000);
  };
  it('AC20 stop-1 replies once at 8 s with the verdict as it stands, both checks counted (1/2)', () => assertion(run()));
  it('AC20 a hold that replies when the first verdict is made fails this test, naming the stop', async () => {
    await mustFail('reply-at-first-verdict', () => assertion(run('reply-at-first-verdict')), ['stop-1']);
  });
});

describe('AC25 a check whose last clean runs took 70 s runs in the slow lane from the start', () => {
  const run = (plant?: SchedulerPlant): Trace => sim({
    config: cfg,
    sessions: [script('s', 'claude', [check('lint', 2000, { inputs: ['src/**'] }), check('typecheck', 3000, { inputs: ['src/**'] }), check('journey', 70_000, { inputs: ['src/**'] })], [stop(0, 'S1')])],
  }, plant);
  const assertion = (t: Trace): void => {
    const reply = stopOf(t, 's', 1);
    expect(reply.slow, 'journey goes to the slow lane').toEqual(['journey']);
    expect([...reply.admitted].sort()).toEqual(['lint', 'typecheck']);
    expect(reply.reply_at, 'the reply comes when the other checks end; journey must not be waited for').toBe(3000);
    expect(reply.line, 'journey is named with its expected time').toContain('1 check running · about 1 min');
    const [journey] = runsOf(t, 'journey');
    expect(journey!.lane, 'journey runs in the slow lane').toBe('slow');
    expect(journey!.started_at).toBe(3000);
  };
  it('AC25 the reply at 3 s says "1 check running · about 1 min"', () => assertion(run()));
  it('AC25 a runner that puts it in the fast lane and waits for it fails this test, naming the check', async () => {
    await mustFail('fast-lane-waits', () => assertion(run('fast-lane-waits')), ['journey']);
  });
});

describe('AC26 on #42, with 2 check slots and a 10 s budget, the on_base: fails check is admitted first', () => {
  const defs = (red: boolean): Record<string, CheckDef> => ({
    lint: check('lint', 2000),
    typecheck: check('typecheck', 3000),
    unit: check('unit', 5000),
    journey: check('journey', 9000),
    repro: check('repro', 7000, { on_base: 'fails', ...(red ? { ends: 'failed' as const } : {}) }),
  });
  const run = (order: string[], red: boolean, plant?: SchedulerPlant): Trace => {
    const d = defs(red);
    return sim({ config: cfg, sessions: [script('s', 'claude', order.map((id) => d[id]!), [stop(0, 'S1', { checkout_ms: 1000, id: 'stop-42' })])] }, plant);
  };
  const DEFINITION = ['lint', 'typecheck', 'unit', 'journey', 'repro'];
  const red = (t: Trace): void => {
    const reply = stopOf(t, 's', 1);
    for (const id of ['repro', 'lint', 'typecheck']) expect(reply.admitted, `${id} must be admitted to the fast lane of stop-42`).toContain(id);
    for (const id of ['unit', 'journey']) {
      expect(reply.slow, `${id} must go to the slow lane of stop-42`).toContain(id);
      expect(reply.admitted, `${id} must not be admitted`).not.toContain(id);
    }
    expect(reply.admitted, 'the on_base: fails check is admitted first').toEqual(['repro', 'lint', 'typecheck']);
    expect(reply.reply_at, 'stop-42 replies at 8 s, not 17 s').toBe(8000);
    expect(reply.verdict, 'the FAIL is in the reply').toBe('FAIL');
    expect(reply.kind).toBe('send_back');
    expect(runsOf(t, 'repro')[0]!.started_at).toBe(1000);
    expect(runsOf(t, 'repro')[0]!.ended_at).toBe(8000);
    expect(runsOf(t, 'lint')[0]!.ended_at).toBe(3000);
    expect(runsOf(t, 'typecheck')[0]!.started_at).toBe(3000);
    expect(runsOf(t, 'typecheck')[0]!.ended_at).toBe(6000);
    expect(runsOf(t, 'unit'), 'a send-back starts no slow run').toHaveLength(0);
    expect(runsOf(t, 'journey')).toHaveLength(0);
  };
  it('AC26 repro, lint and typecheck are admitted and its FAIL is in the reply at 8 s; unit (11 s) and journey go slow', () => red(run(DEFINITION, true)));
  it('AC26 a runner that admits each check on its own time against the 60 s hold holds the stop to 17 s, naming unit', async () => {
    await mustFail('hold-sized-by-own-time', () => red(run(DEFINITION, true, 'hold-sized-by-own-time')), ['unit']);
  });
  it('AC26 a runner that takes the definition\'s order leaves repro out, naming it', async () => {
    await mustFail('definition-order', () => red(run(DEFINITION, true, 'definition-order')), ['repro']);
  });
  it('AC26 a runner that adds the times as if one after another leaves typecheck out, naming it', async () => {
    await mustFail('sums-times', () => red(run(DEFINITION, true, 'sums-times')), ['typecheck']);
  });

  it('AC26 its green twin, whose reply ends the turn, starts unit and journey once the hold replies', () => {
    const t = run(DEFINITION, false);
    const reply = stopOf(t, 's', 1);
    expect(reply.kind).toBe('ends_turn');
    expect(reply.reply_at).toBe(8000);
    expect(reply.admitted).toEqual(['repro', 'lint', 'typecheck']);
    expect(reply.slow).toEqual(['unit', 'journey']);
    for (const id of ['unit', 'journey']) {
      const [r] = runsOf(t, id);
      expect(r, `${id} ran`).toBeDefined();
      expect(r!.lane).toBe('slow');
      expect(r!.started_at, `${id} starts once the hold replies`).toBe(8000);
      expect(r!.started_by).toBe('turn_end');
    }
    expect(t.claims[0]!.verdict).toBe('PASS');
  });

  const permutations = (xs: string[]): string[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  it('AC26 once every check has ended, every order gives the same verdict', () => {
    for (const order of permutations(DEFINITION)) {
      expect(run(order, true).claims[0]!.verdict, `red, order ${order.join(',')}`).toBe('FAIL');
      expect(run(order, false).claims[0]!.verdict, `green, order ${order.join(',')}`).toBe('PASS');
    }
  });
});
