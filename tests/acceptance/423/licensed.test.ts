// AC3 #423.57db7d87: A licensed glTF asset keeps its texture maps and UV transforms, each texture stored by hash with
// its license.
//
// The asset is Khronos's TextureTransformMultiTest (CC BY 4.0, ported from the oracle's pin for this criterion),
// fetched by hash on first use like AC2's samples: 29 materials whose base color, emission, normal,
// metallic-roughness and occlusion textures each carry a KHR_texture_transform (offset, a 90° rotation, scale 0.35),
// on TEXCOORD_0 and TEXCOORD_1, plus clearcoat textures the maps can't hold. `view3d` draws it as one scene item with
// `imports: true`, its license given beside its hash (`licenses`) and an evidence store (`store`). The import keeps
// every map with its image's hash, texCoord set, transform and wrap, and lists the clearcoat textures in `dropped`
// (the same check as AC2's, helpers: importProblems). Each texture a kept map names is in the store by hash
// (`<first 2 hex>/<other 62 hex>`, its bytes hashing to its name) and in the import's `textures` with the asset's
// license, field for field.
// Wrong programs: an import that drops a map, its TEXCOORD_1 or its transform (the base: no import at all); one that
// stores the textures without the license, or under another hash, or only the GLB.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  AC, PLAIN_LOOK, byHash, framing, imageBytes, importOf, importProblems, isObject, khronos, none, ortho, readMap, requireMetal, runGpu, sceneAsset, sessionDoc,
  sha256, shown, sun, useDir, useGpu, view3dCall, writeJson,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();

describe(`${AC[3]} a licensed glTF asset keeps its maps and UV transforms, each texture stored by hash with its license`, () => {
  it(`${AC[3]} TextureTransformMultiTest keeps every map and transform, on both UV sets, and each texture is in the store by hash with the asset's license`, async () => {
    requireMetal();
    const out = dir();
    const store = join(out, 'store');
    const f = await khronos('TextureTransformMultiTest', out);
    const size: [number, number] = [640, 480];
    const { target, viewWidth } = framing(f.gltf, size);
    const doc = sessionDoc('licensed-asset', size, { cam: ortho(target, viewWidth), sun: sun(3, [-20, 15, 0]), asset: sceneAsset(f.sha) });
    const { replies } = runGpu(bin(), out, [view3dCall({ doc: writeJson(out, 'licensed', doc), look: PLAIN_LOOK, size, imports: true, store, ...byHash(f) })]);
    const im = importOf(replies[0]!, 'asset', 'TextureTransformMultiTest\'s import');
    const problems = importProblems(f.gltf, im, 'TextureTransformMultiTest');
    // Every texture a kept map names: its hash, as the file's own image bytes hash.
    const kept = new Set<string>();
    for (const { params } of im.materials.values()) {
      for (const v of [...Object.values(isObject(params['maps']) ? params['maps'] : {}), params['normal_map']]) {
        const map = readMap(v, 'a kept map');
        if (map) kept.add(map.sha256);
      }
    }
    const images = new Set(((f.gltf.json['images'] as unknown[] | undefined) ?? []).map((_, i) => sha256(imageBytes(f.gltf, i))));
    for (const s of kept) if (!images.has(s)) problems.push(`a kept map names ${s}, which is none of the file's images`);
    if (kept.size === 0) problems.push('the import kept no texture');
    for (const s of kept) {
      const file = join(store, s.slice(0, 2), s.slice(2));
      if (!existsSync(file)) problems.push(`texture ${s}: not in the store at ${s.slice(0, 2)}/${s.slice(2)}`);
      else if (sha256(readFileSync(file)) !== s) problems.push(`texture ${s}: the stored file doesn't hash to its name`);
      const rec = im.textures.find((t) => t['sha256'] === s);
      if (!rec) problems.push(`texture ${s}: not in the import's textures`);
      else {
        const got = isObject(rec['license']) ? rec['license'] : {};
        const want = f.sample.license;
        if (got['id'] !== want.id || got['terms'] !== want.terms || got['shareable'] !== want.shareable || got['credit'] !== want.credit) {
          problems.push(`texture ${s}: stored with license ${shown(rec['license'])}, not the asset's ${JSON.stringify(want)}`);
        }
      }
    }
    console.log(`${AC[3]}: ${im.materials.size} materials, ${kept.size} textures kept, ${im.dropped.length} inputs listed as dropped`);
    none(problems, 'the licensed asset');
  }, 1_800_000);
});
