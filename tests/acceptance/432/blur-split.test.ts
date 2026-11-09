// AC3 #432.2bdf5706: A composed pass that calls the shipped blur between two pixel-wise steps compiles into the steps
// before it, the blur's own passes and the steps after it, each within its fetch limit, and its estimate is the sum of
// the three parts', the blur's at its measured cost.
//
// The operator (helpers: `softOperator`, `SOFT`): `px`, `c` (load the frame's color at the pixel) and `lift` (× 1.2);
// then `b`, `use@1` of the shipped `blur@1` on `lift` at radius 6 px; then `dim` (× 0.8) and `out` (+ 0.02). Whole, it
// would read 1 + 31 + 31 + 1 fetches, past a pass's 32 (Operator cost and limits). `check_operator` in the showpiece class
// on Metal answers with `parts` (README: The surface under test), in order: a part of steps holding px, c and lift and
// none of dim and out; the shipped blur's own passes, `blur.x@1` then `blur.y@1` (its stages as the base names them);
// a part of steps holding dim and out and none of px, c and lift. Every part reads at most 32 fetches, and all of them
// together more than 32, so one pass couldn't hold them. The blur's parts are costed `measured`, the steps' parts
// `estimated`, and the reply's `estimate_ns` is the sum of the parts' within 1e-9 of it.
// Wrong programs: the composed pass compiled as one pass (refused for its fetches, or one part); the blur fused into its
// neighbours; an estimate that leaves a part out or costs the blur from its op weights instead of its measured cost.
import { describe, expect, it } from 'vitest';
import { AC, SOFT, checked, requireGpu, run1, softOperator, useBin, useOut } from './helpers.ts';

const bin = useBin();
const out = useOut();
const PASS_FETCHES = 32;

describe(`${AC[3]} a composed pass around the shipped blur compiles into the steps before it, the blur's passes and the steps after it`, () => {
  it(`${AC[3]} lift, blur@1, dim: parts steps, blur.x@1, blur.y@1, steps, each within 32 fetches; the estimate is the parts' sum, the blur's parts measured`, () => {
    requireGpu();
    const c = checked(run1(bin(), out(), { call: 'check_operator', operator: softOperator(), class: 'showpiece' }, { lane: 'gpu' }), 'check_operator: soft');
    expect(c.outcome, `the composed pass is accepted: ${JSON.stringify(c.issues).slice(0, 1500)}`).toBe('accepted');
    console.log(`${AC[3]}: parts ${c.parts.map((p) => `${p.of} [${p.steps.join(', ')}] ${p.fetches} fetches, ${p.estimate_ns} ns (${p.cost})`).join('; ')}; estimate ${c.estimate_ns} ns`);
    expect(c.parts.map((p) => p.of), 'the steps before the blur, the shipped blur\'s own passes, the steps after it').toEqual(['steps', 'blur.x@1', 'blur.y@1', 'steps']);
    const [before, bx, by, after] = c.parts as [typeof c.parts[0], typeof c.parts[0], typeof c.parts[0], typeof c.parts[0]];
    expect(SOFT.before.filter((s) => !before.steps.includes(s)), 'the first part holds the steps before the blur').toEqual([]);
    expect(SOFT.after.filter((s) => before.steps.includes(s)), 'the first part holds none of the steps after it').toEqual([]);
    expect(SOFT.after.filter((s) => !after.steps.includes(s)), 'the last part holds the steps after the blur').toEqual([]);
    expect(SOFT.before.filter((s) => after.steps.includes(s)), 'the last part holds none of the steps before it').toEqual([]);
    for (const p of c.parts) expect(p.fetches, `${p.of} [${p.steps.join(', ')}] is within a pass's fetch limit`).toBeLessThanOrEqual(PASS_FETCHES);
    expect(c.parts.reduce((a, p) => a + p.fetches, 0), 'together the parts read more than one pass may, so the split is what lets the operator run').toBeGreaterThan(PASS_FETCHES);
    expect([bx.cost, by.cost], 'the blur\'s passes are costed at their measured cost').toEqual(['measured', 'measured']);
    expect([before.cost, after.cost], 'the steps\' parts are costed by their estimate').toEqual(['estimated', 'estimated']);
    for (const p of c.parts) expect(p.estimate_ns, `${p.of}: a positive estimate`).toBeGreaterThan(0);
    const sum = c.parts.reduce((a, p) => a + p.estimate_ns, 0);
    expect(c.estimate_ns, 'the reply carries the operator\'s estimate').not.toBeNull();
    expect(Math.abs(c.estimate_ns! - sum), `the estimate ${c.estimate_ns} ns is the sum of the parts' ${sum} ns`).toBeLessThanOrEqual(1e-9 * Math.max(1, sum));
  }, 1_800_000);
});
