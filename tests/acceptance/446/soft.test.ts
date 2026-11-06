// AC1 #446.0ba58c87: Soft shadows harden where objects touch and widen with the light's size, and a still frame reached
// by seeking equals the played one on the same machine's pixel hash, with no noise seeded by the frame.
//
// Harden and widen. The blade (helpers: bladeDoc) at sun angles 3° and 9°, in plan at 80 px/m. Across the shadow's side
// edge at s = 0.25, 1 and 2.5 m from the foot the penumbra is measured on the linear target (helpers: penumbraWidth, 9
// columns averaged). A uniform disk of the sun's size gives 2 √2 s tan(angle ÷ 2) across. The width at the foot is under
// 0.35 of the width at 2.5 m (the disk's ratio is 0.1) and grows with s; at 2.5 m the 9° sun's is 2 to 4 times the 3°
// sun's; each width of 8 px or more by the disk is within 40% of the disk's. Then the spot: the plank's edge (helpers:
// plankDoc) at radius 0.1 and 0.3 m, normalized by the unshadowed ρ I cos θ ÷ (π d²): 2 to 4 times as wide, the wider
// within 40% of the disk's. The wrong program is the shipped `method: pcf`, Castaño's fixed 9 taps, which must fail by
// naming both "harden" and "widen" (no plant needed).
//
// Seek equals play, no frame noise. The blade at 3° with contact shadows and a shadowed spot, the blade moving along x
// by a channel for 0.2 s, then still, at 30 fps. Frame 3 (moving) and frame 12 (still) each equal a fresh process that
// opens there, by pixel hash; frames 7 to 12 show one picture, so nothing in them is seeded by the frame or the clock;
// frame 3 differs from frame 12, so the hash sees the blade. `--planted soft_noise_from_frame` (the disk's rotation also
// hashes the frame number) fails, naming "still frames".
import { describe, it } from 'vitest';
import {
  AC, PLANK, SOFT, bladeDoc, diskWidth, failsNaming, frameAt, framesOf, hashOf, linearChannel, none, only, orthoProject, penumbraWidth, plankDoc,
  rad, readLinear, requireMetal, runGpu, spot, useDir, useGpu, view3dCall, writeJson, type GpuPlanted, type JsonObject, type Linear,
} from './helpers.ts';

const ID = AC[1];
const bin = useGpu();
const dir = useDir();
const S = SOFT.size;
const AVERAGE = 4;
const DISTANCES = [0.25, 1, 2.5];
const ANGLES = [3, 9];

/** Lit to dark across the side edge y = 1.5 at x = −s, one sample a row. */
function sideProfile(l: Linear, s: number): number[] {
  const [cx, cy] = orthoProject(SOFT.target, SOFT.width, S, [-s, 1.5]);
  const col = Math.floor(cx); const edge = Math.floor(cy); const out: number[] = [];
  for (let y = edge - 50; y <= edge + 50; y++) {
    let sum = 0;
    for (let x = col - AVERAGE; x <= col + AVERAGE; x++) sum += l.at(x, y);
    out.push(sum / (2 * AVERAGE + 1) / SOFT.lit);
  }
  return out;
}
/** Lit to dark across the plank's edge x = 0 at y = 0, normalized by the spot's unshadowed light. */
function plankProfile(l: Linear): number[] {
  const [cx, cy] = orthoProject(SOFT.target, SOFT.width, S, [0, 0]);
  const col = Math.floor(cx); const row = Math.floor(cy); const out: number[] = [];
  const I = PLANK.power / (4 * Math.PI);
  for (let x = col + 40; x >= col - 40; x--) {
    let sum = 0;
    for (let y = row - AVERAGE; y <= row + AVERAGE; y++) {
      const wx = (x + 0.5 - cx) / SOFT.K; const wy = (cy - y - 0.5) / SOFT.K;
      const d = Math.hypot(wx, wy, PLANK.height);
      sum += l.at(x, y) / ((PLANK.rho * I * PLANK.height) / (Math.PI * d * d * d));
    }
    out.push(sum / (2 * AVERAGE + 1));
  }
  return out;
}
/** What a soft shadow must do, given the blade's widths by angle and distance. */
function bladeProblems(widths: Map<number, number[]>, label: string): string[] {
  const out: string[] = [];
  for (const a of ANGLES) {
    const w = widths.get(a)!;
    const row = `${label} at ${a}°: widths ${w.map((v) => v.toFixed(1)).join(', ')} px at ${DISTANCES.join(', ')} m`;
    if (w[0]! > 0.35 * w[2]!) out.push(`doesn't harden at the foot: ${row}`);
    if (!(w[0]! < w[1]! && w[1]! < w[2]!)) out.push(`doesn't harden toward the foot: ${row}`);
    DISTANCES.forEach((s, i) => {
      const disk = diskWidth(Math.SQRT2 * s * Math.tan(rad(a) / 2) * SOFT.K);
      if (disk >= 8 && Math.abs(w[i]! / disk - 1) > 0.4) out.push(`isn't the disk's ${disk.toFixed(1)} px at ${s} m: ${row}`);
    });
  }
  const ratio = widths.get(9)![2]! / widths.get(3)![2]!;
  if (ratio < 2 || ratio > 4) out.push(`${label} doesn't widen with the sun's size: 9° over 3° is ${ratio.toFixed(2)} at 2.5 m`);
  return out;
}
function bladeWidths(policy: JsonObject, label: string): Map<number, number[]> {
  const out = dir();
  const replies = runGpu(bin(), out, ANGLES.map((a) => view3dCall({ doc: writeJson(out, `${label}-${a}`, bladeDoc(a, { policy })), size: S, targets: ['linear'] })));
  return new Map(ANGLES.map((a, i) => {
    const l = readLinear(out, only(replies[i]!, `${label} at ${a}°`), S, `${label} at ${a}°`);
    return [a, DISTANCES.map((s) => penumbraWidth(sideProfile(l, s)))];
  }));
}

function stillProblems(planted?: GpuPlanted): string[] {
  const out = dir();
  const fill = spot(400, [-3, 2, 6], [0, 0, 0], { shadow: true, outer: 40, radius: 0.1 });
  const doc = writeJson(out, 'moving', bladeDoc(3, {
    items: { fill }, policy: { contact: { length: 0.3, samples: 16 }, shadowed: { spots: 1 } },
    extra: { channels: { sweep: linearChannel('items/blade/at/pos/0', 0, 0.5, 0.2) } },
  }));
  const call = { doc, size: S, fps: 30, targets: ['final' as const] };
  const [play, seek3, seek12] = [
    runGpu(bin(), out, [view3dCall({ ...call, frames: 13, capture: [3, 7, 8, 9, 10, 11, 12] })], planted)[0]!,
    runGpu(bin(), out, [view3dCall({ ...call, from: 3, capture: [3] })], planted)[0]!,
    runGpu(bin(), out, [view3dCall({ ...call, from: 12, capture: [12] })], planted)[0]!,
  ];
  const played = framesOf(play, 'the play');
  const hash = (n: number): string => hashOf(frameAt(played, n, 'the play'), 'the play');
  const problems: string[] = [];
  if (hash(3) !== hashOf(only(seek3, 'the seek to 3'), 'the seek to 3')) problems.push('frame 3 sought differs from frame 3 played');
  if (hash(12) !== hashOf(only(seek12, 'the seek to 12'), 'the seek to 12')) problems.push('frame 12 sought differs from frame 12 played');
  for (const n of [8, 9, 10, 11, 12]) if (hash(n) !== hash(7)) problems.push(`still frames differ: frame ${n} from frame 7`);
  if (hash(3) === hash(12)) problems.push('frame 3 equals frame 12, so the hash doesn\'t see the blade move');
  return problems;
}

describe(`${ID} soft shadows harden, widen, and hold no history`, () => {
  it(`${ID} a sun's penumbra hardens at the foot and widens with its angle, a spot's widens with its radius, and pcf does neither`, () => {
    requireMetal();
    none(bladeProblems(bladeWidths({}, 'pcss'), 'pcss'), 'the blade under pcss');
    failsNaming(bladeProblems(bladeWidths({ soft: { method: 'pcf' } }, 'pcf'), 'pcf'), ['harden', 'widen'], 'the fixed filter, method pcf');
    const out = dir();
    const radii = [0.1, 0.3];
    const replies = runGpu(bin(), out, radii.map((r) => view3dCall({ doc: writeJson(out, `plank-${r}`, plankDoc(r)), size: S, targets: ['linear'] })));
    const [thin, wide] = radii.map((r, i) => penumbraWidth(plankProfile(readLinear(out, only(replies[i]!, `the spot at ${r} m`), S, `the spot at ${r} m`))));
    const disk = diskWidth((0.3 / 2) * SOFT.K);
    const problems: string[] = [];
    if (wide! / thin! < 2 || wide! / thin! > 4) problems.push(`the spot's penumbra is ${thin!.toFixed(1)} px at radius 0.1 m and ${wide!.toFixed(1)} px at 0.3 m`);
    if (Math.abs(wide! / disk - 1) > 0.4) problems.push(`the spot's penumbra at 0.3 m is ${wide!.toFixed(1)} px, the disk's ${disk.toFixed(1)} px`);
    none(problems, 'the plank under a spot');
  }, 1_800_000);

  it(`${ID} frames sought equal frames played by pixel hash and still frames show one picture; the planted soft_noise_from_frame fails, naming still frames`, () => {
    requireMetal();
    none(stillProblems(), 'the moving blade');
    failsNaming(stillProblems('soft_noise_from_frame'), ['still frames'], 'the planted soft_noise_from_frame');
  }, 1_800_000);
});
