// Ambient occlusion (Look `look@1`: ao), three criteria, each drawn by #378's `view3d` call with the look's `ao` on
// (every field at the issue's default) or `none`, and read back from the linear target (before exposure and the
// tone map) and the object-ID target.
//
// #418.4d39a1c0 With ambient occlusion on, a card lit only by a direct light keeps its radiance within 0.5% of the
// same frame with it off, while an ambient-lit corner darkens.
// #418.fdc46ec6 Alpha-blended, masked-sprite and zero-opacity items write no ambient-occlusion depth: an invisible
// glow sprite in front of a wall leaves the wall's ambient light within 0.5% of the same frame without the sprite.
// #418.9a0b4a91 A still frame with ambient occlusion is the same however it was reached, on the same machine's
// pixel hash.
//
// At the base the look has no `ao`, scene3d has no `sky@1` or `material@1` and its shading adds a fixed ambient
// quarter under a sun, so every document here is refused or draws without occlusion.
import { describe, expect, it } from 'vitest';
import {
  AO, answered, frameAt, look, luma, readIds, readTarget, requireGpu, room, run, texel, useGpuBin, useOut, wall, writeJson,
  type F32, type Ids, type JsonObject, type Rgb, type Sprite,
} from './helpers.ts';

const gpu = useGpuBin();
const out = useOut();

const ROOM: [number, number] = [640, 480];
const WALL: [number, number] = [480, 360];
const ROLES: Record<string, Rgb> = { floor: [150, 150, 150], wall: [176, 176, 176], card: [210, 200, 190] };
const lookWith = (ao: JsonObject | 'none'): JsonObject => look('ao-418', ROLES, { ao });
const view = (doc: string, ao: JsonObject | 'none', size: [number, number], extra: JsonObject = {}): JsonObject =>
  ({ call: 'view3d', doc, look: lookWith(ao), size, targets: ['linear', 'ids'], capture: [0], ...extra });

/** Pixels (of the items listed, by `ids`) whose linear radiance in `b` is off `a` by more than 0.5% in any channel, at most 5 listed. */
function drift(a: F32, b: F32, ids: Ids, items: string[], also?: Ids): { checked: number; off: number; listed: string[] } {
  let checked = 0; let off = 0; const listed: string[] = [];
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
    const id = ids.at(x, y);
    if (id === null || !items.includes(id) || (also && also.at(x, y) !== id)) continue;
    checked++;
    const p = texel(a, x, y); const q = texel(b, x, y);
    const bad = [0, 1, 2].find((c) => Math.abs(q[c]! - p[c]!) > 0.005 * Math.abs(p[c]!) + 1e-6);
    if (bad !== undefined) { off++; if (listed.length < 5) listed.push(`(${x}, ${y}) ${id}: [${p.map((v) => v.toFixed(5))}] → [${q.map((v) => v.toFixed(5))}]`); }
  }
  return { checked, off, listed };
}

describe('#418.4d39a1c0 ambient occlusion darkens ambient light only', () => {
  it('#418.4d39a1c0 with ambient occlusion on, the card lit only by the sun keeps its radiance within 0.5% (and so does the room around it), while the ambient-lit corner darkens', () => {
    requireGpu();
    const direct = writeJson(out(), 'room-direct.json', room('room-direct-418', 'direct'));
    const ambient = writeJson(out(), 'room-ambient.json', room('room-ambient-418', 'ambient'));
    const [dOff, dOn, aOff, aOn] = run(gpu.bin(), out(), [view(direct, 'none', ROOM), view(direct, AO, ROOM), view(ambient, 'none', ROOM), view(ambient, AO, ROOM)])
      .map((r, i) => answered(r, ['the direct room, ao none', 'the direct room, ao on', 'the ambient room, ao none', 'the ambient room, ao on'][i]!));

    // Direct light only: nothing may change.
    const fOff = frameAt(dOff!, 0, 'direct, ao none'); const fOn = frameAt(dOn!, 0, 'direct, ao on');
    const idsD = readIds(out(), fOff, 'direct, ao none');
    const linOff = readTarget(out(), fOff, 'linear', ROOM, 'direct, ao none');
    const linOn = readTarget(out(), fOn, 'linear', ROOM, 'direct, ao on');
    let cardLight = 0; let cardPixels = 0;
    for (let y = 0; y < ROOM[1]; y++) for (let x = 0; x < ROOM[0]; x++) if (idsD.at(x, y) === 'card') { cardPixels++; cardLight += luma(texel(linOff, x, y)); }
    expect(cardPixels, 'the card is in view (object-ID target)').toBeGreaterThan(2_000);
    expect(cardLight / cardPixels, 'the sun lights the card (its mean linear luminance with ao off)').toBeGreaterThan(0.02);
    const card = drift(linOff, linOn, idsD, ['card']);
    expect(card.off, `the card, lit only by the sun, keeps its radiance within 0.5% with ao on (${card.off} of ${card.checked} pixels off): ${card.listed.join('; ')}`).toBe(0);
    const rest = drift(linOff, linOn, idsD, ['floor', 'wall']);
    expect(rest.off, `the floor and wall, lit only by the sun, keep theirs too (${rest.off} of ${rest.checked} pixels off): ${rest.listed.join('; ')}`).toBe(0);

    // Ambient light only: the corner where the floor meets the wall darkens.
    const gOff = frameAt(aOff!, 0, 'ambient, ao none'); const gOn = frameAt(aOn!, 0, 'ambient, ao on');
    const idsA = readIds(out(), gOff, 'ambient, ao none');
    const ambOff = readTarget(out(), gOff, 'linear', ROOM, 'ambient, ao none');
    const ambOn = readTarget(out(), gOn, 'linear', ROOM, 'ambient, ao on');
    let n = 0; let before = 0; let after = 0;
    for (let y = 1; y < ROOM[1]; y++) for (let x = 0; x < ROOM[0]; x++) {
      if (idsA.at(x, y) !== 'floor') continue;
      // The seam: floor pixels within 4 px below a wall pixel in the same column.
      if (![1, 2, 3, 4].some((k) => idsA.at(x, y - k) === 'wall')) continue;
      n++; before += luma(texel(ambOff, x, y)); after += luma(texel(ambOn, x, y));
    }
    expect(n, 'the corner where the floor meets the wall is in view').toBeGreaterThan(200);
    expect(before / n, 'the ambient light reaches the corner with ao off').toBeGreaterThan(0.01);
    expect(after / before, `the ambient-lit corner darkens with ao on: mean linear luminance ${(before / n).toFixed(5)} → ${(after / n).toFixed(5)}`).toBeLessThanOrEqual(0.95);
  }, 1_800_000);
});

describe('#418.fdc46ec6 see-through items write no ambient-occlusion depth', () => {
  it('#418.fdc46ec6 an invisible alpha-blended, masked or zero-opacity sprite 0.15 m in front of a wall leaves the wall\'s ambient light within 0.5% of the frame without it, where an opaque card darkens it', () => {
    requireGpu();
    const sprites: Sprite[] = ['none', 'blend', 'mask', 'zero', 'opaque'];
    const docs = sprites.map((s) => writeJson(out(), `wall-${s}.json`, wall(`wall-${s}-418`, s)));
    const replies = run(gpu.bin(), out(), docs.map((d) => view(d, AO, WALL))).map((r, i) => answered(r, `the wall with the ${sprites[i]} sprite`));
    const frames = replies.map((r, i) => frameAt(r, 0, `the wall with the ${sprites[i]} sprite`));
    const bare = frames[0]!;
    const ids = readIds(out(), bare, 'the wall alone');
    const lin = readTarget(out(), bare, 'linear', WALL, 'the wall alone');
    for (const [i, s] of sprites.entries()) {
      if (s === 'none' || s === 'opaque') continue;
      const d = drift(lin, readTarget(out(), frames[i]!, 'linear', WALL, `the ${s} sprite`), ids, ['wall']);
      expect(d.checked, 'the wall fills most of the frame').toBeGreaterThan(50_000);
      expect(d.off, `with the ${s} sprite, the wall's ambient light stays within 0.5% of the frame without it (${d.off} of ${d.checked} pixels off): ${d.listed.join('; ')}`).toBe(0);
    }
    // The twin that writes depth: an opaque card darkens the wall it doesn't hide, so the check can fail.
    const opaque = frames[4]!;
    const twin = drift(lin, readTarget(out(), opaque, 'linear', WALL, 'the opaque card'), ids, ['wall'], readIds(out(), opaque, 'the opaque card'));
    expect(twin.off, `an opaque card in the sprite's place darkens the wall around it beyond 0.5% (${twin.off} of ${twin.checked} visible wall pixels), so this check sees occlusion depth`).toBeGreaterThan(50);
  }, 1_800_000);
});

describe('#418.9a0b4a91 a still frame with ambient occlusion is the same however it was reached', () => {
  it('#418.9a0b4a91 frame 90 of the room, still since frame 60, has one pixel hash whether seeked to, played from frame 0 through the camera\'s turn, or played from frame 30', () => {
    requireGpu();
    const doc = writeJson(out(), 'room-still.json', room('room-still-418', 'both', true));
    const call = (from: number, frames: number, ao: JsonObject | 'none' = AO): JsonObject => ({ call: 'view3d', doc, look: lookWith(ao), size: ROOM, fps: 60, from, frames });
    const [seek, play, mid, plain] = run(gpu.bin(), out(), [call(90, 1), call(0, 91), call(30, 61), call(90, 1, 'none')])
      .map((r, i) => answered(r, ['seeked to frame 90', 'played from frame 0', 'played from frame 30', 'seeked, ao none'][i]!));
    const still = frameAt(seek!, 90, 'seeked to frame 90').pixel_hash;
    expect(frameAt(play!, 90, 'played from frame 0').pixel_hash, 'played from frame 0 through the turn, frame 90 has the seeked frame\'s pixel hash').toBe(still);
    expect(frameAt(mid!, 90, 'played from frame 30').pixel_hash, 'played from frame 30, frame 90 has the seeked frame\'s pixel hash').toBe(still);
    expect(frameAt(play!, 30, 'played from frame 0').pixel_hash, 'the camera was turning before it stopped (frame 30 differs from frame 90)').not.toBe(still);
    expect(frameAt(plain!, 90, 'seeked, ao none').pixel_hash, 'ambient occlusion draws in this frame (it differs from the same frame with ao none)').not.toBe(still);
  }, 1_800_000);
});
