// AC7 #424.f29789a6: A view forced past `max_fragments` at the cap shows `fragments_capped` and never a hole.
//
// The fixture: twelve 30 m quads (a JSON glTF written here, as `mesh.asset@1` items), parallel and facing an
// orthographic camera 16 m across, 0.1 m apart, each unlit, alpha_mode blend at alpha 0.25 in its own color, with
// `resolve: per_pixel` and `max_fragments: 8388608` (the default, set explicitly), in a document of the figure class
// (256 MB of GPU per window), drawn at 1920 × 1080. Every pixel holds 12 fragments: 24,883,200 for the view, 398 MB at
// 16 B a fragment, past `max_fragments` and past what the class's GPU memory can give a redraw with more room, so the
// view must fall back to sorted (Object: see-through order). The frame's notices include `{code: "fragments_capped"}`,
// and every pixel equals the back-to-front composite of all twelve layers over the black sky within 2 codes (parallel
// layers sort correctly, so the fallback is exact): no hole, no dropped layer. Wrong programs: the base (no
// per-pixel resolve, no notice); a capped list that drops fragments past the cap (a hole or missing layers); a fallback
// with no notice.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, QUAD, codeOff, codes, framesOf, gltf, ortho, px, readPng, requireMetal, runGpu, sessionDoc, shown, unlit,
  useDir, useGpu, view3dCall, writeJson, type JsonObject, type Rgb,
} from './helpers.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [1920, 1080];
const N = 12;
const ALPHA = 0.25;
const color = (i: number): Rgb => [0.1 + 0.07 * i, 0.8 - 0.05 * i, 0.3 + 0.04 * i];

describe(`${AC[7]} a view forced past max_fragments at the cap`, () => {
  it(`${AC[7]} twelve full-frame per-pixel layers at 1080p report fragments_capped and draw every layer at every pixel`, () => {
    requireMetal();
    const out = dir();
    const g = gltf(QUAD);
    writeFileSync(join(out, `${g.sha}.gltf`), g.bytes);
    const items: Record<string, JsonObject> = { cam: ortho([0, 0, 0], 16), sky: DARK_SKY };
    for (let i = 0; i < N; i++) {
      items[`m${i}`] = unlit(color(i), 'blend', ALPHA);
      items[`layer${i}`] = { kind: 'mesh.asset@1', params: { sha256: g.sha, node: 0 }, at: { pos: [0, 0, -0.1 * i] }, material: `m${i}`, resolve: 'per_pixel', max_fragments: 8_388_608 };
    }
    const doc = sessionDoc('capped', SIZE, items, { budget: { class: 'figure' } });
    const [reply] = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, 'capped', doc), size: SIZE, targets: ['final'], assets: { [g.sha]: join(out, `${g.sha}.gltf`) } })]);
    const frames = framesOf(reply!, 'the capped view');
    const notices = frames.flatMap((f) => f.notices);
    expect(notices.some((n) => n['code'] === 'fragments_capped'), `the view reports fragments_capped: ${shown(notices)}`).toBe(true);
    const c: Rgb = [0, 0, 0];
    for (let i = N - 1; i >= 0; i--) for (let k = 0; k < 3; k++) c[k] = ALPHA * color(i)[k]! + (1 - ALPHA) * c[k]!;
    const want = codes(c);
    const img = readPng(out, frames[0]!.final, 'the capped view');
    let off = 0; let first = '';
    for (let y = 0; y < SIZE[1]; y++) for (let x = 0; x < SIZE[0]; x++) {
      if (codeOff(px(img, x, y), want) > 2) { off++; if (!first) first = `(${x}, ${y}) reads ${px(img, x, y).join(', ')}`; }
    }
    expect(off, `every pixel shows all ${N} layers (${want.join(', ')}) within 2 codes, never a hole: ${off} don't; first ${first}`).toBe(0);
  }, 1_800_000);
});
