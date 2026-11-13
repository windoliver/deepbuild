// AC4 #537.3f91633c: In 1,000 tanks of hull, turret and barrel whose logic writes turret yaw and barrel pitch, every
// barrel tip lies within 1e-4 m of an f64 reference at 20 sampled steps, whether seeked or played; a step that turns one
// turret uploads one slot; 2,000 units with 3 parts stay within the showpiece class's 10 ms of GPU at 1080p; and a planted
// pose applied in world space instead of the parent's fails, naming the unit
//
// This file holds every clause but the GPU budget, which is ac4-budget.test.ts (a timed file: README). `tanks`
// (fixtures.ts) instances the tank's glTF scene (hull, turret on it, barrel on the turret, the barrel's tip an empty
// node 2.5 m along it), its `parts` posing the turret by yaw and the barrel by pitch from `army` (programs.ts
// `armyProgram`): 1,000 tanks on a grid, each turned (37 i) mod 360° about +Y, every turret and barrel moving at every
// step up to 199, then still, but tank 417's turret, which turns 45° at step 210. A tip is `evaluate`'s
// `items/tanks/nodes/tip` (each slot's tip node as the frame drew it, world m), held to `tipAt`, the f64 reference that
// applies each part's pose in its parent node's space (README: Readings). The uploads are `counts`' `element_uploads`.
import { describe, expect, it } from 'vitest';
import { ARMY, TANK_SAMPLED, TURNED, TURN_STEP, armyProgram, tankAt } from './programs.ts';
import { TANK_SIZE, tankGltf, tanksSession, tipAt } from './fixtures.ts';
import {
  AC, TIMEOUT, arr, binOf, countsEntry, failsNaming, frameAt, framesOf, none, num, prebuild, putAsset, requireMetal, runGpu, show,
  useTemp, valueAt, view3dCall, writeJson, type Frame, type Planted, type View3d,
} from './helpers.ts';

prebuild(['deep-gpu']);
const temp = useTemp();

const TIPS = 'items/tanks/nodes/tip';
/** The criterion's agreement with the f64 reference. */
const TOL = 1e-4;
const unit = (i: number): string => `tanks#${i}.1`;

/** Step k's frame: each tank's tip against the f64 reference; each failure names the unit. */
function tipFailures(f: Frame, k: number, what: string): string[] {
  const tips = arr(valueAt(f, TIPS, what), `${what}: step ${k}'s ${TIPS}`);
  if (tips.length !== ARMY.n) return [`step ${k}: ${tips.length} tips reported, not ${ARMY.n}`];
  const out: string[] = [];
  for (let i = 0; i < ARMY.n; i++) {
    const want = tipAt(ARMY, i, k);
    const got = Array.isArray(tips[i]) ? (tips[i] as unknown[]).map(Number) : [];
    const off = got.length === 3 ? Math.hypot(got[0]! - want[0], got[1]! - want[1], got[2]! - want[2]) : Number.NaN;
    if (!(off <= TOL)) out.push(`step ${k}: ${unit(i)}'s barrel tip ${show(tips[i])} is ${Number.isNaN(off) ? 'not a point' : `${off.toExponential(2)} m`} from the f64 reference ${JSON.stringify(want.map((x) => +x.toFixed(6)))}`);
  }
  return out;
}
/** One `deep-gpu run` of the tanks: `calls` built from the document and its assets. */
function tanksRun(make: (doc: string, assets: Record<string, string>) => View3d[], what: string, planted?: Planted): { frames: Frame[][] } {
  requireMetal();
  const out = temp();
  const program = armyProgram(ARMY);
  const gltf = tankGltf();
  const assets = { ...putAsset(out, program.bytes, 'wasm'), ...putAsset(out, gltf.bytes, 'gltf') };
  const doc = writeJson(out, 'tanks', tanksSession(program, gltf.sha));
  const replies = runGpu(binOf('deep-gpu'), out, make(doc, assets).map(view3dCall), what, planted);
  return { frames: replies.map((r, i) => framesOf(r, `${what}, call ${i + 1}`)) };
}

describe(`${AC[4]} 1,000 tanks whose turrets and barrels logic poses, each part in its parent's space`, () => {
  it(`${AC[4]} every barrel tip lies within 1e-4 m of the f64 reference at 20 sampled steps, played and seeked`, () => {
    const back = [...TANK_SAMPLED].reverse();
    const { frames: [played, seeked] } = tanksRun((doc, assets) => [
      { doc, size: TANK_SIZE, frames: back[0]! + 1, evaluate: [TIPS], assets },
      { doc, size: TANK_SIZE, from: back[0]!, frames: back.length, seeks: back.slice(0, -1).map((k, i) => ({ after: k, to: back[i + 1]! })), evaluate: [TIPS], assets },
    ], 'AC4 the tanks played and seeked');
    expect(seeked!.map((f) => f.frame), 'the seeked session draws steps 190, 180, … 0').toEqual(back);
    const failures: string[] = [];
    for (const k of TANK_SAMPLED) {
      failures.push(...tipFailures(frameAt(played!, k, 'played'), k, 'played').slice(0, 5));
      failures.push(...tipFailures(frameAt(seeked!, k, 'seeked'), k, 'seeked').slice(0, 5));
    }
    none(failures, 'the 1,000 barrel tips at the 20 sampled steps, played and seeked');
  }, TIMEOUT);

  it(`${AC[4]} a step that turns one turret uploads one slot`, () => {
    for (let i = 0; i < ARMY.n; i++) {
      const [a, b] = [tankAt(ARMY, i, TURN_STEP - 1), tankAt(ARMY, i, TURN_STEP)];
      expect(JSON.stringify(a) === JSON.stringify(b), `the fixture: step 210 changes tank ${i} ${i === TURNED ? '(its turret alone)' : 'not at all'}`).toBe(i !== TURNED);
    }
    const { frames: [frames] } = tanksRun((doc, assets) => [{ doc, size: TANK_SIZE, from: 200, frames: 12, counts: true, assets }], 'AC4 the turret that turns at step 210');
    const f = frameAt(frames!, TURN_STEP, 'steps 200 to 211');
    const slots = arr(countsEntry(f, 'element_uploads', 'tanks', 'steps 200 to 211') ?? [], 'step 210\'s element_uploads.tanks').map((e) => {
      if (typeof e === 'number') return e;
      const m = /(?:^|#)(\d+)(?:\.\d+)?$/.exec(String(e));
      return m ? Number(m[1]) : Number.NaN;
    });
    expect(slots, `step 210, which turns tank 417's turret alone, uploads slot 417 alone: ${show(f.raw['element_uploads'])}`).toEqual([TURNED]);
    expect(num(f.frame, 'frame'), 'the frame read is step 210').toBe(TURN_STEP);
  }, TIMEOUT);

  it(`${AC[4]} planted part_pose_in_world_space fails the tips, naming the unit`, () => {
    const k = TANK_SAMPLED[1]!;
    const { frames: [played] } = tanksRun((doc, assets) => [{ doc, size: TANK_SIZE, frames: k + 1, evaluate: [TIPS], assets }], 'AC4 the tanks under the plant', 'part_pose_in_world_space');
    failsNaming(tipFailures(frameAt(played!, k, 'played'), k, 'played under the plant'), [/tanks#\d+\.1's barrel tip/, new RegExp(`^step ${k}:`)], 'the tips under part_pose_in_world_space');
  }, TIMEOUT);
});
