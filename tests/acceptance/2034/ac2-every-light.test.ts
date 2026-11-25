// AC2 #2034.f29824eb: "All 18 lights keep a shadow in the hall: for each light, a floor pixel the CPU rays call
// occluded from it reads within 4 code values (drafted) of the frame with that light off. In a new fixture of 32
// shadowed point lights, every light holds six tiles of 256 px or less and none is reported as dropped. A planted
// policy that keeps today's 2 spots leaves lamps lighting through a wall in the hall and fails, naming the first by ID"
//
// 1. The hall (helpers: `hallDoc`) at its `above` pose, 1920 × 1080, in one `deep-gpu run` on macOS's Metal device:
//    19 frames, frame 0 with every light on and frame k (1 to 18) with the k-th light by ID off (`visible: false`,
//    patched in before frame k and back on before frame k + 1), each frame's final picture and `shadows` report. For
//    each light, `checkPixels` (reference.ts) picks a floor pixel whose floor point, and every floor point 0.3 m around
//    it, the CPU rays call blocked from the light by the wall, with no other light's shadow edge within 0.3 m, inside
//    the light's inner cone, where the light unshadowed would add 12 code values or more (README: The hall). Frame 0
//    and that light's frame must agree there within 4 code values in each of R, G and B, and frame 0 lists a map row
//    for each of the 18 lights. Failures name the light, in ID order.
// 2. The same run under `--planted tile_keeps_fixed_caps`, a policy that keeps today's caps (2 spots, no point light):
//    the lights it leaves unshadowed light the floor behind the wall, and the first failure names the first of them by
//    ID (the CPU policy's order at the pose says which 2 spots it keeps; the points never have a shadow under it).
// 3. The 32 lamps (helpers: `lamps32Doc`) on the noop lane, anywhere the binary builds, two frames with `shadows: true`:
//    each lamp's row holds six slots at a size of 256 px or less, and no frame's `lights_over_budget` notice names a
//    shadow dropped.
// Wrong programs: the base (2 spots' maps at most, the rest dropped and lit through the wall); the planted caps; a rule
// that drops shadows when the atlas fills; point lights with fewer than six tiles; a notice that names a light whose
// shadow is kept.
import { describe, expect, it } from 'vitest';
import {
  PLAIN_LOOK, TIMEOUT, WRITER, decodePng, failsNaming, frameAt, framesOf, none, requireMetal, useDir, useGpu, view3dCall, writeJson, type Frame, type JsonObject,
} from '../1634/helpers.ts';
import { ordered } from '../1634/reference.ts';
import {
  ABOVE, AC, HALL, HALL_BOXES, HALL_LAMPS, LAMPS32, LAMPS32_LIGHTS, droppedShadows, hallDoc, lamps32Doc, mapsOf, runGpu, type Planted,
} from './helpers.ts';
import { checkPixels } from './reference.ts';

const ID = AC[2];
const bin = useGpu();
const dir = useDir();
/** The lights in ID order: frame k + 1 has `BY_ID[k]` off. */
const BY_ID = HALL_LAMPS.map((l) => l.id).sort();
const set = (id: string, visible: boolean): JsonObject => ({ op: 'set', id, path: `items/${id}/visible`, value: visible });

/** What is wrong in the hall at `above`, each failure starting with its light's ID, in ID order. */
function hallProblems(planted?: Planted): string[] {
  const picks = checkPixels(ABOVE, HALL_LAMPS, HALL_BOXES, 'floor', HALL.rho);
  const weak = BY_ID.filter((id) => !((picks.get(id)?.adds ?? 0) >= 12));
  expect(weak, 'every light has a floor pixel the CPU rays call occluded from it, where it would add 12 code values or more unshadowed').toEqual([]);
  const out = dir();
  const patches = BY_ID.map((id, k) => ({ frame: k + 1, writer: WRITER, ops: [set(id, false), ...(k > 0 ? [set(BY_ID[k - 1]!, true)] : [])] }));
  const call = { ...view3dCall({ doc: writeJson(out, 'hall', hallDoc('hall-above', ABOVE)), look: PLAIN_LOOK, size: HALL.size, frames: BY_ID.length + 1, targets: ['final'] }), shadows: true, patches };
  const [reply] = runGpu(bin(), out, [call], planted ? { planted } : {});
  const frames = framesOf(out, reply!, HALL.size, 'the hall at above');
  const decoded = new Map<number, ReturnType<typeof decodePng>>();
  const codes = (f: Frame, x: number, y: number): number[] => {
    expect(f.final, `frame ${f.frame} has its final picture`).not.toBeNull();
    if (!decoded.has(f.frame)) decoded.set(f.frame, decodePng(f.final!));
    const png = decoded.get(f.frame)!; const o = (y * png.width + x) * 4;
    return [png.rgba[o]!, png.rgba[o + 1]!, png.rgba[o + 2]!];
  };
  const all = frameAt(frames, 0, 'the hall with every light on');
  const mapped = new Set(mapsOf(all, 'the hall with every light on').map((m) => m.light));
  return BY_ID.flatMap((id, k) => {
    const pick = picks.get(id)!;
    const on = codes(all, pick.x, pick.y);
    const off = codes(frameAt(frames, k + 1, `the hall with ${id} off`), pick.x, pick.y);
    const apart = Math.max(...on.map((v, c) => Math.abs(v - off[c]!)));
    const failures: string[] = [];
    if (!mapped.has(id)) failures.push(`${id}: has no shadow map in the frame with every light on (shadows.maps)`);
    if (apart > 4) failures.push(`${id}: pixel [${pick.x}, ${pick.y}], floor (${pick.floor[0].toFixed(2)}, ${pick.floor[2].toFixed(2)}) behind the wall from it, reads [${on.join(', ')}] with every light on and [${off.join(', ')}] with ${id} off: ${apart} code values apart, over 4, so it lights through the wall`);
    return failures;
  });
}

describe(`${ID} every shaded light keeps a shadow`, () => {
  it(`${ID} in the hall each of the 18 lights is dark at a floor pixel the CPU rays call occluded from it: within 4 code values of the frame with that light off`, () => {
    requireMetal();
    none(hallProblems(), `${ID}: the hall's lights behind the wall`);
  }, TIMEOUT);

  it(`${ID} a planted policy that keeps today's 2 spots (--planted tile_keeps_fixed_caps) leaves lamps lighting through the wall and fails, naming the first by ID`, () => {
    requireMetal();
    const spots = ordered(ABOVE, HALL_LAMPS).map((s) => s.id).filter((id) => id.startsWith('spot_'));
    const first = BY_ID.find((id) => !spots.slice(0, 2).includes(id))!;
    const failures = hallProblems('tile_keeps_fixed_caps');
    console.log(`${ID} --planted tile_keeps_fixed_caps: ${failures.slice(0, 4).join('; ').slice(0, 2000)}`);
    failsNaming(failures, [new RegExp(`^${first}: pixel \\[.*so it lights through the wall$`)], '--planted tile_keeps_fixed_caps');
    expect(failures[0], `the first failure names ${first}, the first light by ID that today's 2 spots leave unshadowed`).toMatch(new RegExp(`^${first}: `));
  }, TIMEOUT);

  it(`${ID} with 32 shadowed point lights every light holds six tiles of 256 px or less and none is reported as dropped`, () => {
    const out = dir();
    const call = { ...view3dCall({ doc: writeJson(out, 'lamps-32', lamps32Doc()), look: PLAIN_LOOK, size: LAMPS32.size, frames: 2, targets: [] }), shadows: true };
    const [reply] = runGpu(bin(), out, [call], { lane: 'noop' });
    const failures: string[] = [];
    for (const f of framesOf(out, reply!, LAMPS32.size, 'the 32 lamps')) {
      const rows = new Map(mapsOf(f, `the 32 lamps, frame ${f.frame}`).map((m) => [m.light, m]));
      for (const l of LAMPS32_LIGHTS) {
        const m = rows.get(l.id);
        if (!m) failures.push(`frame ${f.frame}: ${l.id} has no tiles`);
        else if (m.slots?.length !== 6 || m.size === null || m.size > 256) failures.push(`frame ${f.frame}: ${l.id} holds ${m.slots?.length ?? 'no'} tiles of ${m.size ?? 'no size'} px, not six of 256 px or less`);
      }
      const dropped = droppedShadows(f, `the 32 lamps, frame ${f.frame}`);
      if (dropped.length) failures.push(`frame ${f.frame}: lights_over_budget reports ${dropped.length} shadows dropped, ${dropped.slice(0, 4).join(', ')} first`);
    }
    none(failures, `${ID}: the 32 lamps' tiles`);
  }, TIMEOUT);
});
