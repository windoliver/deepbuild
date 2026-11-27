import { describe, expect, it } from 'vitest';
import { decodePng, pngOf, requireMetal, rows, runGpu, shown, useDir, useGpu, type JsonObject } from '../149/helpers.ts';
import { AC, SIZE_3D, assetsOf, otherToothPng, putPng, toothLook, toothPng, view3dOf } from './scene.ts';

const bin = useGpu();
const dir = useDir();

function drawn(reply: JsonObject | undefined, what: string): JsonObject {
  expect(reply, `${what}: a reply`).toBeDefined();
  expect(reply!['code'], `${what} is drawn, not refused; the reply: ${shown(reply)}`).toBeUndefined();
  return reply!;
}

describe(`${AC[1]} #149's image tooth under the drawn look in view3d`, () => {
  it(`${AC[1]} the gray PNG tooth named by hash in the call's assets is drawn on the one-box 3D scene, not refused`, () => {
    requireMetal();
    const out = dir();
    const tooth = putPng(out, 'tooth.png', toothPng());
    const [reply] = runGpu(bin(), out, [view3dOf(out, toothLook(tooth.hash), assetsOf(tooth))]);
    drawn(reply, 'the one-box scene on #149\'s gray PNG tooth');
    const frames = rows(reply!, 'the one-box scene on the tooth');
    expect(frames.map((f) => f.frame), 'the reply holds frame 0').toEqual([0]);
    const picture = decodePng(pngOf(out, frames[0]!, 'the one-box scene on the tooth'));
    expect([picture.width, picture.height], 'the captured frame is the scene\'s size').toEqual([...SIZE_3D]);
    console.log(`${AC[1]}: drawn, pixel hash ${frames[0]!.hash}`);
  });
});

describe(`${AC[2]} a different tooth image draws a different 3D frame`, () => {
  it(`${AC[2]} the same 3D scene with a different gray PNG as its tooth gives a different pixel hash`, () => {
    requireMetal();
    const out = dir();
    const tooth = putPng(out, 'tooth.png', toothPng());
    const other = putPng(out, 'other.png', otherToothPng());
    expect(other.hash, 'the two PNGs differ').not.toBe(tooth.hash);
    const assets = assetsOf(tooth, other);
    const replies = runGpu(bin(), out, [view3dOf(out, toothLook(tooth.hash), assets), view3dOf(out, toothLook(tooth.hash), assets), view3dOf(out, toothLook(other.hash), assets)]);
    const what = ['the scene on #149\'s tooth', 'the scene on #149\'s tooth again', 'the scene on the other gray PNG'];
    const hashes = replies.map((r, i) => {
      drawn(r, what[i]!);
      const frames = rows(r, what[i]!);
      expect(frames.length, `${what[i]!}: one frame`).toBe(1);
      return frames[0]!.hash;
    });
    console.log(`${AC[2]}: pixel hashes: tooth ${hashes[0]!}, tooth again ${hashes[1]!}, other ${hashes[2]!}`);
    expect(hashes[1], 'the same tooth draws the same pixel hash twice').toBe(hashes[0]);
    expect(hashes[2], 'a different gray PNG as the tooth gives a different pixel hash').not.toBe(hashes[0]);
  });
});

describe(`${AC[3]} a tooth image missing from assets is still refused in view3d`, () => {
  it(`${AC[3]} with the PNG missing from assets, view3d refuses asset_unreadable at ground/params/tooth/from`, () => {
    requireMetal();
    const out = dir();
    const tooth = toothPng();
    const other = putPng(out, 'other.png', otherToothPng());
    const hash = putPng(out, 'unlisted.png', tooth).hash;
    const [reply] = runGpu(bin(), out, [view3dOf(out, toothLook(hash), assetsOf(other))]);
    expect(reply, 'a reply').toBeDefined();
    console.log(`${AC[3]}: the reply: ${shown(reply)}`);
    expect(reply!['code'], `the scene is refused asset_unreadable; the reply: ${shown(reply)}`).toBe('asset_unreadable');
    expect(String(reply!['reason']), `the refusal names ground/params/tooth/from; the reply: ${shown(reply)}`).toContain('ground/params/tooth/from');
  });
});
