// AC3 #971.fc809ae0: On that fixture no pixel within 32 px of the edge passes its wall's own level by more than 0.05
// stop; a planted base blurred without regard to edges overshoots the bright wall by about 1 stop beside the edge and
// fails, naming the edge and the overshoot.
//
// The two walls (helpers.ts `wallsDoc`) under tone map none and `local: {strength: 0.5}`, read from `pre_curve`, the
// linear image the tone curve reads (README: The surface under test). A pixel's own level is the mean log2 luminance of
// its wall's cells of its own checker phase (the higher cells or the lower), measured 64 px or more from the edge in the
// same frame. A pixel passes it by going beyond it away from the other wall: brighter on the bright wall, darker on the
// dark one (README: Readings). Every pixel whose centre is within 32 px of the edge is read.
//
// A program that draws the walls unchanged has no overshoot either, so the test first holds the frame to what `local`
// does here: its pixel hash is not the one drawn without `local`, and its walls sit at +2 and −2 stops within 0.1 stop
// away from the edge (criterion 2's numbers). At the base the look's `local` is read by nothing and the first of those
// fails. `--planted local_base_ignores_edges` brings the base back up with no regard to the guide (README: Planted
// programs); the same check fails on it, naming the edge and the bright wall's overshoot.
import { describe, expect, it } from 'vitest';
import { writeJson, type JsonObject } from '../418/helpers.ts';
import {
  AC, FULL, HALF, TIMEOUT, WALLS, drawn, frame, fromEdge, isHigh, lookWith, none, readLinear, requireGpu, rgbAt, runGpu, stopsOf, useGpu, useOut, view3d,
  wallLevels, wallOf, wallsAsGiven, wallsDoc, wallsHalved, type Linear, type Wall,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const EDGE = `the edge at x = ${WALLS.edge}`;

/** Each wall's pixels within 32 px of the edge that pass their own level by more than 0.05 stop, as sentences naming
 * the edge and the worst overshoot; and each wall's worst overshoot in stops. */
function edgeFailures(image: Linear): { failures: string[]; worst: Record<Wall, number> } {
  const own = wallLevels(image);
  const worst = { bright: { over: -Infinity, x: 0, y: 0, count: 0, total: 0 }, dark: { over: -Infinity, x: 0, y: 0, count: 0, total: 0 } };
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (fromEdge(x) > WALLS.near) continue;
    const wall = wallOf(x);
    const level = stopsOf(rgbAt(image, x, y));
    const ref = isHigh(x, y) ? own[wall].high : own[wall].low;
    const over = wall === 'bright' ? level - ref : ref - level;
    const w = worst[wall];
    w.total++;
    if (!(over <= 0.05)) w.count++;
    if (!(over <= w.over)) { w.over = over; w.x = x; w.y = y; }
  }
  const failures: string[] = [];
  for (const wall of ['bright', 'dark'] as const) {
    const w = worst[wall];
    if (w.count > 0) failures.push(`${EDGE}: the ${wall} wall overshoots its own level by ${w.over.toFixed(3)} stop at pixel (${w.x}, ${w.y}), ${fromEdge(w.x)} px from the edge, ${wall === 'bright' ? 'brighter' : 'darker'} than its cells are 64 px and more away; ${w.count} of its ${w.total} pixels within ${WALLS.near} px pass it by more than 0.05 stop`);
  }
  return { failures, worst: { bright: worst.bright.over, dark: worst.dark.over } };
}
const localCall = (doc: string): JsonObject => view3d({ doc, look: lookWith('none', HALF), size: FULL, targets: ['pre_curve'], capture: [0] });

describe(`${AC[3]} no overshoot beside the walls' edge`, () => {
  it(`${AC[3]} under local {strength: 0.5}, with the walls moved to +2 and −2 stops, no pixel within 32 px of the edge passes its wall's own level by more than 0.05 stop`, () => {
    requireGpu();
    const doc = writeJson(out(), 'walls.json', wallsDoc('walls-edge'));
    const [plainReply, hashReply, localReply] = runGpu(bin(), out(), [
      view3d({ doc, look: lookWith('none'), size: FULL, targets: ['pre_tone'], capture: [0] }),
      view3d({ doc, look: lookWith('none', HALF), size: FULL }),
      localCall(doc),
    ]);
    const plain = frame(drawn(plainReply!, 'the walls without local'), 0, 'the walls without local');
    none(wallsAsGiven(readLinear(out(), plain, 'pre_tone', FULL, 'the walls without local')), 'the fixture is the criterion\'s: walls 4 stops above and below middle grey, each with a ±0.25-stop checker');
    const changed = frame(drawn(hashReply!, 'the walls with local {strength: 0.5}'), 0, 'the walls with local {strength: 0.5}');
    expect(changed.pixel_hash, 'the guard: local {strength: 0.5} moves the walls, so its frame is not the one drawn without local').not.toBe(plain.pixel_hash);

    const image = readLinear(out(), frame(drawn(localReply!, 'the walls with local {strength: 0.5}, pre_curve'), 0, 'the walls with local {strength: 0.5}'), 'pre_curve', FULL, 'the walls with local {strength: 0.5}');
    none(wallsHalved(wallLevels(image)), 'the guard: local {strength: 0.5} put the walls at +2 and −2 stops, so a frame with no overshoot is not a frame left alone');
    const { failures, worst } = edgeFailures(image);
    console.log(`${AC[3]}: within ${WALLS.near} px of the edge the bright wall passes its own level by at most ${worst.bright.toFixed(4)} stop and the dark wall by at most ${worst.dark.toFixed(4)}`);
    none(failures, 'no pixel within 32 px of the edge passes its wall\'s own level by more than 0.05 stop');
  }, TIMEOUT);

  it(`${AC[3]} planted local_base_ignores_edges (the base blurred without regard to edges) overshoots the bright wall beside the edge and fails, naming the edge and the overshoot`, () => {
    requireGpu();
    const doc = writeJson(out(), 'walls.json', wallsDoc('walls-edge-planted'));
    const [reply] = runGpu(bin(), out(), [localCall(doc)], 'local_base_ignores_edges');
    const image = readLinear(out(), frame(drawn(reply!, 'the planted walls'), 0, 'the planted walls'), 'pre_curve', FULL, 'the planted walls');
    const { failures, worst } = edgeFailures(image);
    console.log(`${AC[3]}: the planted base overshoots the bright wall by ${worst.bright.toFixed(4)} stop and the dark wall by ${worst.dark.toFixed(4)} within ${WALLS.near} px of the edge`);
    expect(failures.length, 'the check fails on the planted program').toBeGreaterThan(0);
    const bright = failures.find((f) => f.includes('the bright wall overshoots'));
    expect(bright, `a failure names the bright wall's overshoot; the failures were:\n  ${failures.join('\n  ')}`).toBeDefined();
    expect(bright, 'the failure names the edge').toContain(EDGE);
    expect(bright, 'the failure names the overshoot, in stops').toMatch(/overshoots its own level by \d+\.\d{3} stop/);
  }, TIMEOUT);
});
