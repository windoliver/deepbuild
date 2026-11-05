// AC4 #419.b5c57ec8: A character walking in place, its root still, rendered with velocity blur at 180°, matches the
// same frame with sample blur at 16 samples within the velocity mode's tolerance on its limbs, and both show blur
// there; a planted velocity built from the item's transform alone leaves the limbs sharp and fails, naming the part.
//
// The walker (helpers: `walkerDoc`), a `fixture.skin@1` part standing in for skinned playback (README: Assumed
// surfaces 9): a torso on a still root bone and two 0.2 × 1.5 m legs on their own bones, swung about their hips by
// channels on the bones' angles; the item's own transform never moves. Orthographic, 213⅓ px/m, white unlit on black.
// Frame 6 (t = 0.25 s, both legs upright and turning at 120°/s: about 14 px of travel at the foot per 180° shutter at
// 24 fps) is exported three ways: motion blur by velocity at 180°, by samples at 16 samples, and off. Each leg's band
// is reckoned from the bone poses alone (`walkerBands`): the pixels below the hips whose centres the leg covers for
// 5–95% of the shutter. On each leg's band, in linear light: the sharp frame shows the leg at its frame-time pose
// (the fixture is posed: ≥ 80% of band pixels within 0.5 of covered or not, a sub-pixel jitter flipping some at the
// edge); both blurred frames show blur (mean |blurred − sharp| ≥ 0.12; an ideal 16-sample frame gives 0.280); and the velocity frame matches the 16-sample frame within the velocity
// mode's tolerance, read as mean |velocity − samples| ≤ 0.1 (README: Readings).
// `--planted velocity_from_transform` (velocity from the item's transform alone, still here) leaves the legs sharp:
// it fails, a failure naming `walker`.
import { describe, it } from 'vitest';
import {
  AC, WALKER, WALKER_SIZE, blur, failsNaming, framesOf, look, lum, none, readLinear, requireMetal, runGpu, useDir, useGpu, view3dCall,
  walkerBands, walkerDoc, writeJson, type GpuPlanted, type JsonObject, type Linear,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

function draw(out: string, planted?: GpuPlanted): { velocity: Linear; samples: Linear; sharp: Linear } {
  const doc = writeJson(out, 'walker', walkerDoc());
  const at = (mb: JsonObject | 'none'): JsonObject => view3dCall({
    doc, look: look({ motionBlur: mb }), size: WALKER_SIZE, class: 'export', fps: WALKER.fps, from: WALKER.frame, frames: 1, targets: ['linear'],
  });
  const [v, s, n] = runGpu(bin(), out, [at(blur('velocity')), at(blur('samples', 16)), at('none')], planted)
    .map((r, i) => readLinear(out, framesOf(r, `call ${i}`)[0]!, WALKER_SIZE, ['velocity', 'samples', 'sharp'][i]!));
  return { velocity: v!, samples: s!, sharp: n! };
}

function problems(d: { velocity: Linear; samples: Linear; sharp: Linear }): string[] {
  const failures: string[] = [];
  const bands = walkerBands();
  for (const leg of ['leg_l', 'leg_r'] as const) {
    const band = bands[leg]; const name = `walker (${leg})`;
    if (band.length < 500) { failures.push(`${name}: the fixture's band holds only ${band.length} px`); continue; }
    let posed = 0; let dv = 0; let ds = 0; let vs = 0;
    for (const p of band) {
      const v = lum(d.velocity.at(p.x, p.y)); const s = lum(d.samples.at(p.x, p.y)); const n = lum(d.sharp.at(p.x, p.y));
      if (Math.abs(n - (p.sharp ? 1 : 0)) < 0.5) posed++;
      dv += Math.abs(v - n); ds += Math.abs(s - n); vs += Math.abs(v - s);
    }
    const k = band.length; [dv, ds, vs] = [dv / k, ds / k, vs / k];
    console.log(`${AC[4]}: ${name}: ${k} band px; posed ${(posed / k * 100).toFixed(1)}%; mean |velocity − sharp| ${dv.toFixed(3)}, |samples − sharp| ${ds.toFixed(3)}, |velocity − samples| ${vs.toFixed(3)}`);
    if (posed < 0.8 * k) failures.push(`${name}: the unblurred frame doesn't show the leg at its frame-time pose (${posed} of ${k} band px)`);
    if (ds < 0.12) failures.push(`${name}: the 16-sample frame shows no blur on the limb (mean |samples − sharp| ${ds.toFixed(3)} < 0.12)`);
    if (dv < 0.12) failures.push(`${name}: the velocity-blurred frame leaves the limb sharp (mean |velocity − sharp| ${dv.toFixed(3)} < 0.12)`);
    if (vs > 0.1) failures.push(`${name}: the velocity frame misses the 16-sample frame on the limb (mean |velocity − samples| ${vs.toFixed(3)} > 0.1)`);
  }
  return failures;
}

describe(`${AC[4]} a walking character blurs on its limbs by velocity as by samples`, () => {
  it(`${AC[4]} velocity blur at 180° matches 16-sample blur on both legs within the tolerance, and both show blur there`, () => {
    requireMetal();
    none(problems(draw(dir())), 'the walker\'s limbs');
  }, 1_800_000);

  it(`${AC[4]} the planted velocity from the item's transform alone leaves the legs sharp and fails, naming the part`, () => {
    requireMetal();
    failsNaming(problems(draw(dir(), 'velocity_from_transform')), ['walker'], '--planted velocity_from_transform');
  }, 1_800_000);
});
