// #429.2c1db06d: seeking a figure with a composed operator equals playing it, on the same machine's pixel hash.
//
// The figure (helpers.ts: figure) with a composed pass, `grain`, that scales the frame by 1 + sin(t) × rand(hash
// of the pixel and the item's seed), so every frame differs and each pixel's grain is its own. Through #378's
// `view3d` with #380's `from` (a seek: the session opens at frame `from` with nothing drawn before it), at 60 fps:
// frame 90 played from 0 and sought in a fresh process have one pixel hash, two plays agree, and frame 30 differs
// from frame 90 (so the hash sees the operator move). At the base no document item can be a GPU operator.
import { describe, expect, it } from 'vitest';
import { LOOK, asItem, figure, frameOf, pass, requireGpu, run1, useBins, useOut, view3dFrames, writeJson } from './helpers.ts';

const bins = useBins();
const out = useOut();
const SIZE: [number, number] = [128, 64];

const GRAIN = pass('grain', {
  uv: { op: 'screen_uv@1', args: {} },
  c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } },
  tt: { op: 't@1', args: {} },
  px: { op: 'pixel@1', args: {} },
  pxx: { op: 'split@1', args: { x: 'px', pick: 'x' } },
  pxy: { op: 'split@1', args: { x: 'px', pick: 'y' } },
  s: { op: 'seed@1', args: {} },
  h: { op: 'hash@1', args: { a: 'pxx', b: 'pxy', c: 's' } },
  r: { op: 'rand@1', args: { key: 'h' } },
  wv: { op: 'sin@1', args: { x: 'tt' } },
  k: { op: 'mul@1', args: { a: 'r', b: 'wv' } },
  g: { op: 'add@1', args: { a: 'k', b: 1 } },
  out: { op: 'mul@1', args: { a: 'c', b: 'g' } },
});

function hashes(doc: string, from: number, frames: number, want: number[], what: string): Map<number, string> {
  const f = view3dFrames(run1(bins.bin(), out(), { call: 'view3d', doc, look: LOOK, size: SIZE, fps: 60, from, frames }), what);
  return new Map(want.map((n) => {
    const h = frameOf(f, n, what).pixel_hash;
    expect(h, `${what}: frame ${n} has a pixel hash`).not.toBeNull();
    return [n, h!];
  }));
}

describe('#429.2c1db06d seeking a figure with a composed operator equals playing it', () => {
  it('#429.2c1db06d frame 90 sought equals frame 90 played, two plays agree, and frame 30 differs from 90', () => {
    requireGpu();
    const doc = writeJson(out(), 'seek.json', figure('seek-429', { grain: asItem(GRAIN) }));
    const played = hashes(doc, 0, 91, [30, 90], 'played');
    const again = hashes(doc, 0, 91, [90], 'played again');
    const sought = hashes(doc, 90, 1, [90], 'sought to 90');
    expect(played.get(30), 'the operator moves the frame between 30 and 90').not.toBe(played.get(90));
    expect(again.get(90), 'two plays agree at 90').toBe(played.get(90));
    expect(sought.get(90), 'the seek to 90 equals the play to 90').toBe(played.get(90));
  }, 1_800_000);
});
