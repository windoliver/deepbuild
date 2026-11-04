// AC2 #423.5a4d9d3b: The Khronos sample models TextureTransformTest, TextureSettingsTest, TextureCoordinateTest,
// AlphaBlendModeTest and NegativeScaleTest, fetched by hash on first use and never committed, import with every
// texture, sampler, texCoord set, UV transform and alpha mode their files declare, and NegativeScaleTest's mirrored
// parts keep their front faces outward.
//
// Each model is fetched once from glTF-Sample-Assets at the pinned commit into the ignored cache, checked against its
// pinned SHA-256, and checked absent from HEAD's tree and the index by git blob ID (helpers: khronos). The product
// gets it by hash only: `view3d`'s `assets`, with a .gltf's relative URIs resolved by hash through `uris`.
// Import: one `mesh.asset@1` item draws each file's whole scene (`node: {scene: 0}`), and `imports: true` reports the
// materials the import made. For every material the file declares, each of glTF's five texture slots it uses is
// kept on its field (`maps.base_color`, `maps.metallic_roughness`, `maps.emission`, `maps.occlusion`, `normal_map`)
// with the image's own SHA-256, its texCoord set (`uv`), its KHR_texture_transform (offset, scale, rotation in
// degrees) and its sampler's wrap on S and T; its alpha mode, cutoff and double-sidedness are the file's; a texture
// inside an extension the maps can't hold is listed in `dropped`, never lost (Material: texture maps).
// Front faces: NegativeScaleTest drawn from +Z under a sun shining along −Z, orthographic, 80 px per m. In each row of
// spheres one sphere has a positive world determinant and one a negative (by its own scale, by its parent's, or
// both); each shows at its world place (99% of a disc 6 px inside it picks it), and the mirrored one shades as its
// unmirrored twin, pixel for pixel 160 px apart (mean within 5%, at most a tenth of pixels off by over 10%); the
// diffuse row is lit. The single-sided plane NegativeScaleFront (scale −1, −1, −1) and its positive twin
// PositiveScaleTest each cover at least 90% of their triangles' projected area, so neither is culled.
// Wrong programs: the base (a mesh.asset reads one node's positions, no scene, no textures); an import that drops a
// map, its texCoord, its transform, a wrap axis or the alpha mode; an import that ignores node scale or flips no
// winding, so a mirrored part draws inside out, is culled, or sits at the wrong place.
import { describe, it } from 'vitest';
import {
  AC, PLAIN_LOOK, byHash, det, disc, frame0, framing, importOf, importProblems, khronos, lum, none, nodeName, nodePick, nodeTriangles, ortho, orthoProject, readIds,
  readLinear, requireMetal, runGpu, sceneAsset, sessionDoc, sun, useDir, useGpu, view3dCall, worlds, writeJson,
  type SampleName, type V3,
} from './helpers.ts';

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
      const im = importOf(replies[i]!, 'asset', `${f.sample.name}'s import`);
      if (im.sha256 !== f.sha) problems.push(`${f.sample.name}: the import names ${im.sha256}, not the file's ${f.sha}`);
      const found = importProblems(f.gltf, im, f.sample.name);
      console.log(`${AC[2]}: ${f.sample.name}: ${im.materials.size} materials imported, ${found.length} problems`);
      problems.push(...found);
    }
    none(problems, 'the Khronos samples\' imports');
  }, 1_800_000);

  it(`${AC[2]} NegativeScaleTest: each mirrored sphere shows at its world place and shades as its unmirrored twin, and the mirrored single-sided plane isn't culled`, async () => {
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
    for (const name of ['NegativeScaleFront', 'PositiveScaleTest']) {
      const i = node(name);
      if (i < 0) { problems.push(`the file has no node ${name}`); continue; }
      const area = nodeTriangles(f.gltf, i, w.get(i)!).reduce((s, [p, q, r]) => s + Math.abs((q![0] - p![0]) * (r![1] - p![1]) - (r![0] - p![0]) * (q![1] - p![1])) / 2, 0) * k * k;
      const got = ids.count.get(nodePick(f.gltf, 'asset', i)) ?? 0;
      console.log(`${AC[2]}: ${name} (det ${det(w.get(i)!).toFixed(2)}): ${got} px of its ${area.toFixed(0)} px projected area`);
      if (got < 0.9 * area) problems.push(`${nodePick(f.gltf, 'asset', i)}: shows on ${got} px of its ${area.toFixed(0)} px projected area: culled, so its front faces aren't outward`);
    }
    none(problems, 'NegativeScaleTest\'s mirrored parts');
  }, 1_800_000);
});
