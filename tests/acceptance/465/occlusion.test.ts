// #465.c54ce6c3: "A point light of radius 0.05 m at the frame's centre, behind an opaque disc covering 0%, 50% and 100%
// of the light's projected disc, draws its ghosts, halo and streaks at 1, 0.5 and 0 of their unoccluded summed linear
// energy within 2%, seeking equal to playing. A planted flare that ignores occlusion fails at 100%, naming the light"
//
// The fixture (960 × 540, fov 40° across the width): a black room, the camera at z = 4 looking down −Z, the light
// `key-light` (radius 0.05 m, radiance 50) at the origin, so at the frame's centre, and an opaque black disc of radius
// 0.25 m (a plate whose outline is a 128-gon) facing the camera at z = 1, between them. The disc slides in x on a
// channel: at t = 0 its edge clears the light's projected disc by 20 px (0%), at t = 1 s it covers half (50%), at t = 2 s
// it is centred on the light (100%). The 50% offset is solved here by bisection on the covered share of the light's
// projected disc, sampled on a 401 × 401 grid through #378's pinhole. The flare: `ghosts: 4, halo: 0.05, streak: {count:
// 4, length: 0.25}`.
//
// "Summed linear energy" is the sum over the frame of the flare's own light: `pre_tone`'s Rec. 709 luminance with the
// flare less the same document's without it (the flare is drawn before tone mapping, so it is in `pre_tone`), at frames
// 0, 30 and 60 (30 fps); "unoccluded" is the same sum with no disc in the room. Each share must be 1, 0.5 and 0 within
// 0.02 of the unoccluded sum. Seek: frames 30 and 60 opened cold by `from` have the played frames' pixel hashes.
// Planted: `flare_ignores_occlusion` builds the flare as if nothing covered the light; its failure names the light and
// 100%. Wrong programs: a flare that ignores what covers its light, one that cuts off at any cover rather than fading
// by the covered share, one that dims only its ghosts.
import { describe, expect, it } from 'vitest';
import {
  AC, type Cam, DARK_SKY, type JsonObject, type Planted, camItem, channel, disc, discPx, energy, failsNaming, flare, focal, frameAt, framesOf,
  look3d, material, minus, none, pointLight, readLum, requireGpu, runGpu, sceneDoc, useGpu, useOut, view3d, writeJson,
} from './helpers.ts';

const bin = useGpu();
const out = useOut();
const SIZE: [number, number] = [960, 540];
const CAM: Cam = { position: [0, 0, 4], target: [0, 0, 0], fov: 40, size: SIZE };
const LOOK = look3d('occlusion-465');
const F = focal(CAM);
const LIGHT_PX = discPx(CAM, 4);
const DISC_R = 0.25; const DISC_DEPTH = 3; const DISC_PX = (F * DISC_R) / DISC_DEPTH;
const SIDES = 128;

/** The share of the light's projected disc (centred on the frame's centre) that the occluder, offset `ox` m in x, covers. */
function covered(ox: number): number {
  const cx = (F * ox) / DISC_DEPTH; const N = 401; let inDisc = 0; let inBoth = 0;
  const apothem = DISC_PX * Math.cos(Math.PI / SIDES); const step = (2 * Math.PI) / SIDES;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = ((i + 0.5) / N - 0.5) * 2 * LIGHT_PX; const y = ((j + 0.5) / N - 0.5) * 2 * LIGHT_PX;
    if (Math.hypot(x, y) > LIGHT_PX) continue;
    inDisc++;
    const rho = Math.hypot(x - cx, y); const phi = Math.atan2(y, x - cx);
    const within = ((phi % step) + step) % step - step / 2;
    if (rho * Math.cos(within) <= apothem) inBoth++;
  }
  return inBoth / inDisc;
}
const OX0 = ((DISC_PX + LIGHT_PX + 20) / F) * DISC_DEPTH;
const OX50 = ((): number => {
  let lo = 0; let hi = ((DISC_PX + LIGHT_PX) / F) * DISC_DEPTH;
  for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (covered(mid) > 0.5) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
})();
const COVERS: [number, number, number][] = [[0, 0, OX0], [50, 30, OX50], [100, 60, 0]];

function room(withFlare: boolean, withDisc: boolean): JsonObject {
  const items: Record<string, JsonObject> = { cam: camItem(CAM), sky: DARK_SKY, black: material({ base_color: [0, 0, 0, 1], roughness: 1 }), 'key-light': pointLight([0, 0, 0]) };
  if (withDisc) items['occluder'] = disc(DISC_R, [OX0, 0, 1], [90, 0, 0], 'black');
  if (withFlare) items['flare'] = flare({ ghosts: 4, halo: 0.05, streak: { count: 4, length: 0.25, anamorphic: false } });
  return sceneDoc(`occlusion-${withFlare ? 'flare' : 'plain'}-${withDisc ? 'disc' : 'open'}`, SIZE, items,
    withDisc ? { channels: { slide: channel('items/occluder/at/pos/0', [[0, OX0], [1, OX50], [2, 0]]) } } : {});
}

/** The flare's summed energy at 0%, 50% and 100% covered, as shares of its unoccluded energy; failures name the light. */
function occlusion(planted?: Planted): { failures: string[]; hashes: Map<number, string> } {
  const dir = out();
  const [flareDoc, plainDoc, flareOpen, plainOpen] = [room(true, true), room(false, true), room(true, false), room(false, false)].map((d, k) => writeJson(dir, `room-${k}`, d));
  const film = (doc: string): JsonObject => view3d({ doc, look: LOOK, size: SIZE, frames: 61, fps: 30, capture: COVERS.map(([, n]) => n), targets: ['pre_tone'] });
  const still = (doc: string): JsonObject => view3d({ doc, look: LOOK, size: SIZE, frames: 1, capture: [0], targets: ['pre_tone'] });
  const [withFlare, without, open, openPlain] = runGpu(bin(), dir, [film(flareDoc!), film(plainDoc!), still(flareOpen!), still(plainOpen!)], planted);
  const lum = (r: JsonObject, n: number, what: string) => readLum(dir, frameAt(framesOf(r, what), n, what), 'pre_tone', SIZE, `${what}, frame ${n}`);
  const unoccluded = energy(minus(lum(open!, 0, 'the open room with the flare'), lum(openPlain!, 0, 'the open room without it')));
  const failures: string[] = [];
  if (!(unoccluded > 0)) return { failures: [`light key-light: the unoccluded flare draws no light (${unoccluded})`], hashes: new Map() };
  for (const [share, n] of COVERS) {
    const e = energy(minus(lum(withFlare!, n, 'the room with the flare'), lum(without!, n, 'the room without it'))) / unoccluded;
    const want = 1 - share / 100;
    console.log(`${AC[5]}${planted ? ` (${planted})` : ''}: covered ${share}% (frame ${n}, ${(covered(COVERS.find((c) => c[0] === share)![2]) * 100).toFixed(2)}% by the grid): ${e.toFixed(4)} of the unoccluded energy`);
    if (Math.abs(e - want) > 0.02) failures.push(`light key-light: covered ${share}% (frame ${n}), its ghosts, halo and streaks draw ${e.toFixed(4)} of their unoccluded summed linear energy, not ${want} within 0.02`);
  }
  return { failures, hashes: new Map(framesOf(withFlare!, 'the room with the flare').map((f) => [f.frame, f.pixel_hash])) };
}

describe(`${AC[5]} a flare fades by the covered share of its light's disc`, () => {
  it(`${AC[5]} covered 0%, 50% and 100%, the flare draws 1, 0.5 and 0 of its unoccluded summed linear energy within 2%, and frames 30 and 60 seeked equal played`, () => {
    requireGpu();
    expect(covered(OX0), 'the 0% offset covers none of the light\'s disc').toBe(0);
    expect(covered(0), 'the 100% offset covers all of it').toBe(1);
    const { failures, hashes } = occlusion();
    none(failures, 'the flare by the covered share');
    const doc = writeJson(out(), 'seek', room(true, true));
    const seeks = runGpu(bin(), out(), [30, 60].map((n) => view3d({ doc, look: LOOK, size: SIZE, from: n, frames: 1, fps: 30 })));
    seeks.forEach((r, k) => {
      const n = [30, 60][k]!;
      expect(frameAt(framesOf(r, `the seek to ${n}`), n, 'seeked').pixel_hash, `frame ${n} seeked equals frame ${n} played`).toBe(hashes.get(n));
    });
  });

  it(`${AC[5]} a planted flare that ignores occlusion (--planted flare_ignores_occlusion) fails at 100%, naming the light`, () => {
    requireGpu();
    failsNaming(occlusion('flare_ignores_occlusion').failures, ['light key-light', 'covered 100%'], 'flare_ignores_occlusion');
  });
});
