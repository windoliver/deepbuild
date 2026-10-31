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
      ended: () => new Promise<string>(() => undefined), report: () => undefined,
      slots: () => ({ free: 4 }), budget_ms: 0, hold_ms: 0,
      checkouts: () => checkouts as unknown as ReturnType<GateOptions['checkouts']>,
      invalid: async () => undefined, stopping: () => false,
    });
    const check = (name: string) => ({ check: name, approved: 'a', on_base: 'passes' as const, asserts: [] });
    await gate.stop({ session: 's', claim: 'claim:1', cwd: '/w', base: 'b', checks: [check('e1'), check('e2')], stopAt: 0 });
    await tick();
    gate.turnEnded('claim:1');
    await tick();
    gate.turnEnded('claim:1');
    await tick();
    release();
    await tick();
    expect(started.sort()).toEqual(['e1', 'e2']);
  });
});
