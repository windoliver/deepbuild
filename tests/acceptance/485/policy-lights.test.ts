// AC3 #485.ec6476de: The response sees only the policy's lights: in a room where the policy shades 32 of 40 point
// lights and none sits within the cut's margin, a response that returns 0.01 for every call, with an ambient of 0,
// gives 0.32 at a pixel inside all 40 lights' ranges; a planted loop that also calls it for the 8 lights the policy cut
// gives 0.40 and fails, naming the pixel; and a response that returns −1 counts as 0 and raises light_response.range
// once per operator and time.
//
// The room (helpers: `roomDoc`, `LAMPS`, `ROOM`): five plaster boxes seen from inside, 40 unshadowed point lights on a
// grid between the eye and the back wall, each with a 40 m range, 32 at 800 lm and 8 at 2 lm; a black sky; 480 × 320.
// The pixel is the frame's centre, on the back wall, at most 8 m from any light. `view3d` with `light_cut: true`
// (#425's report: the shaded lights with their weights, and those left out) holds the fixture to the criterion: the
// policy shades exactly the 32 bright lights, each at weight 1 (none within the margin), and leaves out the 8 dim ones.
// The operator `flat` answers every call with (0.01, 0.01, 0.01) and its ambient with 0; read on the linear target.
// 1. The pixel reads 0.32 in every channel, within 0.001.
// 2. `--planted loop_calls_cut_lights` (the loop also calls the response for the lights the policy cut): the same check
//    fails, naming the pixel, which reads 0.40 within 0.001.
// 3. The operator `negative` answers every call with −1: the pixel reads 0 (within 1e-6), and each of two frames (t = 0
//    and 1/30 s) carries exactly one notice `light_response.range` naming `negative`, at that frame's t.
// Wrong programs: the base (no light response); a loop that calls the response for every light, for none, or once per
// pixel; a light near the cut not weighted; a negative return summed as is, or clamped only in the sum; the range
// raised per pixel or per light, or once per session.
import { describe, expect, it } from 'vitest';
import {
  AC, LAMPS, PLAIN_LOOK, ROOM, TIMEOUT, constant, failsNaming, fmtRgb, framesOf, none, requireMetal, responseOp, roomDoc, runGpu, shown,
  useDir, useGpu, view3dCall, writeJson, ZERO, type Frame, type JsonObject, type Planted,
} from './helpers.ts';
import { dot, rayAt, sub, type V3 } from './reference.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();
const [PX, PY] = ROOM.pixel;
const FPS = 30;

/** Draws the room under `op`: frames 0 … frames − 1, each with its linear and ID targets and the light cut. */
function drawRoom(op: string, opItem: JsonObject, frames: number, planted?: Planted): Frame[] {
  const out = dir();
  const doc = writeJson(out, `room-${op}`, roomDoc(`room-${op}`, op, opItem));
  const [reply] = runGpu(bin(), out, [view3dCall({ doc, look: PLAIN_LOOK, size: ROOM.size, targets: ['linear', 'ids'], frames, fps: FPS, light_cut: true })], planted);
  const f = framesOf(out, reply!, ROOM.size, `the room under ${op}`);
  expect(f.map((x) => x.frame), `the room under ${op}: frames 0 to ${frames - 1}`).toEqual(Array.from({ length: frames }, (_, i) => i));
  return f;
}

/** The fixture is the criterion's room: the pixel shows the back wall, inside every light's range, and the policy shades
 * the 32 bright lights at weight 1 and cuts the 8 dim ones. */
function roomFailures(f: Frame): string[] {
  const out: string[] = [];
  if (f.ids!.at(PX, PY) !== 'back') out.push(`pixel (${PX}, ${PY}) shows ${f.ids!.at(PX, PY) ?? 'nothing'}, not the back wall`);
  const cam = { ...ROOM.cam, size: ROOM.size };
  const d = rayAt(cam, PX + 0.5, PY + 0.5);
  const t = (-5 - cam.position[2]) / d[2];
  const p: V3 = [cam.position[0] + t * d[0], cam.position[1] + t * d[1], -5];
  const far = Math.max(...LAMPS.map((l) => Math.sqrt(dot(sub(l.pos, p), sub(l.pos, p)))));
  if (far >= ROOM.range) out.push(`the pixel lies ${far.toFixed(2)} m from a light, outside its ${ROOM.range} m range`);
  const cut = f.lightCut;
  if (!cut) return [...out, 'the frame reports no light_cut'];
  const shaded = Array.isArray(cut['shaded']) ? cut['shaded'] : [];
  const leftOut = Array.isArray(cut['left_out']) ? cut['left_out'].map(String).sort() : [];
  const bright = LAMPS.filter((l) => !l.cut).map((l) => l.id).sort();
  const dim = LAMPS.filter((l) => l.cut).map((l) => l.id).sort();
  const names = shaded.map((s) => (typeof s === 'object' && s !== null && !Array.isArray(s) ? String(s['light']) : '')).sort();
  if (JSON.stringify(names) !== JSON.stringify(bright)) out.push(`the policy shades ${names.length} lights (${names.join(', ')}), not the 32 bright ones`);
  const weighted = shaded.filter((s) => !(typeof s === 'object' && s !== null && !Array.isArray(s) && s['weight'] === 1));
  if (weighted.length) out.push(`lights sit within the cut's margin, shaded at a weight other than 1: ${shown(weighted)}`);
  if (JSON.stringify(leftOut) !== JSON.stringify(dim)) out.push(`the policy leaves out ${leftOut.join(', ')}, not the 8 dim lights ${dim.join(', ')}`);
  return out;
}

/** The pixel against `want` in every channel; a failure names it. */
function pixelFailures(f: Frame, want: number, tol: number): string[] {
  const v = f.linear!.at(PX, PY);
  return v.every((c) => Math.abs(c - want) <= tol) ? [] : [`pixel (${PX}, ${PY}) reads ${fmtRgb(v)} where ${want} is wanted in every channel`];
}

const flat = (): JsonObject => responseOp('#485 AC3: 0.01 for every call, an ambient of 0.', constant([0.01, 0.01, 0.01]), ZERO);

describe(`${ID} the response sees only the policy's lights`, () => {
  it(`${ID} in a room whose policy shades 32 of 40 point lights, none within the cut's margin, a response returning 0.01 for every call with an ambient of 0 gives 0.32 at a pixel inside all 40 lights' ranges`, () => {
    requireMetal();
    const [f] = drawRoom('flat', flat(), 1);
    none(roomFailures(f!), 'the room is the criterion\'s');
    none(pixelFailures(f!, 0.32, 0.001), 'the response summed over the shaded lights');
  }, TIMEOUT);

  it(`${ID} a planted loop that also calls the response for the 8 lights the policy cut (--planted loop_calls_cut_lights) gives 0.40 and fails, naming the pixel`, () => {
    requireMetal();
    const [f] = drawRoom('flat', flat(), 1, 'loop_calls_cut_lights');
    none(roomFailures(f!), 'the room is the criterion\'s under the planted loop too');
    failsNaming(pixelFailures(f!, 0.32, 0.001), [`pixel (${PX}, ${PY})`], '--planted loop_calls_cut_lights');
    none(pixelFailures(f!, 0.4, 0.001), '--planted loop_calls_cut_lights reads 0.40 at the pixel');
  }, TIMEOUT);

  it(`${ID} a response that returns −1 counts as 0 and raises light_response.range once per operator and time`, () => {
    requireMetal();
    const frames = drawRoom('negative', responseOp('#485 AC3: −1 for every call, an ambient of 0.', constant([-1, -1, -1]), ZERO), 2);
    const failures: string[] = [];
    for (const f of frames) {
      failures.push(...pixelFailures(f, 0, 1e-6).map((s) => `frame ${f.frame}: ${s}`));
      const raised = f.notices.filter((n) => n['code'] === 'light_response.range');
      const mine = raised.filter((n) => n['op'] === 'negative');
      const t = f.frame / FPS;
      if (mine.length !== 1) failures.push(`frame ${f.frame} (t = ${t.toFixed(4)} s) raises light_response.range for negative ${mine.length} times, not once: ${shown(raised.slice(0, 5))}`);
      else if (typeof mine[0]!['t'] !== 'number' || Math.abs((mine[0]!['t'] as number) - t) > 1e-6) failures.push(`frame ${f.frame}: light_response.range names t ${shown(mine[0]!['t'])}, not ${t} s`);
      if (raised.length !== mine.length) failures.push(`frame ${f.frame}: light_response.range names an operator other than negative: ${shown(raised.slice(0, 5))}`);
    }
    none(failures, 'a negative return counted as 0, raised once per operator and time');
  }, TIMEOUT);
});
