// AC6 #535.6cb0e483: 3,000 free atlas rows whose x, y and angle columns read logic arrays draw in one instanced draw for
// their atlas; a row at (10.5, 3.25) u with angle 90 draws its tile turned a quarter turn about its centre, its pixels
// equal by hash to an image item showing the same atlas cell at that pose; and a planted renderer that turns rows about
// the quad's corner fails, naming the row
//
// The set `free` (fixtures.ts `swarmDoc`): 3,000 rows with `place: free`, x, y and angle from `flock`'s arrays as f32,
// tile 1, 4 × 2 u quads on an 80 × 50 u page drawn at 8 px a u. Row 0 is at (10.5, 3.25) turned 90°; every other row
// sits at x ≥ 26 u, so the region [0, 0, 20, 12] u holds row 0 alone. The reference (`poseRefDoc`) is an image item
// showing atlas cell 1 (cropped from the same atlas) in a 4 × 2 u box centred on its origin, at (10.5, 3.25), turned
// 90°. "One instanced draw" is `deep_show`'s `batches` (#306's field; README). "Equal by hash" is the SHA-256 of that
// region's pixels in the two snapshots. The reference's own drawn extent, 2 × 4 u about (10.5, 3.25), shows it is turned.
import { describe, expect, it } from 'vitest';
import { POSE, SWARM, swarmProgram } from './programs.ts';
import { POSE_REGION, SWARM_PX, SWARM_SCALE, poseAtlas, poseRefDoc, swarmDoc } from './fixtures.ts';
import {
  AC, DOC, arr, binOf, failsNaming, near, none, num, obj, once, pixel, pngOf, prebuild, presented, putEvidence, regionHash, runShow,
  scenario, show, showCall, shownSnapshot, str, useTemp, type Image, type JsonObject, type Planted,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = { swarm: DOC(1), ref: DOC(2) };

interface Run { shown: JsonObject; swarm: Image; ref: Image }
function swarmRun(planted?: Planted): Run {
  const ev = temp();
  const program = swarmProgram();
  putEvidence(ev, program.bytes);
  const atlas = putEvidence(ev, poseAtlas());
  const [shown, ref] = runShow(binOf(), scenario(ev, [D.swarm, D.ref], [
    showCall(D.swarm, swarmDoc(program, atlas), { pixels: true, size: SWARM_PX }),
    showCall(D.ref, poseRefDoc(atlas), { pixels: true, size: SWARM_PX }),
  ], planted ? { planted } : {}), 'AC6 the 3,000 free rows') as [JsonObject, JsonObject];
  presented(shown, 'the 3,000 free rows');
  presented(ref, 'the reference image item');
  return { shown, swarm: pngOf(ev, shownSnapshot(shown, 'the free rows'), 'the free rows'), ref: pngOf(ev, shownSnapshot(ref, 'the reference'), 'the reference') };
}

/** The extent [x0, y0, x1, y1) of the region's pixels that differ from the ground (the region's corner pixel). */
function drawnExtent(im: Image): [number, number, number, number] | null {
  const ground = pixel(im, POSE_REGION[2] - 1, POSE_REGION[3] - 1);
  let box: [number, number, number, number] | null = null;
  for (let y = 0; y < POSE_REGION[3]; y++) for (let x = 0; x < POSE_REGION[2]; x++) {
    if (near(pixel(im, x, y), ground, 0)) continue;
    box = box ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x + 1), Math.max(box[3], y + 1)] : [x, y, x + 1, y + 1];
  }
  return box;
}
/** The criterion's check of row 0's pose: its region's pixels, by hash, against the reference's. */
function poseFailures(run: Run): string[] {
  const row = regionHash(run.swarm, POSE_REGION);
  const ref = regionHash(run.ref, POSE_REGION);
  return row === ref ? [] : [`row 0 (free#0) at (${POSE.x}, ${POSE.y}) u turned ${POSE.angle}°: the region around it hashes ${row}, not the image item's ${ref} (it draws over ${JSON.stringify(drawnExtent(run.swarm))} px, the image item over ${JSON.stringify(drawnExtent(run.ref))})`];
}

const honest = once(() => swarmRun());

describe(`${AC[6]} 3,000 free atlas rows from logic arrays: one instanced draw, and a row turned about its centre as an image item at that pose`, () => {
  it(`${AC[6]} the 3,000 free rows whose x, y and angle read logic arrays draw in one instanced draw for their atlas`, () => {
    const { shown } = honest();
    const batches = arr(shown['batches'], `deep_show: batches (${show(shown, 600)})`).map((b, i) => obj(b, `batches[${i}]`));
    const drawing = batches.filter((b) => arr(b['items'], 'batch items').map((x) => str(x, 'item')).includes('free'));
    expect(drawing.length, `one instanced draw draws the set free: ${show(batches)}`).toBe(1);
    expect(num(drawing[0]!['instances'], 'the batch\'s instances'), `that draw draws all ${SWARM} rows`).toBe(SWARM);
  }, 1_800_000);

  it(`${AC[6]} the row at (10.5, 3.25) u with angle 90 draws its tile turned a quarter turn about its centre, equal by hash to an image item showing the same atlas cell at that pose`, () => {
    const run = honest();
    // The reference shows the turn: 2 u wide and 4 u tall about (10.5, 3.25), at 8 px a u (within a pixel of antialiasing).
    const ext = drawnExtent(run.ref);
    const want = [(POSE.x - 1) * SWARM_SCALE, (POSE.y - 2) * SWARM_SCALE, (POSE.x + 1) * SWARM_SCALE, (POSE.y + 2) * SWARM_SCALE];
    expect(ext !== null && ext.every((v, i) => Math.abs(v - want[i]!) <= 1), `the image item at that pose draws over ${JSON.stringify(want)} px, turned: it draws over ${JSON.stringify(ext)}`).toBe(true);
    none(poseFailures(run), 'row 0\'s pose');
  }, 1_800_000);

  it(`${AC[6]} planted turns_about_corner turns rows about the quad's corner, and the check fails naming the row`, () => {
    failsNaming(poseFailures(swarmRun('turns_about_corner')), [/row 0 \(free#0\)/], 'row 0\'s pose under turns_about_corner');
  }, 1_800_000);
});
