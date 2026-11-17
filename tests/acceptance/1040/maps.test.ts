// AC6 #1040.a023b5eb: "A piece with four 2,048 px KTX2 maps, which fit the 64 MB decoded-image cap only in block bytes
// (about 22.4 MB, against about 89.5 MB decoded), exports with texture-compression-bc and texture-compression-astc as
// one `any_of` entry in its receipt's gpu_needs. In headless Chrome on the reference Mac with WebGPU on, the player
// transcodes them to BC7 and BC5 with both features granted and to ASTC 4×4 with only ASTC granted by a test shim over
// the adapter, and runs the piece live either way; with neither granted, the index page opens the fallback page and
// never starts the player. A piece whose maps fit decoded lists neither and plays with both withheld, its maps decoded
// to RGBA8. A planted index page that requires both features opens the fallback page with only ASTC granted and fails,
// naming the feature"
//
// The pieces (helpers.ts `mapsDoc`): a slab under a material of four UASTC KTX2 maps with full mip chains (base color
// and emission sRGB, metallic-roughness and a normal map linear), 2,048 px, and the same at 1,024 px (about 22.4 MB
// decoded). Which format the player chose is read from the WebGPU textures its device creates (README: chosen): a map's
// texture is one made at the map's size with more than one mip level. asserts, on a reference Mac:
//   - the 2,048 px piece's gpu_needs holds [texture-compression-bc, texture-compression-astc] as one any_of entry, and
//     neither feature as a required one;
//   - both granted: its map textures are three BC7 and one BC5 (the normal map), and the player runs the piece live
//     (ready, on WebGPU, played to `ended`, each device request equal to gpu_needs);
//   - only ASTC granted: its four map textures are ASTC 4×4, and the player runs it live;
//   - neither granted: the index page opens the fallback page in its start state and never starts the player;
//   - the 1,024 px piece's gpu_needs names neither feature; with both withheld its four map textures are RGBA8 and the
//     player runs it live;
//   - the planted `web_index_requires_every_any_of` (each any_of set required whole) with only ASTC granted opens the
//     fallback page, and the live judgement fails it, naming texture-compression-bc.
// Wrong programs: the merge base (gpu_needs empty; no transcoding in the player; no fallback page); the planted page.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, TIMEOUT, closeBundle, exportWeb, failsNaming, fallbackFailures, fallbackOf, formatFailures, liveFailures, mapsDoc, needsReal, none, onReferenceMac,
  openBundle, shimOf, show, useBrowsers, useShow, useTemp, webReceipt, type GpuNeeds, type Opened, type Texture,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
const BC = 'texture-compression-bc';
const ASTC = 'texture-compression-astc';
const PLANTED = 'web_index_requires_every_any_of';
const mentionsBlock = (needs: GpuNeeds): string[] => [...needs.features, ...needs.any_of.flat()].filter((x) => x === BC || x === ASTC);

/** The textures the player's device made, read once the live judgement is done. */
async function textures(o: Opened): Promise<Texture[]> {
  return (await o.tab.recorded()).textures;
}

describe(`${AC[6]} four 2,048 px KTX2 maps need BC or ASTC: BC7 and BC5, ASTC 4×4, or the fallback page; maps that fit decoded play as RGBA8`, () => {
  it(`${AC[6]} the 2,048 px maps export with [${BC}, ${ASTC}] as one any_of entry; the player transcodes them to BC7 and BC5 with both granted and to ASTC 4×4 with ASTC alone, live either way; with neither the index page opens the fallback page and never starts the player`, async () => {
    const evidence = temp();
    const out = join(temp(), 'bundle');
    const receipt = webReceipt(exportWeb(shows(FULL), evidence, mapsDoc(evidence, 2048), out, 'the four 2,048 px maps exported to the web'), 'the four 2,048 px maps exported to the web');
    const needs = receipt.gpu_needs;
    expect(needs.any_of.some((s) => [...s].sort().join() === [ASTC, BC].join()), `gpu_needs.any_of holds [${BC}, ${ASTC}] as one entry; gpu_needs reads ${show(receipt.raw['gpu_needs'] ?? null)}`).toBe(true);
    expect(needs.features.filter((x) => x === BC || x === ASTC), 'neither feature is required on its own').toEqual([]);
    const fb = fallbackOf(out, receipt, "the maps' bundle");
    await onReferenceMac();

    const both = browsers(await openBundle(out, { webgpu: true, shim: shimOf(needs, [BC, ASTC]) }));
    await needsReal(both.tab, [BC, ASTC]);
    const a = await liveFailures(both, receipt, fb, shimOf(needs, [BC, ASTC]).features, 'both granted');
    none([...a.failures, ...formatFailures(await textures(both), 2048, { bc7: 3, bc5: 1 }, 'both granted')], 'with both granted, the maps are BC7 and BC5 and the piece plays live');
    await closeBundle(both);

    const astc = browsers(await openBundle(out, { webgpu: true, shim: shimOf(needs, [ASTC], [BC]) }));
    const b = await liveFailures(astc, receipt, fb, shimOf(needs, [ASTC], [BC]).features, 'only ASTC granted');
    none([...b.failures, ...formatFailures(await textures(astc), 2048, { 'astc-4x4': 4 }, 'only ASTC granted')], 'with only ASTC granted, the maps are ASTC 4×4 and the piece plays live');
    await closeBundle(astc);

    const neither = browsers(await openBundle(out, { webgpu: true, shim: shimOf(needs, [], [BC, ASTC]) }));
    none(await fallbackFailures(neither, receipt, fb, `neither ${BC} nor ${ASTC} granted`, 'the maps'), 'with neither granted, the index page opens the fallback page and never starts the player');
    await closeBundle(neither);
  }, TIMEOUT);

  it(`${AC[6]} four 1,024 px maps fit the decoded-image cap: gpu_needs names neither feature, and with both withheld the player decodes them to RGBA8 and plays live`, async () => {
    const evidence = temp();
    const out = join(temp(), 'bundle');
    const receipt = webReceipt(exportWeb(shows(FULL), evidence, mapsDoc(evidence, 1024), out, 'the four 1,024 px maps exported to the web'), 'the four 1,024 px maps exported to the web');
    expect(mentionsBlock(receipt.gpu_needs), `maps that fit decoded need neither block format; gpu_needs reads ${show(receipt.raw['gpu_needs'] ?? null)}`).toEqual([]);
    const fb = fallbackOf(out, receipt, "the small maps' bundle");
    await onReferenceMac();
    const shim = shimOf(receipt.gpu_needs, [], [BC, ASTC]);
    const o = browsers(await openBundle(out, { webgpu: true, shim }));
    const live = await liveFailures(o, receipt, fb, shim.features, 'both withheld');
    none([...live.failures, ...formatFailures(await textures(o), 1024, { rgba8: 4 }, 'both withheld')], 'with both withheld, the maps are RGBA8 and the piece plays live');
    await closeBundle(o);
  }, TIMEOUT);

  it(`${AC[6]} the planted ${PLANTED}, which requires both features, opens the fallback page with only ASTC granted and fails, naming ${BC}`, async () => {
    const evidence = temp();
    const out = join(temp(), 'bundle');
    const receipt = webReceipt(exportWeb(shows(FULL), evidence, mapsDoc(evidence, 2048), out, `the 2,048 px maps (planted ${PLANTED})`, { planted: PLANTED }), `the 2,048 px maps (planted ${PLANTED})`);
    const fb = fallbackOf(out, receipt, `the planted ${PLANTED}'s bundle`);
    await onReferenceMac();
    const shim = shimOf(receipt.gpu_needs, [ASTC], [BC]);
    const o = browsers(await openBundle(out, { webgpu: true, shim }));
    await needsReal(o.tab, [ASTC]);
    failsNaming((await liveFailures(o, receipt, fb, shim.features, `the planted ${PLANTED}, only ASTC granted`)).failures, BC, `the planted ${PLANTED}`);
    await closeBundle(o);
  }, TIMEOUT);
});
