// AC3 #2034.97fa2de4: "At two poses 1 cm either side of a size threshold, the frame at each pose has one pixel hash
// whether it was reached by moving in, by moving out or by seeking. A planted hysteresis that keeps the last size
// differs between moving in and moving out and fails, naming the light"
//
// The threshold walk (helpers: `walkDoc`, `WALK_FRAMES`): `edge_lamp`'s range sphere spans 256 px on screen at D*, so
// it asks 512 px at pose A (1 cm nearer) and 256 px at pose B (1 cm beyond), and the other two lamps keep their sizes
// along the walk. One `deep-gpu run` on macOS's Metal device, two calls with `shadows: true` and the final target:
//   - played from frame 0 to 10: moving out it reaches A at frame 2 and B at 3; moving in, B at 7 and A at 8;
//   - opened at frame 10 (0.51 m nearer than D*), sought to frame 3 (B), then to frame 8 (A).
// At each pose the three frames (moving out, moving in, sought) must have one pixel hash, and each frame's tile table
// must equal the rule's at its pose (`tileTable`, reference.ts): edge_lamp at 512 px at A and 256 px at B. When two
// frames' hashes differ, the failure names the first light whose tile size differs between them.
// Wrong programs: the base (no tile table); `--planted tile_hysteresis`, which keeps a light's size from the frame
// before until its diameter passes the threshold by more than 5%, so A moving in keeps 256 px and B moving out keeps
// 512 px; a size eased over frames; a cache that carries a tile's contents from another size.
import { describe, expect, it } from 'vitest';
import { PLAIN_LOOK, TIMEOUT, failsNaming, frameAt, framesOf, none, requireMetal, useDir, useGpu, view3dCall, writeJson } from '../1634/helpers.ts';
import { AC, EDGE, POSE_A, POSE_B, WALK, WALK_LAMPS, mapsOf, runGpu, sizesOf, tableProblems, walkCam, walkDoc, type MapRow, type Planted } from './helpers.ts';
import { thresholdMargin, tileTable } from './reference.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();

interface Seen { leg: string; hash: string | null; maps: MapRow[] }
/** The first light whose tile size differs between two frames, as a clause; or that their tables agree. */
function sizeDifference(a: Seen, b: Seen): string {
  const [sa, sb] = [sizesOf(a.maps), sizesOf(b.maps)];
  const light = [...new Set([...sa.keys(), ...sb.keys()])].sort().find((l) => sa.get(l) !== sb.get(l));
  return light === undefined ? 'their tile tables agree' : `their tiles differ at ${light}: ${String(sa.get(light) ?? 'none')} px ${a.leg}, ${String(sb.get(light) ?? 'none')} px ${b.leg}`;
}

function problems(planted?: Planted): string[] {
  const out = dir();
  const common = { doc: writeJson(out, 'walk', walkDoc('walk')), look: PLAIN_LOOK, size: WALK.size, fps: WALK.fps, targets: ['final' as const] };
  const [played, sought] = runGpu(bin(), out, [
    { ...view3dCall({ ...common, frames: 11, capture: [2, 3, 7, 8] }), shadows: true },
    { ...view3dCall({ ...common, from: 10, frames: 3, seeks: [{ after: 10, to: 3 }, { after: 3, to: 8 }], capture: [3, 8] }), shadows: true },
  ], planted ? { planted } : {});
  const playedFrames = framesOf(out, played!, WALK.size, 'the walk played');
  const soughtFrames = framesOf(out, sought!, WALK.size, 'the walk sought');
  const failures: string[] = [];
  for (const pose of [POSE_A, POSE_B]) {
    const seen = (leg: string, frames: typeof playedFrames, n: number): Seen => {
      const f = frameAt(frames, n, `pose ${pose.name} ${leg}`);
      const maps = mapsOf(f, `pose ${pose.name} ${leg}`);
      failures.push(...tableProblems(`at pose ${pose.name} ${leg}`, maps, tileTable(walkCam(n), WALK_LAMPS)));
      return { leg, hash: f.pixelHash, maps };
    };
    const outward = seen('moving out', playedFrames, pose.out);
    const inward = seen('moving in', playedFrames, pose.in);
    const jump = seen('by seeking', soughtFrames, pose.sought);
    for (const other of [inward, jump]) {
      if (outward.hash === null || other.hash !== outward.hash) {
        failures.push(`at pose ${pose.name}, ${other.leg} and ${outward.leg} give different pixel hashes (${String(other.hash).slice(0, 12)}…, ${String(outward.hash).slice(0, 12)}…); ${sizeDifference(other, outward)}`);
      }
    }
  }
  return failures;
}

describe(`${ID} one picture at each pose by the threshold`, () => {
  it(`${ID} at poses 1 cm either side of edge_lamp's 256 px threshold each frame has one pixel hash whether reached by moving in, by moving out or by seeking`, () => {
    requireMetal();
    expect(tileTable(walkCam(POSE_A.out), WALK_LAMPS).find((r) => r.light === EDGE.id)?.size, 'the rule gives edge_lamp 512 px at A').toBe(512);
    expect(tileTable(walkCam(POSE_B.out), WALK_LAMPS).find((r) => r.light === EDGE.id)?.size, 'the rule gives edge_lamp 256 px at B').toBe(256);
    for (let n = 0; n < 11; n++) for (const l of WALK_LAMPS.slice(1)) expect(thresholdMargin(walkCam(n), l), `${l.id} sits 2% or more from a threshold at frame ${n}`).toBeGreaterThanOrEqual(0.02);
    none(problems(), `${ID}: the walk's frames at A and B`);
  }, TIMEOUT);

  it(`${ID} a planted hysteresis that keeps the last size (--planted tile_hysteresis) differs between moving in and moving out and fails, naming the light`, () => {
    requireMetal();
    const failures = problems('tile_hysteresis');
    console.log(`${ID} --planted tile_hysteresis: ${failures.slice(0, 4).join('; ').slice(0, 2000)}`);
    failsNaming(failures, [/moving in and moving out give different pixel hashes .*their tiles differ at edge_lamp: /], '--planted tile_hysteresis');
  }, TIMEOUT);
});
