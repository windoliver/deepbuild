// #483.c4423040: "Limits: iterate with count 17 is refused with operator_limit; an iterate inside another is refused,
// naming both; and a body that reads another operator's target is refused with operator_kind_rule, naming the input"
//
// Through check_operator. The controls first: `glow`, a pass whose `glow_it` step iterates a body that reads `prev`
// and the frame's color (count 16, the most), checks; and in a frame after a tint, a glow whose outer graph (not its
// body) samples the tint's target checks too, so the last refusal is about the body. Then count 17 is refused with
// operator_limit; an `inner_flood` iterate in the body of `outer_flood` is refused with an error whose fields name
// both steps; and a body that reads the input `other`, the tint's color target, is refused with operator_kind_rule
// naming `inputs/other`. At the base there is no iterate step.
import { describe, expect, it } from 'vitest';
import { AC, FRAME_COLOR, checkCall, checked, errors, frameCall, pass, requireGpu, run, shown, step, useBins, useOut, type JsonObject } from './helpers.ts';

const bins = useBins();
const out = useOut();

const OTHER: JsonObject = { type: 'texture', from: { texture: { target: { op: 'tint', output: 'color' } } } };
const TINT = pass('tint', {
  px: step('pixel@1'), c: step('load@1', { tex: 'src', ixy: 'px' }),
  red: { op: 'const@1', args: { value: [0.25, 0, 0, 0], type: 'vec4' } }, out: step('add@1', { a: 'c', b: 'red' }),
});
/** A body: prev plus a sixteenth of `read` (the frame's color, or another input). */
const body = (read = 'src', extra: JsonObject = {}): JsonObject => ({
  steps: {
    g_px: step('pixel@1'), g_p: step('load@1', { tex: 'prev', ixy: 'g_px' }), g_s: step('load@1', { tex: read, ixy: 'g_px' }),
    g_k: step('mul@1', { a: 'g_s', b: 0.0625 }), g_res: step('add@1', { a: 'g_p', b: 'g_k' }), ...extra,
  },
  outputs: { color: 'g_res' },
});
const iterate = (count: number, b: JsonObject): JsonObject =>
  ({ op: 'iterate@1', args: { count, index: 'k', ping_pong: { format: 'rgba16float', resolution: 'full' }, body: b } });
/** A pass iterating `b` in its step `name`, its color the last run's output (plus the other target when `outerReads`). */
function glow(count: number, b: JsonObject, o: { name?: string; outerReads?: boolean; other?: boolean } = {}): JsonObject {
  const name = o.name ?? 'glow_it';
  const steps: JsonObject = { px: step('pixel@1'), [name]: iterate(count, b), v: step('load@1', { tex: name, ixy: 'px' }) };
  if (o.outerReads) Object.assign(steps, { o: step('load@1', { tex: 'other', ixy: 'px' }), out: step('add@1', { a: 'v', b: 'o' }) });
  else steps['out'] = step('mul@1', { a: 'v', b: 1 });
  return pass('glow', steps, { order: 'a1', inputs: o.outerReads || o.other ? { src: FRAME_COLOR, other: OTHER } : { src: FRAME_COLOR } });
}

describe(`${AC[2]} iterate's limits`, () => {
  it(`${AC[2]} count 16 checks and 17 is refused with operator_limit; a nested iterate is refused naming both; a body reading another operator's target is refused with operator_kind_rule naming the input`, () => {
    requireGpu();
    const nested = body('src', { inner_flood: iterate(2, body()), g_i: step('load@1', { tex: 'inner_flood', ixy: 'g_px' }), g_res: step('add@1', { a: 'g_p', b: 'g_i' }) });
    const replies = run(bins.bin(), out(), [
      checkCall(glow(16, body())),
      frameCall({ operators: [TINT, glow(4, body(), { outerReads: true })] }),
      checkCall(glow(17, body())),
      checkCall(glow(2, nested, { name: 'outer_flood' })),
      frameCall({ operators: [TINT, glow(4, body('other'), { other: true })] }),
    ]);
    const [c16, outer, c17, nest, reads] = replies.map((r, i) => checked(r, ['count 16', 'the outer graph reading the tint', 'count 17', 'the nested iterate', 'the body reading the tint'][i]!));
    expect(c16!.outcome, `iterate with count 16 checks: ${shown(c16!.issues)}`).toBe('accepted');
    expect(outer!.outcome, `a glow whose outer graph reads the tint's target checks: ${shown(outer!.issues)}`).toBe('accepted');
    expect(c17!.outcome, 'iterate with count 17').toBe('refused');
    expect(errors(c17!, 'operator_limit').length, `count 17 is refused with operator_limit: ${shown(c17!.issues)}`).toBeGreaterThan(0);
    expect(nest!.outcome, 'an iterate inside another').toBe('refused');
    expect(errors(nest!).some((e) => JSON.stringify(e).includes('outer_flood') && JSON.stringify(e).includes('inner_flood')), `an error names both outer_flood and inner_flood: ${shown(nest!.issues)}`).toBe(true);
    expect(reads!.outcome, 'a body reading another operator\'s target').toBe('refused');
    expect(errors(reads!, 'operator_kind_rule').some((e) => String(e['path'] ?? '').endsWith('inputs/other')), `operator_kind_rule names the input inputs/other: ${shown(reads!.issues)}`).toBe(true);
  }, 1_800_000);
});
