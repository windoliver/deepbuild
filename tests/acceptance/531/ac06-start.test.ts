// Criterion 6: "A program whose start function builds a 1,000-entry lookup in memory that every step reads gives,
// from a seek to step 0, the same full-state hash at the first checkpoint and the same step hashes as a straight
// run, since that state is the first checkpoint; a start function that loops forever traps with kind fuel before
// step 0, naming it; a program whose write region would end past its memory is refused at check, naming the region"
//
// Through `deep-logic bake` and `check` (README: deep-logic). `lookup` (programs.ts) builds its lookup in its start
// function, which counts its runs in memory as `init` counts its own; every step writes the entry it read and both
// counts. A seek to step 0 is a restore of the first checkpoint (taken once the start function and init have run,
// before step 0) into a fresh instance, which runs neither again. Oracle: wasmtime tests/all/fuel.rs (iloop: a
// start function that loops forever stops with out-of-fuel), written again as `start_forever`.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, arrayAt, bakeCall, bakeOf, checkCall, firstDiff, inBody, logicBin, none, onMac, piece, prebuild, refusedOf, show, stepHashes, type Layout } from './helpers.ts';
import { lookup, lookupIndex, lookupValue, probe, startForever, writePastMemory } from './programs.ts';

prebuild(() => { logicBin(); });

const STEPS = 120;
const WRITES = { v: { type: 'i32' as const }, sum: { type: 'i32' as const }, starts: { type: 'i32' as const }, inits: { type: 'i32' as const } };
let layout: Layout | undefined;
function lookupLayout(): Layout {
  if (layout) return layout;
  const [reply] = onMac([checkCall(piece({ seed: 531_06, items: { table: { program: probe(), writes: WRITES } } }))]);
  layout = admitted(reply!, 'check of the lookup item')['table']!.layout;
  return layout;
}

describe(`${AC[6]} the start function runs once, before step 0, and its state is the first checkpoint`, () => {
  it(`${AC[6]} from a seek to step 0 the lookup program gives the straight run's full-state hash at the first checkpoint and its step hashes, with the start function and init run once`, () => {
    const p = lookup(lookupLayout());
    expect(p.start, 'the lookup program\'s start function is function 2').toBe(2);
    const [reply] = onMac([bakeCall(piece({ seed: 531_06, items: { table: { program: p, writes: WRITES } } }), { steps: STEPS, restores: [{ from: 0, steps: STEPS }] })]);
    const b = bakeOf(reply!, 'the lookup bake');
    expect(b.traps, 'nothing traps').toEqual([]);
    const straight = b.checkpoints['table'] ?? [];
    expect(straight[0]?.step, 'the first checkpoint is before step 0').toBe(0);
    const [r] = b.restores;
    expect(r?.from, 'the bake answers the seek to step 0').toBe(0);
    expect(r!.checkpoints['table']?.[0], 'from the seek to step 0, the full-state hash at the first checkpoint is the straight run\'s').toEqual(straight[0]);
    const d = firstDiff(stepHashes(r!.steps), stepHashes(b.steps));
    expect(d, `from the seek to step 0, the step hashes are the straight run's (first difference: ${d})`).toBeNull();
    const failures: string[] = [];
    let sum = 0;
    for (let k = 0; k < STEPS; k++) {
      sum = (sum + lookupValue(lookupIndex(k))) | 0;
      for (const [what, steps] of [['straight', b.steps], ['from the seek to step 0', r!.steps]] as const) {
        const got = ['v', 'sum', 'starts', 'inits'].map((n) => arrayAt(steps, k, `table.${n}`, what)[0] ?? null);
        const want = [lookupValue(lookupIndex(k)), sum, 1, 1];
        if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${what}, step ${k}: [v, sum, starts, inits] = ${show(got)}, expected ${show(want)} (the lookup built once before step 0; start and init each run once)`);
      }
    }
    none(failures, 'every step reads the lookup the start function built, and neither the start function nor init runs again');
  }, TIMEOUT);

  it(`${AC[6]} a start function that loops forever traps with kind fuel before step 0, naming the start function`, () => {
    const p = startForever();
    const [reply] = onMac([bakeCall(piece({ seed: 531_06, items: { boot: { program: p, writes: { k: { type: 'i32' } } } } }), { steps: 5 })]);
    const b = bakeOf(reply!, 'the start_forever bake');
    expect(b.traps.length, `one trap: ${show(b.raw['traps'])}`).toBe(1);
    const t = b.traps[0]!;
    expect([t.item, t.kind, t.step], 'logic.trap names the item, kind fuel and no step (before step 0)').toEqual(['boot', 'fuel', null]);
    expect(t.function, 'logic.trap names the start function (function 2)').toBe(p.start);
    expect(inBody(p, 2, t.offset), `the offset ${t.offset} lies in the start function's body`).toBe(true);
    for (const s of b.steps) expect(s.items['boot']?.failed, `step ${s.step}: the item stays failed; no step ran`).toBe(true);
  }, TIMEOUT);

  it(`${AC[6]} a program whose write region would end past its memory is refused at check, naming the region`, () => {
    const [reply] = onMac([checkCall(piece({ seed: 531_06, items: { edge: { program: writePastMemory(), writes: { big: { type: 'f64', count: 4 } } } } }))]);
    const r = refusedOf(reply!, 'the write region past memory');
    expect([r.code, r.item], 'refused by the logic module\'s check, naming the item').toEqual(['logic_refused', 'edge']);
    expect(r.refusals.some((x) => x['region'] === 'writes'), `a refusal names the write region: ${show(r.refusals)}`).toBe(true);
  }, TIMEOUT);
});
