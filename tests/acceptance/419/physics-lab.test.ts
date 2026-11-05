// AC5 #419.a7e27e24: An export of a physics lab with motion blur at 8 samples has the same world step hashes as the
// same export with blur off, and a blurred frame reached by seek equals the played one; a planted sampler that steps
// the world at sample times changes the step hashes and fails.
//
// The lab: a `fixture.world@1` world standing in for the physics module (README: Assumed surfaces 9): two balls
// (r 0.2 m) thrown over a floor at 120 steps a second for 2 s, baked at check, each step hashed; the balls draw white
// and unlit over a grey floor, orthographic at 60 px/m, 24 fps. Three exports: frames 0–47 with motion blur by samples
// at 8 samples, 180°; the same with blur off; and frame 12 (0.5 s, ball_a ~5.7 m/s, about 7 px per shutter) opened by
// a seek with blur on. Each reply's `worlds.lab.step_hashes` (README: Assumed surfaces 8): at least 240 steps, at least
// 200 distinct, and equal across the three. Frame 12 played and seeked have one final-target hash, and it differs from
// frame 12 with blur off (blur shows). `--planted sampler_steps_world` steps the world at each sample's time: its
// blurred export's step hashes differ from the unblurred one's and the check fails, naming `lab`.
import { describe, it } from 'vitest';
import {
  AC, DARK_SKY, arr, blur, box, failsNaming, frameAt, framesOf, isObject, look, none, ortho, requireMetal, runGpu, sessionDoc, shown, str,
  unlit, useDir, useGpu, view3dCall, writeJson, type GpuPlanted, type JsonObject,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [480, 270];
const N = 12;

const labDoc = (): JsonObject => sessionDoc('lab-419', SIZE, {
  cam: ortho([3, 1.5, 0], 8), sky: DARK_SKY, white: unlit([1, 1, 1]), grey: unlit([0.2, 0.2, 0.2]),
  floor: box([10, 0.1, 1], [3, -0.05, 0], { material: 'grey' }),
  lab: {
    kind: 'fixture.world@1', material: 'white',
    params: {
      step_hz: 120, span: '2s', gravity: -9.81, floor: 0, restitution: 0.8,
      bodies: { ball_a: { radius: 0.2, pos: [0, 2.5, 0], vel: [3, 0, 0] }, ball_b: { radius: 0.2, pos: [0, 1, 0], vel: [5, 4, 0] } },
    },
  },
});

/** The step hashes a reply reports for the world `lab`. */
function stepHashes(reply: JsonObject, what: string): string[] | string {
  const worlds = reply['worlds'];
  if (!isObject(worlds) || !isObject(worlds['lab'])) return `${what} reports no step hashes for the world lab: worlds ${shown(worlds)}`;
  return arr(worlds['lab']['step_hashes'], `${what}: worlds.lab.step_hashes`).map((h) => str(h, `${what}: a step hash`));
}

function problems(out: string, planted?: GpuPlanted, seek = true): string[] {
  const doc = writeJson(out, 'lab', labDoc());
  const exp = (on: boolean, from: number, frames: number): JsonObject => view3dCall({
    doc, look: look({ motionBlur: on ? blur('samples', 8) : 'none' }), size: SIZE, class: 'export', fps: 24, from, frames, capture: [N], targets: ['final'],
  });
  const replies = runGpu(bin(), out, [exp(true, 0, 48), exp(false, 0, 48), ...(seek ? [exp(true, N, 1)] : [])], planted);
  const failures: string[] = [];
  const [on, off, sought] = replies.map((r, i) => stepHashes(r, ['the blurred export', 'the unblurred export', 'the seeked export'][i]!));
  if (off === undefined || typeof off === 'string') return [off ?? 'lab: the unblurred export has no reply'];
  if (off.length < 240) failures.push(`lab: the unblurred export reports ${off.length} steps, not the 240 of 2 s at 120 Hz`);
  if (new Set(off).size < 200) failures.push(`lab: only ${new Set(off).size} distinct step hashes; the balls move every step`);
  for (const [what, h] of [['the blurred export', on], ['the seeked blurred export', sought]] as const) {
    if (h === undefined) continue;
    if (typeof h === 'string') { failures.push(h); continue; }
    const k = h.findIndex((x, i) => x !== off[i]);
    if (h.length !== off.length || k >= 0) failures.push(`lab: ${what}'s step hashes differ from the unblurred export's (${h.length} against ${off.length} steps; first difference at step ${k >= 0 ? k : Math.min(h.length, off.length)})`);
  }
  const fin = replies.map((r, i) => frameAt(framesOf(r, `call ${i}`), N, `call ${i}`).final);
  if (fin[0] === fin[1]) failures.push(`lab: blurred frame ${N} equals the unblurred one; no blur shows`);
  if (seek && fin[2] !== fin[0]) failures.push(`lab: blurred frame ${N} seeked (${fin[2]}) differs from frame ${N} played (${fin[0]})`);
  return failures;
}

describe(`${AC[5]} motion blur never steps a world`, () => {
  it(`${AC[5]} the blurred export has the unblurred export's world step hashes, and blurred frame ${N} seeked equals played`, () => {
    requireMetal();
    none(problems(dir()), 'the physics lab');
  }, 1_800_000);

  it(`${AC[5]} the planted sampler that steps the world at sample times changes the step hashes and fails, naming the world`, () => {
    requireMetal();
    failsNaming(problems(dir(), 'sampler_steps_world', false), ['lab', 'step hashes differ'], '--planted sampler_steps_world');
  }, 1_800_000);
});
