// The slow lane's queue when a second turn ends while a checkout is being made for the first (#31): each check starts once.
import { describe, expect, it } from 'vitest';
import { GateRunner, type GateOptions } from '../src/gate-runner.js';

const tick = (): Promise<void> => new Promise((done) => setTimeout(done, 5));

describe('the slow lane', () => {
  it('starts each queued check once, however many turns end while a checkout is made', async () => {
    let release = (): void => undefined;
    const slow = new Promise<void>((done) => { release = done; });
    let held = false;
    const started: string[] = [];
    const checkouts = {
      budget: () => ({ since: 0 }),
      snapshot: async () => ({ commit: 'c1', wrote: true }),
      checkout: async () => {
        // The stop's own checkout is at once; a later one takes the time a clone of node_modules does.
        if (held) await slow;
        held = true;
        return { dir: '/x', commit: 'c1' };
      },
      ended: async () => undefined,
    };
    const gate = new GateRunner({
      raw: async () => [{ ms: 1000 }], now: () => 0, append: async () => undefined, core: {} as GateOptions['core'],
      start: async (r) => { started.push(r.check); return `run:${started.length}`; },
      ended: () => new Promise<string>(() => undefined),
      slots: () => ({ free: 4 }), budget_ms: 0, hold_ms: 0,
      checkouts: () => checkouts as unknown as ReturnType<GateOptions['checkouts']>,
      invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined,
    });
    const check = (name: string) => ({ check: name, approved: 'a', command: `sh '${name}'`, covers: ['R1'], depth: 'unit' as const, on_base: 'passes' as const, asserts: [] });
    await gate.stop({ session: 's', claim: 'claim:1', task: 'task:1', cwd: '/w', base: 'b', requirements: [], checks: [check('e1'), check('e2')], stopAt: 0 });
    await tick();
    gate.turnEnded('claim:1');
    await tick();
    gate.turnEnded('claim:1');
    await tick();
    release();
    await tick();
    expect(started.sort()).toEqual(['e1', 'e2']);
  });

  it('starts the newest claim\'s check when an older claim of the same stop reaches the gate after it (#580)', async () => {
    const started: string[] = [];
    const checkouts = { budget: () => ({ since: 0 }), snapshot: async () => ({ commit: 'c1', wrote: true }), checkout: async () => ({ dir: '/x', commit: 'c1' }), ended: async () => undefined };
    const gate = new GateRunner({
      raw: async (q) => (q.includes('FROM runs') ? [{ id: 'run:0', ms: 1000 }] : []), now: () => 0, append: async () => undefined, core: {} as GateOptions['core'],
      start: async (r) => { started.push(r.claim); return `run:${started.length}`; },
      ended: () => new Promise<string>(() => undefined),
      slots: () => ({ free: 4 }), budget_ms: 0, hold_ms: 0,
      checkouts: () => checkouts as unknown as ReturnType<GateOptions['checkouts']>,
      invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined,
    });
    const check = { check: 'journey', approved: 'a', command: "sh 'journey'", covers: ['R1'], depth: 'unit' as const, on_base: 'passes' as const, asserts: [] };
    const stop = (claim: string) => gate.stop({ session: 's', claim, task: 'task:1', cwd: '/w', base: 'b', requirements: [], checks: [check], stopAt: 0 });
    await stop('claim:2');
    await stop('claim:1');
    await gate.turnEnded('claim:2');
    await tick();
    expect(started).toEqual(['claim:2']);
  });
});

// #3562: a place leaves the queue only when a slot is free for a slow run, so a turn's end never waits for one to start.
describe('a slow lane whose one slot is taken', () => {
  /** A host with two slots, one of them a slow run's: a run holds its slot from its start until the test ends it. */
  function world() {
    const started: string[] = [];
    const places: Record<string, unknown>[] = [];
    const ends = new Map<string, () => void>();
    const snapshots = new Map<string, string>();
    const host = { taken: 0, started: (): void => undefined, read: (): void => undefined };
    const checkouts = {
      budget: () => ({ since: 0 }),
      snapshot: async (cwd: string) => ({ commit: snapshots.get(cwd)!, tree: `tree:${snapshots.get(cwd)!}`, wrote: true }),
      checkout: async ({ commit }: { commit: string }) => ({ dir: `/x/${commit}`, commit }),
      ended: async () => undefined,
    };
    const gate = new GateRunner({
      raw: async () => [], now: () => 0, append: async (_c, input) => { if (input.kind === 'check.held') places.push(input.data); }, core: {} as GateOptions['core'],
      start: async (r) => { host.taken++; started.push(r.commit); host.started(); return `run:${r.commit}`; },
      ended: (run) => new Promise<string>((done) => ends.set(run, () => done('passed'))),
      slots: () => { host.read(); return { free: 2 - host.taken, slow: 1 }; }, budget_ms: 0, hold_ms: 0,
      checkouts: () => checkouts as unknown as ReturnType<GateOptions['checkouts']>,
      invalid: async () => undefined, stopping: () => false, stoodIn: async () => undefined,
    });
    const check = { check: 'journey', approved: 'a', command: "sh 'journey'", covers: ['R1'], depth: 'unit' as const, on_base: 'passes' as const, asserts: [], expected_ms: 300_000 };
    /** A session's green stop on `snapshot`, and its turn's end: resolves once `turnEnded` has. */
    const stop = async (session: string, snapshot: string): Promise<void> => {
      snapshots.set(`/w/${session}`, snapshot);
      await gate.stop({ session, claim: `claim:${snapshot}`, task: `task:${session}`, cwd: `/w/${session}`, base: 'b', requirements: [], checks: [check], stopAt: 0 });
      await gate.turnEnded(`claim:${snapshot}`);
    };
    const within = <T>(wait: Promise<T>, what: string): Promise<T> => {
      let timer: NodeJS.Timeout | undefined;
      // deadline: a start or a read that never comes fails the test, naming it, in place of hanging it.
      const late = new Promise<never>((_, fail) => { timer = setTimeout(() => fail(Error(`${what} never came; started so far: ${started.join(', ')}`)), 2000); });
      return Promise.race([wait, late]).finally(() => clearTimeout(timer));
    };
    const nextStart = (): Promise<void> => within(new Promise<void>((done) => { host.started = done; }), 'the next start');
    /** The record's places as they stand: the newest `check.held` of each snapshot, as `snapshot reason started_by replaced_by`. */
    const held = (): string[] => [...new Map(places.map((p) => [p.snapshot, `${String(p.snapshot)} ${String(p.reason)} ${String(p.started_by)} ${String(p.replaced_by)}`])).values()];
    return { gate, started, ends, host, stop, nextStart, within, held };
  }

  it('returns each turn\'s end with its place queued, gives a queued place to a newer snapshot, and starts the places in the queue\'s order', async () => {
    const w = world();
    let start = w.nextStart();
    await w.stop('a', 'a1');
    await start;
    // b and c stop while a's run holds the one slot a slow run may: each turn's end returns, and nothing starts.
    await w.stop('b', 'b1');
    await w.stop('c', 'c1');
    expect(w.started, 'no run starts while the slow slot is taken').toEqual(['a1']);
    expect(w.gate.slowUnstarted('claim:b1'), "b's check is still queued when its turn's end returns").toEqual(['journey']);
    expect(w.held(), 'each place that waits is in the record when its turn\'s end returns; a\'s, which started at once, has none').toEqual(['b1 a check slot null null', 'c1 a check slot null null']);
    // b stops again on a newer snapshot: it takes the queued place, behind c's.
    await w.stop('b', 'b2');
    for (const [ending, next] of [['a1', 'c1'], ['c1', 'b2']] as const) {
      start = w.nextStart();
      w.host.taken--;
      w.ends.get(`run:${ending}`)!();
      await start;
      expect(w.started.at(-1), `the place that starts once ${ending}'s run ends`).toBe(next);
    }
    expect(w.started, 'no run ever starts on the snapshot b1, whose place b2 took').toEqual(['a1', 'c1', 'b2']);
    expect(w.held(), 'the record shows b1\'s place taken by b2, and the two that waited started by their slot').toEqual(['b1 a check slot null b2', 'c1 a check slot slot null', 'b2 a check slot slot null']);
  });

  it('names a check it took off the queue as starting until its run has started', async () => {
    const w = world();
    const start = w.nextStart();
    await w.stop('a', 'a1');
    expect(w.gate.slowStarting('claim:a1'), "it has its slot when its turn's end returns, and no run yet").toEqual(['journey']);
    await start;
    await w.stop('b', 'b1');
    expect([w.gate.slowStarting('claim:a1'), w.gate.slowStarting('claim:b1')], "a's run has started, and b's check is queued, not starting").toEqual([[], []]);
  });

  it('reads the queue again on the tick, for a slot its host still counts as taken when the run ends', async () => {
    const w = world();
    let start = w.nextStart();
    await w.stop('a', 'a1');
    await start;
    await w.stop('b', 'b1');
    // a's run ends, and the host still counts its slot and the one kept for the fast lane as taken when the queue is read.
    w.host.taken = 2;
    const read = w.within(new Promise<void>((done) => { w.host.read = done; }), "the queue's read at the run's end");
    w.ends.get('run:a1')!();
    await read;
    expect(w.started, 'nothing starts on a slot the host still counts as taken').toEqual(['a1']);
    start = w.nextStart();
    w.host.taken = 0;
    w.gate.tick();
    await start;
    expect(w.started).toEqual(['a1', 'b1']);
  });
});

// #874: a fix check whose requirement declares a command the base has no entry for runs there with the command's
// stand-in found by name, and failing on it records the stand-in's hash for the requirement.
describe('a fix check on a base with nothing to start', () => {
  it('runs on the base with its command\'s stand-in, and records the stand-in\'s hash', async () => {
    const starts: { commit: string; standIns?: string[] }[] = [];
    const stood: unknown[] = [];
    const checkouts = {
      budget: () => ({ since: 0 }),
      snapshot: async () => ({ commit: 'c1', wrote: true }),
      checkout: async () => ({ dir: '/x', commit: 'c1' }),
      baseCheckout: async (r: { surfaces: { check: string; kind: string; name: string }[] }) => ({
        dir: '/b', commit: 'b0', standIns: r.surfaces.map((s) => ({ check: s.check, kind: s.kind, hash: 'h-greet', bin: `/b/.deep-stand-in/bin/${s.name}` })),
      }),
      ended: async () => undefined,
    };
    const gate = new GateRunner({
      raw: async () => [], now: () => 0, append: async () => undefined, core: {} as GateOptions['core'],
      start: async (r) => { starts.push({ commit: r.commit, ...(r.standIns ? { standIns: r.standIns } : {}) }); return `run:${starts.length}`; },
      ended: async (run) => (run === 'run:1' ? 'passed' : 'failed'),
      slots: () => ({ free: 4 }), budget_ms: 0, hold_ms: 0,
      checkouts: () => checkouts as unknown as ReturnType<GateOptions['checkouts']>,
      invalid: async () => undefined, stopping: () => false, stoodIn: async (r) => { stood.push(r); },
    });
    const surface = { kind: 'command', name: 'deep-greet' };
    await gate.stop({ session: 's', claim: 'claim:1', task: 'task:1', cwd: '/w', base: 'b', requirements: [], stopAt: 0,
      checks: [{ check: '.deepbuild/checks/greet.sh', approved: 'a', command: 'sh .deepbuild/checks/greet.sh', covers: ['R1'], depth: 'unit', on_base: 'fails', asserts: [], req: 'R1', surface }] });
    for (let i = 0; i < 20 && stood.length === 0; i++) await tick();
    expect(starts).toEqual([{ commit: 'c1' }, { commit: 'b0', standIns: ['deep-greet'] }]);
    expect(stood).toEqual([{ task: 'task:1', req: 'R1', surface, hash: 'h-greet' }]);
  });
});
