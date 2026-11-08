// AC6 #431.84a91586: The check refuses an implicit derivative where pixels may diverge, naming the step, before naga
// sees the graph: a parallax-occlusion material whose repeat of 32 steps has a stop_if on the height it reads is
// refused with operator_kind_rule {step, reason: derivative_in_divergent_flow} when that read is a sample with no lod,
// naming the step, as are a ddx and a call to a step function whose body holds fwidth inside the same loop; with
// sample_grad and gradients taken before the loop, or a sample with a lod, the material checks, and the sample_grad form
// matches its CPU reference within one 10-bit code value per channel on 99.9% of pixels on one machine; and a planted
// check without the rule hands the first graph to naga, which refuses it at operator_compile without naming the step,
// and fails.
//
// The material (`pom`): uv0 = 0.1 + 0.8 × screen_uv; a repeat of 32 trips, each stepping one layer (1/32) deeper along
// a fixed tangent-space direction (0.06, 0.03) per unit depth, reading the depth map (a 64 × 64 PNG by hash, every texel
// between 0.4 and 0.9, so no trip-1 stop and a stop by trip 29) at the new uv, and stopping (`stop_if`) once the layer
// is at or below it; accumulators carry this trip's and the last trip's depth and height, and the base color is the
// depth where the ray meets the surface, interpolated between those two layers, so the result is continuous where the
// GPU's and the f64 interpreter's stops differ by a trip. Forms, each one step apart:
//   - `sample`: the read is `sample@1` with no lod (step `s`): refused, naming `s`;
//   - `ddx`: the read has lod 0, and `ddx@1` of the new uv feeds the height (step `dd`): refused, naming `dd`;
//   - `fn`: the read has lod 0, and `use@1` calls `pom.edge@1`, a pack's step function whose body is `fwidth@1`
//     (step `dd`): refused, naming `dd`;
//   - `ddy`, `fwidth`: as `ddx` with `ddy@1` and `fwidth@1`, the WebGPU CTS port below;
//   - `grad`: `sample_grad@1` with gx = ddx(uv0) and gy = ddy(uv0) taken before the loop: checks;
//   - `lod`: `sample@1` with lod 0: checks.
// Each refusal is an error with code operator_kind_rule, reason derivative_in_divergent_flow and `step` naming it, and
// the reply's `reached` shows no naga. The `grad` form's CPU reference is `check_operator`'s `reference` (README: The
// surface under test): the material drawn by #429's material harness at 256 × 256 on this GPU and through the step
// graph's f64 interpreter. One code is 1/1023 of max(1, |reference|), #429's reading; the output must span 0.2 or more.
// Every call checks under `class: "showpiece"` (README): 32 fetches in the loop are a material's 17th to 32nd, which
// Operator cost and limits allows only in the showpiece and export classes.
//
// Oracle port: gpuweb/cts e325d0bcc2, src/webgpu/shader/validation/uniformity/uniformity.spec.ts ('basics',
// 'functions'): a collective op (textureSample, dpdx, dpdy, fwidth, or a function that calls one) under non-uniform
// control flow fails shader creation, and textureSampleLevel and textureSampleGrad don't need uniformity. Here: our
// `sample` with no lod, `ddx`, `ddy`, `fwidth` and a step function holding `fwidth`, inside a loop whose stop is a
// per-pixel value, are each refused by our check, and the lod and grad forms check. (CTS: Copyright 2019 WebGPU CTS
// Contributors, BSD-3-Clause: redistribution with or without modification permitted provided the copyright notice,
// this list of conditions and the disclaimer are retained; no endorsement by the names of its contributors; provided
// "as is" without warranty of any kind.)
// Wrong program (planted `no_divergence_rule`): the check has no derivative rule, so the `sample` form reaches naga,
// whose uniformity analysis refuses it at operator_compile with no step named.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, checked, codes10, errors, materialOp, names, obj, readNamed, requireGpu, run, shown, textureAsset, useBin, useOut, writePngAsset,
  type Checked, type JsonObject, type Planted,
} from './helpers.ts';

const bin = useBin();
const out = useOut();
const REF_SIZE: [number, number] = [256, 256];

type Form = 'sample' | 'ddx' | 'ddy' | 'fwidth' | 'fn' | 'grad' | 'lod';
const REFUSED: { form: Form; step: string }[] = [
  { form: 'sample', step: 's' }, { form: 'ddx', step: 'dd' }, { form: 'fn', step: 'dd' }, { form: 'ddy', step: 'dd' }, { form: 'fwidth', step: 'dd' },
];

function depthMap(): Uint8Array {
  const n = 64; const rgba = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = Math.round(255 * (0.65 + 0.25 * Math.sin((2 * Math.PI * i) / n) * Math.cos((2 * Math.PI * j) / n)));
      rgba.set([v, v, v, 255], (j * n + i) * 4);
    }
  }
  return rgba;
}
function writePack(dir: string): string {
  const p = join(dir, 'pack-pom');
  mkdirSync(p);
  writeFileSync(join(p, 'pack.json'), JSON.stringify({
    name: 'pom', version: '1.0.0', license: 'MIT', description: 'A #431 acceptance pack: one step function whose body holds fwidth.',
    requires: { core: '>=0.0.0', modules: { effects: '>=0.0.0' } },
    functions: { 'pom.edge@1': { about: 'How fast x changes across a pixel, by fwidth.', ports: { in: { x: 'f32' }, out: { w: 'f32' } }, steps: { w: { op: 'fwidth@1', args: { x: 'x' } } } } },
  }));
  return p;
}

function pom(form: Form, sha: string): JsonObject {
  const read: JsonObject = form === 'sample' ? { op: 'sample@1', args: { tex: 'depth', uv: 'nuv' } }
    : form === 'grad' ? { op: 'sample_grad@1', args: { tex: 'depth', uv: 'nuv', dx: 'gx', dy: 'gy' } }
      : { op: 'sample@1', args: { tex: 'depth', uv: 'nuv', lod: 0 } };
  const extra: JsonObject = form === 'ddx' || form === 'ddy' ? { dd: { op: `${form}@1`, args: { x: 'nuv' } }, dl: { op: 'dot@1', args: { a: 'dd', b: 'dd' } } }
    : form === 'fwidth' ? { dd: { op: 'fwidth@1', args: { x: 'nd' } }, dl: { op: 'add@1', args: { a: 'dd', b: 0 } } }
      : form === 'fn' ? { dd: { op: 'use@1', args: { name: 'pom.edge@1', x: 'nd' } }, dl: { op: 'add@1', args: { a: 'dd.w', b: 0 } } }
        : {};
  const offended = 'dl' in extra;
  return materialOp('pom', { depth: textureAsset(sha) }, {
    su: { op: 'screen_uv@1', args: {} },
    sc: { op: 'mul@1', args: { a: 'su', b: 0.8 } },
    uv0: { op: 'add@1', args: { a: 'sc', b: 0.1 } },
    ...(form === 'grad' ? { gx: { op: 'ddx@1', args: { x: 'uv0' } }, gy: { op: 'ddy@1', args: { x: 'uv0' } } } : {}),
    dir: { op: 'const@1', args: { value: [0.06, 0.03], type: 'vec2' } },
    march: {
      op: 'repeat@1',
      args: {
        count: 32, index: 'k', accumulate: { d: 0, h: 0, pd: 0, ph: 0 },
        body: {
          nd: { op: 'add@1', args: { a: 'd', b: 1 / 32 } },
          o: { op: 'mul@1', args: { a: 'dir', b: 'nd' } },
          nuv: { op: 'sub@1', args: { a: 'uv0', b: 'o' } },
          s: read,
          sx: { op: 'split@1', args: { x: 's', pick: 'x' } },
          ...extra,
          ...(offended ? { z: { op: 'mul@1', args: { a: 'dl', b: 0 } }, hs: { op: 'add@1', args: { a: 'sx', b: 'z' } } } : { hs: { op: 'add@1', args: { a: 'sx', b: 0 } } }),
          stop: { op: 'ge@1', args: { a: 'nd', b: 'hs' } },
          // Each accumulator's next value; inside the body its name reads its value at the trip's start.
          d: { op: 'add@1', args: { a: 'd', b: 1 / 32 } },
          h: { op: 'add@1', args: { a: 'hs', b: 0 } },
          pd: { op: 'add@1', args: { a: 'd', b: 0 } },
          ph: { op: 'add@1', args: { a: 'h', b: 0 } },
        },
        stop_if: 'stop',
      },
    },
    // Where the ray meets the surface, between the last two layers: pd + (ph − pd) ÷ ((ph − pd) − (h − d)) × (d − pd).
    above: { op: 'sub@1', args: { a: 'march.ph', b: 'march.pd' } },
    below: { op: 'sub@1', args: { a: 'march.h', b: 'march.d' } },
    span: { op: 'sub@1', args: { a: 'above', b: 'below' } },
    t: { op: 'div@1', args: { a: 'above', b: 'span' } },
    layer: { op: 'sub@1', args: { a: 'march.d', b: 'march.pd' } },
    ts: { op: 'mul@1', args: { a: 't', b: 'layer' } },
    hit: { op: 'add@1', args: { a: 'march.pd', b: 'ts' } },
    base: { op: 'compose@1', args: { x: 'hit', y: 'hit', z: 'hit' } },
  });
}

function setup(): { dir: string; extra: JsonObject; sha: string } {
  const dir = out();
  const tex = writePngAsset(dir, 64, 64, depthMap());
  return { dir, sha: tex.sha, extra: { assets: { [tex.sha]: tex.path }, packs: [{ id: 'test/pom', dir: writePack(dir) }], class: 'showpiece' } };
}
const call = (form: Form, sha: string, extra: JsonObject, more: JsonObject = {}): JsonObject => ({ call: 'check_operator', operator: pom(form, sha), ...extra, ...more });
/** Why a form's reply isn't the criterion's refusal of `step` before naga, or null if it is. */
function notRefused(c: Checked, step: string): string | null {
  if (c.outcome !== 'refused') return `was ${c.outcome}`;
  const rule = errors(c, 'operator_kind_rule').filter((e) => names(e, step) && e['reason'] === 'derivative_in_divergent_flow');
  if (rule.length === 0) return `was refused, but not with operator_kind_rule {step: ${step}, reason: derivative_in_divergent_flow}: ${shown(c.issues)}`;
  if (c.reached.length) return `was refused after reaching ${c.reached.join(', ')}`;
  return null;
}

describe(`${AC[6]} the check refuses an implicit derivative where pixels may diverge, naming the step, before naga`, () => {
  it(`${AC[6]} the no-lod sample, a ddx and a step function holding fwidth inside the stopping loop are refused naming the step; sample_grad and lod forms check, and sample_grad matches its CPU reference within one code on 99.9% of pixels`, () => {
    requireGpu();
    const { dir, sha, extra } = setup();
    const replies = run(bin(), dir, [...REFUSED.map((r) => call(r.form, sha, extra)), call('grad', sha, extra, { reference: { size: REF_SIZE } }), call('lod', sha, extra)]);
    const problems: string[] = [];
    REFUSED.forEach((r, i) => {
      const why = notRefused(checked(replies[i]!, `the ${r.form} form`), r.step);
      if (why) problems.push(`the ${r.form} form (step ${r.step}) ${why}`);
    });
    const grad = checked(replies[REFUSED.length]!, 'the sample_grad form');
    const lod = checked(replies[REFUSED.length + 1]!, 'the lod form');
    for (const [what, c] of [['the sample_grad form', grad], ['the lod form', lod]] as const) if (c.outcome !== 'accepted') problems.push(`${what} was ${c.outcome}: ${shown(c.issues)}`);
    expect(problems, 'the refusals and the forms that check').toEqual([]);

    const ref = obj(grad.raw['reference'], 'the sample_grad form\'s reference');
    const size = ref['size'] as number[];
    expect(size, 'the reference is drawn at 256 × 256').toEqual(REF_SIZE);
    const g = readNamed(dir, ref['gpu'], 'f32', 'the reference: gpu'); const c = readNamed(dir, ref['cpu'], 'f32', 'the reference: cpu');
    const pixels = REF_SIZE[0] * REF_SIZE[1];
    expect([g.length, c.length], 'both files hold 256 × 256 f32 RGBA pixels').toEqual([pixels * 16, pixels * 16]);
    let off = 0; let worst = 0; let lo = Infinity; let hi = -Infinity;
    for (let i = 0; i < pixels; i++) {
      let px = 0;
      for (let ch = 0; ch < 4; ch++) px = Math.max(px, codes10(g.readFloatLE(i * 16 + ch * 4), c.readFloatLE(i * 16 + ch * 4)));
      if (px > 1) off++;
      worst = Math.max(worst, px);
      const v = c.readFloatLE(i * 16); lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    console.log(`${AC[6]}: sample_grad form: ${off} of ${pixels} pixels past one code (worst ${worst.toFixed(2)}); depth from ${lo.toFixed(3)} to ${hi.toFixed(3)}`);
    expect(hi - lo, 'the reference isn\'t blank: the depth it finds spans 0.2 or more').toBeGreaterThanOrEqual(0.2);
    expect(off, `the sample_grad form within one 10-bit code of its CPU reference on 99.9% of ${pixels} pixels`).toBeLessThanOrEqual(Math.floor(pixels * 0.001));
  }, 1_800_000);

  it(`${AC[6]} a planted check without the rule (--planted no_divergence_rule) hands the no-lod form to naga, which refuses it at operator_compile without naming the step, and fails`, () => {
    requireGpu();
    const { dir, sha, extra } = setup();
    const planted: Planted = 'no_divergence_rule';
    const c = checked(run(bin(), dir, [call('sample', sha, extra)], planted)[0]!, 'the sample form under the planted check');
    const why = notRefused(c, 's');
    expect(why, 'the criterion\'s refusal fails under the planted check').not.toBeNull();
    expect(c.outcome, `naga refuses the graph: ${shown(c.raw)}`).toBe('refused');
    expect(c.reached, 'the graph reached naga').toContain('naga');
    const compile = errors(c, 'operator_compile');
    expect(compile.length, `refused at operator_compile: ${shown(c.issues)}`).toBeGreaterThan(0);
    expect(compile.every((e) => e['step'] === undefined), 'operator_compile names no step').toBe(true);
    console.log(`${AC[6]} (${planted}): the sample form ${why}; naga's issue: ${shown(compile[0]).slice(0, 300)}`);
  }, 1_800_000);
});
