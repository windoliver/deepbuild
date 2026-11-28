import { afterEach, describe, expect, it } from 'vitest';
import { apply, environmentProblem, expectState, judge, LOCAL_FIRST, openWorld, p95, removeRoots, said, startSession, widen, youApp, type World } from './helpers.ts';

afterEach(removeRoots, 120_000);

const problem = environmentProblem();
const LAYER_EVENTS = 10_000;

async function sessions(w: World, count: number): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(await startSession(w, i % 2 ? 'blog' : 'shop', [{ id: 'm1', from: 'you', text: `lesson ${i}: use port ${4000 + i}` }]));
  return out;
}
const changeAt = (ss: string[], i: number) => {
  const k = i % ss.length;
  return { target: `slice:fact${i}`, diff: `+ fact ${i}`, evidence: [{ at: said(ss[k]!, 'm1'), quote: `use port ${4000 + k}` }], scope: `session:${ss[k]!}` };
};

describe('AC8 budgets on the reference Mac', () => {
  it('AC8 applying a learned change takes under 100 ms (p95 of 40 applies, five runs)', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const w = await openWorld();
    const ss = await sessions(w, 100);
    let n = 0;
    const run = async (count: number): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < count; i++) {
        const change = changeAt(ss, n++);
        const t0 = performance.now();
        await apply(w, change, LOCAL_FIRST);
        samples.push(performance.now() - t0);
      }
      return p95(samples);
    };
    for (let i = 0; i < 1000; i++) await apply(w, changeAt(ss, n++), LOCAL_FIRST);
    console.log(`warm-up p95 ${(await run(40)).toFixed(2)} ms (discarded)`);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) runs.push(await run(40));
    const last = (await w.record.table('learned_layer')).rows.filter((r) => r.kind === 'learn.applied');
    expect(last.length).toBeGreaterThan(1000);
    for (const row of last.slice(-5)) await expectState(w, String(row.id), 'applied', 'a timed apply');
    await w.record.close();
    judge(ctx, 'AC8 apply p95 (ms)', runs, 100);
  }, 900_000);

  it('AC8 rolling back a learned change takes under 100 ms (p95 of 40 rollbacks, five runs)', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const w = await openWorld();
    const ss = await sessions(w, 100);
    const ids: string[] = [];
    for (let i = 0; i < 1300; i++) ids.push(await apply(w, changeAt(ss, i), LOCAL_FIRST));
    let next = ids.length - 1;
    const run = async (count: number): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < count; i++) {
        const id = ids[next--]!;
        const t0 = performance.now();
        const rolled = await w.record.rollBack(youApp, { change: id });
        samples.push(performance.now() - t0);
        expect(rolled).toEqual([id]);
      }
      return p95(samples);
    };
    console.log(`warm-up p95 ${(await run(40)).toFixed(2)} ms (discarded)`);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) runs.push(await run(40));
    await expectState(w, ids[next + 1]!, 'rolled_back', 'a timed rollback');
    await w.record.close();
    judge(ctx, 'AC8 rollback p95 (ms)', runs, 100);
  }, 900_000);

  it(`AC8 the layer rebuilds from its events (${LAYER_EVENTS.toLocaleString('en-US')} learned events) in under 5 s`, async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const w = await openWorld();
    const ss = await sessions(w, 200);
    let made = 0;
    for (let i = 0; made < LAYER_EVENTS; i++) {
      const change = changeAt(ss, i);
      const id = await apply(w, change, LOCAL_FIRST); made++;
      if (i % 10 === 3) { await widen(w, { ...change, scope: i % 2 ? 'repo:blog' : 'repo:shop' }, 'you'); made++; }
      if (i % 10 === 7) { await apply(w, { ...change, target: 'check:app.e2e' }, LOCAL_FIRST); made++; }
      if (i % 20 === 9) { await w.record.rollBack(youApp, { change: id }); made++; }
    }
    const states = new Set((await w.record.table('learned_layer')).rows.map((r) => String(r.state)));
    for (const s of ['applied', 'refused', 'rolled_back']) expect(states.has(s), `the layer holds ${s} changes`).toBe(true);
    const started = performance.now();
    await w.record.rebuild();
    const seconds = (performance.now() - started) / 1000;
    await w.record.close();
    judge(ctx, `AC8 rebuild of a ${LAYER_EVENTS}-event layer (s)`, [seconds], 5);
  }, 1_800_000);
});
