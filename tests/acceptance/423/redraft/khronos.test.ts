// AC2 #423.5a4d9d3b: The Khronos sample models TextureTransformTest, TextureSettingsTest, TextureCoordinateTest,
// AlphaBlendModeTest and NegativeScaleTest, fetched by hash on first use and never committed, import with every
// texture, sampler, texCoord set, UV transform and alpha mode their files declare, and NegativeScaleTest's mirrored
// parts keep their front faces outward.
//
// Blind redraft of ../khronos.test.ts (redraft/README). Each model is fetched once from glTF-Sample-Assets at the
// pinned commit into the ignored cache, checked against its pinned SHA-256, and checked absent from HEAD's tree and the
// index by git blob ID (../helpers: khronos). The product gets it by hash only: `view3d`'s `assets`, with a .gltf's
// relative URIs resolved by hash through `uris`.
// Import: one `mesh.asset@1` item takes each file's whole scene (`node: {scene: 0}`), and `imports: true` reports the
// materials the import made. For every material the file declares, each of glTF's five texture slots it uses is kept
// on its field with the image's own SHA-256, its texCoord set, its KHR_texture_transform and its sampler's wrap on S
// and T; its alpha mode, cutoff and double-sidedness are the file's; a texture inside an extension the maps can't hold
// is listed in `dropped`. The import is read whether the document was drawn or refused `over_budget`: a PNG or JPEG
// map decodes to RGBA8 and counts w × h × 4 B × 1.33 within the 64 MB cap, so AlphaBlendModeTest (three 2,048² JPEGs
// and a 1,024² PNG, about 72.7 MB) is refused by the design, and its refusal still holds its import.
// Front faces: NegativeScaleTest drawn from +Z under a sun shining along −Z, orthographic, 80 px per m. The spheres
// are as the original: each mirrored sphere shows at its world place and shades as its unmirrored twin. The
// single-sided planes are held to the sample's README: front faces shown, back faces culled, so every cell of the
// "scale 1.0" and "scale -1.0" rows shows the check mark and none the red X. A CPU reference (redraft/helpers:
// planesReference) draws the planes' front-facing triangles, nearest first, with their map's texels; in each cell,
// 3 px in from its edges, the ID target picks the node the reference shows on 99% of pixels, the check's interior
// reads green on 80%, and at most 1% reads red where the reference shows no red.
// Wrong programs: the base; an import that drops a map, its texCoord, its transform, a wrap axis or the alpha mode;
// an import that ignores node scale or flips no winding, so a mirrored part draws inside out, its front face is
// culled or its back face drawn, or it sits at the wrong place; a single-sided back face drawn.
import { describe, it } from 'vitest';
import {
  AC, PLAIN_LOOK, byHash, det, disc, frame0, framing, importProblems, khronos, lum, none, nodeName, nodePick, ortho, orthoProject, readIds,
  readLinear, requireMetal, runGpu, sceneAsset, sessionDoc, sun, useDir, useGpu, view3dCall, worlds, writeJson,
  type SampleName, type V3,
} from '../helpers.ts';
import { hue, importDrawnOrOverCap, planesReference } from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const MODELS: SampleName[] = ['TextureTransformTest', 'TextureSettingsTest', 'TextureCoordinateTest', 'AlphaBlendModeTest', 'NegativeScaleTest'];

describe(`${AC[2]} the Khronos texture samples import with what their files declare; mirrored parts face out`, () => {
  it(`${AC[2]} the five models, fetched by hash and never committed, import every texture, sampler, texCoord set, UV transform and alpha mode their files declare`, async () => {
    requireMetal();
    const out = dir();
    const size: [number, number] = [640, 480];
    const fetched = await Promise.all(MODELS.map((name) => khronos(name, out)));
    const calls = fetched.map((f) => {
      const { target, viewWidth } = framing(f.gltf, size);
      const doc = sessionDoc(`import-${f.sample.name}`, size, { cam: ortho(target, viewWidth), sun: sun(3, [-20, 15, 0]), asset: sceneAsset(f.sha) });
      return view3dCall({ doc: writeJson(out, f.sample.name, doc), look: PLAIN_LOOK, size, imports: true, ...byHash(f) });
    });
    const { replies } = runGpu(bin(), out, calls);
    const problems: string[] = [];
    for (const [i, f] of fetched.entries()) {
      const im = importDrawnOrOverCap(replies[i]!, 'asset', `${f.sample.name}'s import`);
      if (im.sha256 !== f.sha) problems.push(`${f.sample.name}: the import names ${im.sha256}, not the file's ${f.sha}`);
      const found = importProblems(f.gltf, im, f.sample.name);
      console.log(`${AC[2]}: ${f.sample.name}: ${im.materials.size} materials imported, ${found.length} problems`);
      problems.push(...found);
    }
    none(problems, 'the Khronos samples\' imports');
  }, 1_800_000);

  it(`${AC[2]} NegativeScaleTest: each mirrored sphere shows at its world place and shades as its unmirrored twin, and the single-sided planes show their front faces and cull their back faces`, async () => {
    requireMetal();
    const out = dir();
    const f = await khronos('NegativeScaleTest', out);
    const size: [number, number] = [880, 720];
    const target: V3 = [0, 0, 0];
    const width = 11;
    const k = size[0] / width;
    const doc = sessionDoc('negative-scale', size, { cam: ortho(target, width), sun: sun(Math.PI, [0, 0, 0]), asset: sceneAsset(f.sha) });
    const { replies } = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, 'negative-scale', doc), look: PLAIN_LOOK, size, targets: ['linear', 'ids'], ...byHash(f) })]);
    const fr = frame0(replies[0]!, 'NegativeScaleTest');
    const ids = readIds(out, fr, 'NegativeScaleTest: ids');
    const lin = readLinear(out, fr, size, 'NegativeScaleTest: linear');
    const w = worlds(f.gltf);
    const node = (name: string): number => [...w.keys()].find((i) => nodeName(f.gltf, i) === name) ?? -1;
    const problems: string[] = [];
    for (const [a, b] of [['NotShiny1', 'NotShinyMinus1'], ['Shiny1', 'ShinyMinus1'], ['Dark1', 'DarkMinus1']] as const) {
      const [ia, ib] = [node(a), node(b)];
      if (ia < 0 || ib < 0) { problems.push(`the file has no node ${ia < 0 ? a : b}`); continue; }
      // Whichever of the two has the negative determinant is the mirrored one; its twin is the other.
      const [pos, neg] = det(w.get(ia)!) > 0 ? [ia, ib] : [ib, ia];
      if (det(w.get(neg)!) > 0) { problems.push(`${a} and ${b}: neither has a negative world determinant in the file`); continue; }
      const [cp, cn] = [orthoProject(target, width, size, [...w.get(pos)!.map((r) => r[3]!)]), orthoProject(target, width, size, [...w.get(neg)!.map((r) => r[3]!)])];
      const [dx, dy] = [Math.round(cn[0] - cp[0]), Math.round(cn[1] - cp[1])];
      const twin = disc(cp[0], cp[1], 0.5 * k - 6);
      const mirrored = disc(cn[0], cn[1], 0.5 * k - 6);
      const [pickP, pickN] = [nodePick(f.gltf, 'asset', pos), nodePick(f.gltf, 'asset', neg)];
      const shows = (px: [number, number][], pick: string): number => px.filter(([x, y]) => ids.at(x, y) === pick).length;
      if (shows(twin, pickP) < 0.99 * twin.length) problems.push(`${pickP}: shows on ${shows(twin, pickP)} of the ${twin.length} px at its world place`);
      if (shows(mirrored, pickN) < 0.99 * mirrored.length) problems.push(`${pickN} (mirrored): shows on ${shows(mirrored, pickN)} of the ${mirrored.length} px at its world place`);
      let off = 0; let sa = 0; let sb = 0;
      for (const [x, y] of twin) {
        const [la, lb] = [lum(lin.at(x, y)), lum(lin.at(x + dx, y + dy))];
        sa += la; sb += lb;
        if (Math.abs(la - lb) > 0.1 * Math.max(la, 0.01)) off++;
      }
      const [ma, mb] = [sa / twin.length, sb / twin.length];
      console.log(`${AC[2]}: ${pickN} (det ${det(w.get(neg)!).toFixed(2)}) against ${pickP}: mean linear ${mb.toFixed(4)} against ${ma.toFixed(4)}; ${off} of ${twin.length} px off by over 10%`);
      if (Math.abs(ma - mb) > 0.05 * ma + 1e-4) problems.push(`${pickN} (mirrored): mean linear luminance ${mb.toFixed(4)} against its twin's ${ma.toFixed(4)}: its front faces aren't outward`);
      if (off > 0.1 * twin.length) problems.push(`${pickN} (mirrored): ${off} of ${twin.length} px differ from its twin by over 10%: its front faces aren't outward`);
      if (a === 'NotShiny1' && ma < 0.1) problems.push(`${pickP}: mean linear luminance ${ma.toFixed(4)} under a sun of π lx on a diffuse 0.8: the spheres aren't lit, so the comparison shows nothing`);
    }
    // The single-sided planes (the sample's README): front faces shown, back faces culled, so every cell shows the
    // check. Rows and columns are named by the file's own labels.
    const planes = ['PositiveScaleTest', 'NegativeScaleFront', 'NegativeScaleBack'].map((name) => ({ name, i: node(name) }));
    for (const p of planes.filter((q) => q.i < 0)) problems.push(`the file has no node ${p.name}`);
    if (planes.every((q) => q.i >= 0)) {
      const ref = planesReference(f.gltf, w, planes.map((q) => q.i), target, width, size, ['scale 1.0', 'scale -1.0'], ['front', 'back', 'sample']);
      for (const cell of ref.cells) {
        const at = `NegativeScaleTest's ${cell.name}`;
        let n = 0; let picked = 0; let interior = 0; let green = 0; let red = 0; let refRed = 0;
        const shownNodes = new Set<string>();
        for (let y = Math.ceil(cell.y0 + 3); y < Math.floor(cell.y1 - 3); y++) for (let x = Math.ceil(cell.x0 + 3); x < Math.floor(cell.x1 - 3); x++) {
          const s = ref.at(x, y);
          if (!s) continue;
          n++;
          const want = nodePick(f.gltf, 'asset', s.node);
          shownNodes.add(want);
          if (ids.at(x, y) === want) picked++;
          const got = hue(lin.at(x, y), 0.02);
          if (s.texel === 'red') refRed++;
          else if (got === 'red') red++;
          if (s.texel === 'green' && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([ox, oy]) => ref.at(x + ox!, y + oy!)?.texel === 'green')) {
            interior++;
            if (got === 'green') green++;
          }
        }
        console.log(`${AC[2]}: ${at}: the reference shows ${[...shownNodes].join(', ')} on ${n} px (${interior} px inside the check, ${refRed} red); the frame picks it on ${picked}, reads green on ${green} of the check's ${interior}, red on ${red} more`);
        if (n === 0 || interior === 0) { problems.push(`${at}: the reference shows no check here, so the cell proves nothing`); continue; }
        if (picked < 0.99 * n) problems.push(`${at}: the frame picks ${[...shownNodes].join(', ')} on ${picked} of ${n} px: a front face is culled, a back face drawn, or the plane sits elsewhere, so its front faces aren't outward`);
        if (green < 0.8 * interior) problems.push(`${at}: the check reads green on ${green} of its ${interior} px: the front face isn't shown lit, so its front faces aren't outward`);
        if (red > 0.01 * n) problems.push(`${at}: ${red} of ${n} px read red where the reference shows no X: a back face is drawn or a front face culled, so its front faces aren't outward`);
      }
    }
    none(problems, 'NegativeScaleTest\'s mirrored parts');
  }, 1_800_000);
});
