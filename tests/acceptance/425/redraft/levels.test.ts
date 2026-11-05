// AC2 #425.fe13e22a: The same view always draws the same mesh level, the coarsest whose projected error is at most 1
// device px, and a camera that crosses a level's threshold from either side or a seek to the same time gives the same
// pixel hash on one machine.
//
// A bumpy icosphere of 5,120 triangles, generated here, goes through the simplify job with its defaults (`levels:
// auto`), which writes it back with index-only levels and the probe's `lod_errors`. The level sweep dollies the camera
// from 1.5 m to 60 m and back, geometrically. Every frame draws the coarsest level whose error, projected through the
// view at the rock's distance, is at most 1 device px (the work-product class's lod_px), by the frame's own report,
// whose projected errors are the probe's errors times one factor that falls as 1 ÷ distance; the triangles it draws are
// that level's; frames n and 192 − n, and a fresh process's seek, report the same level and draw the same pixels.
// Planted: a level chosen from the previous frame's view.
//
// Blind redraft of ../levels.test.ts (redraft/README: D1): as the original, word for word, except that the level
// sweep's document comes from ./helpers.ts, whose dolly keys are time literals the base's grammar accepts.
import { describe, expect, it } from 'vitest';
import {
  AC, BAND_SIZE, LEVEL_SWEEP, LOOK, ROCK_TRIANGLES, failsNaming, none, playAndSeek, requireMetal, rockGltf, rowOf, runGpu,
  sameViewProblems, simplifiedOf, useBuilds, useDir, writeJson,
  type GpuPlanted, type Played, type Simplified,
} from '../helpers.ts';
import { levelDoc } from './helpers.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ID = AC[2];
const bin = useBuilds(['default']);
const dir = useDir();
/** The work-product class's lod_px, device px (Level of detail: levels by error). */
const LOD_PX = 1;

function simplified(out: string): Simplified {
  const asset = join(out, 'rock.gltf');
  writeFileSync(asset, rockGltf());
  const [r] = runGpu(bin('default'), out, [{ call: 'simplify', asset, node: 0, levels: 'auto' }]);
  return simplifiedOf(r!, out, 'the simplify job');
}

/** The job's levels: the input first at error 0, fewer triangles each level, no error lower than the level before. */
function jobProblems(s: Simplified): string[] {
  const out: string[] = [];
  if (s.triangles.length < 3) out.push(`the job made ${s.triangles.length} levels of a 5,120-triangle mesh, fewer than 3`);
  if (s.lod_errors.length !== s.triangles.length) out.push(`lod_errors has ${s.lod_errors.length} entries for ${s.triangles.length} levels`);
  if (s.triangles[0] !== ROCK_TRIANGLES || s.lod_errors[0] !== 0) out.push(`level 0 is ${s.triangles[0]} triangles at error ${s.lod_errors[0]}, not the input's ${ROCK_TRIANGLES} at 0`);
  for (let i = 1; i < s.triangles.length; i++) {
    if (!(s.triangles[i]! < s.triangles[i - 1]!)) out.push(`level ${i} keeps ${s.triangles[i]} triangles, not fewer than level ${i - 1}'s ${s.triangles[i - 1]}`);
    if (!(s.lod_errors[i]! >= s.lod_errors[i - 1]!)) out.push(`level ${i}'s error ${s.lod_errors[i]} is lower than level ${i - 1}'s ${s.lod_errors[i - 1]}`);
    if (!(s.lod_errors[i]! <= 1)) out.push(`level ${i}'s error ${s.lod_errors[i]} passes auto's max_error 1`);
  }
  return out;
}

/** Each frame's level is the coarsest within 1 px by its own projected errors, which are the probe's errors projected
 * through the view; it draws that level's triangles; the sweep passes through at least three levels. */
function levelProblems(p: Played, s: Simplified): string[] {
  const out: string[] = [];
  const factors: { z: number; fz: number }[] = [];
  const seen = new Set<number>();
  for (const f of p.play) {
    const r = rowOf(f, 'rock', out);
    if (!r) continue;
    if (r.level === null || r.errors_px === null || r.errors_px.length !== s.lod_errors.length) { out.push(`frame ${f.frame}: the rock's row has no level or not one projected error per level: ${JSON.stringify(r.raw)}`); continue; }
    let coarsest = 0;
    r.errors_px.forEach((e, i) => { if (e <= LOD_PX) coarsest = Math.max(coarsest, i); });
    if (r.level !== coarsest) out.push(`frame ${f.frame} draws level ${r.level}, but the coarsest level within ${LOD_PX} px is ${coarsest} (errors ${r.errors_px.map((e) => e.toPrecision(3)).join(', ')} px)`);
    const k = s.lod_errors.length - 1;
    const factor = r.errors_px[k]! / s.lod_errors[k]!;
    for (let i = 1; i <= k; i++) {
      if (Math.abs(r.errors_px[i]! - s.lod_errors[i]! * factor) > 1e-6 * r.errors_px[i]! + 1e-9) out.push(`frame ${f.frame}: level ${i}'s projected error ${r.errors_px[i]} px isn't its probe error ${s.lod_errors[i]} projected as the others are (× ${factor})`);
    }
    if (r.triangles !== s.triangles[r.level]) out.push(`frame ${f.frame} draws ${r.triangles} triangles of the rock at level ${r.level}, not that level's ${s.triangles[r.level]}`);
    const z = LEVEL_SWEEP.values[f.frame]!;
    if (z >= 25) factors.push({ z, fz: factor * z });
    if (f.frame <= LEVEL_SWEEP.leg) seen.add(r.level);
  }
  if (factors.length > 0) {
    const sorted = factors.map((x) => x.fz).sort((a, b) => a - b); const mid = sorted[Math.floor(sorted.length / 2)]!;
    for (const x of factors) if (Math.abs(x.fz - mid) > 0.06 * mid) out.push(`at ${x.z.toFixed(2)} m the projected errors scale by ${(x.fz / x.z).toPrecision(4)}, not as 1 ÷ distance (${(mid / x.z).toPrecision(4)})`);
  }
  if (seen.size < 3) out.push(`the sweep from 1.5 m to 60 m draws ${seen.size} levels (${[...seen].join(', ')}), fewer than 3`);
  return out;
}

function swept(planted?: GpuPlanted): { p: Played; s: Simplified } {
  requireMetal();
  const out = dir();
  const s = simplified(out);
  none(jobProblems(s), 'the simplify job\'s levels');
  const doc = writeJson(out, 'levels', levelDoc(s.sha));
  const p = playAndSeek(bin('default'), out, { doc, look: LOOK, size: BAND_SIZE, lod: true, assets: { [s.sha]: s.path } }, LEVEL_SWEEP, planted ? { planted } : {});
  return { p, s };
}

describe(`${ID} one view draws one mesh level, the coarsest within 1 device px`, () => {
  it(`${ID} every frame of the level sweep draws the coarsest level within 1 px, and a level threshold crossed from either side or seeked gives the same pixel hash`, () => {
    const { p, s } = swept();
    none(levelProblems(p, s), 'each frame draws the coarsest level within 1 device px');
    expect(p.seeks.length, 'the sweep seeks the frames where the level changes').toBeGreaterThan(2);
    none(sameViewProblems(p, LEVEL_SWEEP), 'one view draws one level and one picture, however it was reached');
  }, 1_800_000);

  it(`${ID} a level chosen from the previous frame's view fails, naming the frame`, () => {
    const { p, s } = swept('level_by_earlier_frame');
    failsNaming([...levelProblems(p, s), ...sameViewProblems(p, LEVEL_SWEEP)], ['frame '], '--planted level_by_earlier_frame');
  }, 1_800_000);
});
