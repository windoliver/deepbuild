// AC4 #423.4c6dcf97: In the Khronos sample TextureEncodingTest, fetched by hash on first use and never committed, the
// four models of each row (factors only, a 1 × 1 texture, the same texture with a gamma value, and with an ICC
// profile) render within one 8-bit code value of each other with tone map none; a planted importer that decodes the
// metallic-roughness map from sRGB, or one that applies the image's gamma, fails, naming the row and the column.
//
// The GLB is fetched by hash like AC2's samples and drawn as one scene item, orthographic from +Z at 80 px per m, so
// its twelve unit spheres (rows 3 m apart: base color, emission, metallic-roughness; columns 3 m apart: factors only,
// 1 × 1 texture, gamma, ICC profile) land 240 px apart exactly, under a sun at an angle, with tone map none. In the
// final target (8-bit sRGB), for every row and every pair of its columns, each pixel of a disc 8 px inside the left
// sphere equals the pixel 240 px per column to its right within one code on every channel; each disc shows its own
// sphere in the object-ID target. `--planted mr_from_srgb` (the metallic-roughness map decoded from sRGB) and
// `--planted applies_image_gamma` (the PNG's gAMA 0.2 applied) fail, naming the metallic-roughness row and the
// columns at fault, and for the gamma the gamma column and the base color row.
// Wrong programs: the base (no textures); either planted importer; one that reads ICC profiles; one that decodes base
// color or emission as linear (the texture columns then differ from the factors column).
import { describe, it } from 'vitest';
import {
  AC, PLAIN_LOOK, byHash, disc, failsNaming, frame0, khronos, none, nodePick, ortho, orthoProject, pixel, readIds, readPng, requireMetal, runGpu, sceneAsset,
  sessionDoc, sun, useDir, useGpu, view3dCall, worlds, writeJson,
  type Fetched, type Planted, type V3,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const SIZE: [number, number] = [960, 720];
const WIDTH = 12;
const ROWS = ['base color', 'emission', 'metallic-roughness'];
const COLUMNS = ['factors only', '1 × 1 texture', 'gamma', 'ICC profile'];

/** The encoding check: failures as sentences naming the row and the columns. */
function encodingProblems(out: string, f: Fetched, planted?: Planted): string[] {
  const w = worlds(f.gltf);
  // The twelve spheres: the nodes whose mesh is a sphere of radius 1, by row (top first) and column (left first).
  const spheres = [...w.entries()].filter(([i]) => {
    const n = (f.gltf.json['nodes'] as { mesh?: number; scale?: number[] }[])[i]!;
    return typeof n.mesh === 'number' && n.scale === undefined;
  }).map(([i, m]) => ({ i, at: [m[0][3], m[1][3], m[2][3]] as V3 }));
  const ys = [...new Set(spheres.map((s) => s.at[1]))].sort((a, b) => b - a);
  const xs = [...new Set(spheres.map((s) => s.at[0]))].sort((a, b) => a - b);
  if (spheres.length !== 12 || ys.length !== 3 || xs.length !== 4) return [`the file's spheres aren't three rows of four: ${spheres.length} at ${ys.length} heights and ${xs.length} columns`];
  const target: V3 = [(xs[0]! + xs[3]!) / 2, (ys[0]! + ys[2]!) / 2, 0];
  const doc = sessionDoc('texture-encoding', SIZE, { cam: ortho(target, WIDTH), sun: sun(2, [-25, 20, 0]), asset: sceneAsset(f.sha) });
  const { replies } = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, `encoding-${planted ?? 'shipped'}`, doc), look: PLAIN_LOOK, size: SIZE, targets: ['final', 'ids'], ...byHash(f) })], planted);
  const fr = frame0(replies[0]!, 'TextureEncodingTest');
  const final = readPng(out, fr.final, 'TextureEncodingTest: final');
  const ids = readIds(out, fr, 'TextureEncodingTest: ids');
  const k = SIZE[0] / WIDTH;
  const problems: string[] = [];
  for (const [r, y] of ys.entries()) {
    const row = xs.map((x) => spheres.find((s) => s.at[0] === x && s.at[1] === y)!);
    const centers = row.map((s) => orthoProject(target, WIDTH, SIZE, s.at));
    for (const [c, s] of row.entries()) {
      const px = disc(centers[c]![0], centers[c]![1], k - 8);
      const pick = nodePick(f.gltf, 'asset', s.i);
      const shows = px.filter(([x, yy]) => ids.at(x, yy) === pick).length;
      if (shows < 0.99 * px.length) problems.push(`${ROWS[r]} row, ${COLUMNS[c]} column: ${pick} shows on ${shows} of the ${px.length} px of its disc`);
    }
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      const dx = centers[b]![0] - centers[a]![0];
      if (Math.abs(dx - Math.round(dx)) > 1e-6 || centers[b]![1] !== centers[a]![1]) { problems.push(`the fixture's spheres aren't a whole number of px apart (${dx})`); continue; }
      let off = 0; let worst = 0;
      for (const [x, yy] of disc(centers[a]![0], centers[a]![1], k - 8)) {
        const [p, q] = [pixel(final, x, yy), pixel(final, x + Math.round(dx), yy)];
        const d = Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
        if (d > 1) off++;
        worst = Math.max(worst, d);
      }
      if (off > 0) problems.push(`${ROWS[r]} row: the ${COLUMNS[b]} column differs from the ${COLUMNS[a]} column on ${off} px, by up to ${worst} codes (over one)`);
    }
    const mid = (c: number): string => pixel(final, Math.floor(centers[c]![0]), Math.floor(centers[c]![1])).join(', ');
    console.log(`${AC[4]}${planted ? ` (planted ${planted})` : ''}: ${ROWS[r]} row, sphere centres: ${[0, 1, 2, 3].map(mid).join(' | ')}`);
  }
  return problems;
}

describe(`${AC[4]} TextureEncodingTest's rows render alike; the planted importers fail naming the row and the column`, () => {
  it(`${AC[4]} each row's four spheres render within one code of each other with tone map none; mr_from_srgb and applies_image_gamma fail, naming the row and the column`, async () => {
    requireMetal();
    const out = dir();
    const f = await khronos('TextureEncodingTest', out);
    none(encodingProblems(out, f), 'TextureEncodingTest');
    failsNaming(encodingProblems(out, f, 'mr_from_srgb'), ['metallic-roughness row', '1 × 1 texture column'], 'the planted mr_from_srgb');
    failsNaming(encodingProblems(out, f, 'applies_image_gamma'), ['metallic-roughness row', 'base color row', 'gamma column'], 'the planted applies_image_gamma');
  }, 1_800_000);
});
