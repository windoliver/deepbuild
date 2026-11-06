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
