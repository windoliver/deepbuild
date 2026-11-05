// AC6 #423.0f7c0f26: On the reference Mac, a fixture asset's four 2,048 px KTX2 maps in UASTC (base color, normal,
// ORM and emission) transcode once in the decode worker to BC7 in sRGB, BC5, linear BC7 and BC7 in sRGB, as the
// receipt names them, and the decoded-image cap counts them at about 22.4 MB (2,048² × 1 B × 1.33 each), where the
// same maps as PNG count about 89.5 MB and are over the cap; a second load of the same hashes transcodes nothing. A
// flat KTX2 normal map (every texel 128, 128, 255) on a plane whose tangent runs along +x, lit by a sun 45° from its
// normal toward +x, shades as the plane does with no normal map within 1%, while a planted twin transcoded as sRGB
// color reads x and y as −0.57, drops n·l from 0.71 to under 0.25 and fails, naming the map.
//
// The maps are written here (helpers: ktx2Uastc; no KTX2 encoder is available offline): each a 2,048 px square of
// one color in UASTC's solid-color blocks, the full mip chain, base color and emission tagged sRGB, normal and ORM
// linear. The fixture asset is a `material@1` naming them by hash: `maps.base_color`, `maps.metallic_roughness` and
// `maps.occlusion` (the one ORM map), `maps.emission` and `normal_map` (Material: texture maps), on a panel.
// Receipt: `view3d` with `receipt: true` names each map's source (ktx2) and format, in WebGPU's names:
// bc7-rgba-unorm-srgb, bc5-rg-unorm, bc7-rgba-unorm, bc7-rgba-unorm-srgb; its `decoded_bytes` is within 1% of
// 4 × 2,048² × 1 B × 4/3 (22.37 MB) and under the 64 MiB cap. A second document naming the same hashes, drawn in the
// same run, transcodes nothing: its receipt marks every map untranscoded, and `workers` lists one decode worker, a
// process other than deep-gpu, with exactly one `transcode` job per map hash. The same maps as 2,048 px PNGs are
// refused `over_budget`, the refusal counting within 1% of 4 × 2,048² × 4 B × 4/3 (89.48 MB), over 64 MiB.
// Normal map: a white diffuse wall (specular level 0) facing +z, uv0 planar about z so its tangent (u) runs along +x,
// under a 100 lx sun 45° from its normal toward +x; n·l = π × (lit − unlit linear luminance) ÷ 100 over a 5 × 5
// patch at the frame's centre: 0.707 within 1% bare, and the flat map's within 1% of the bare wall's.
// `--planted normal_map_as_srgb` reads under 0.25 and fails, naming the map.
// Wrong programs: the base (no maps, no decode worker transcodes, no receipt); a transcode by the file's tag or to
// RGBA8, which the cap then counts at 4 B a texel; a transcode per load; a normal map decoded as color (the planted).
import { describe, expect, it } from 'vitest';
import {
  AC, PANEL_CAM, PLAIN_LOOK, arr, assetMaps, assetMaterial, assetsOf, failsNaming, frame0, ktx2Uastc, lum, none, num, obj, panelDoc, project, readLinear,
  requireReferenceMac, runGpu, shown, str, useDir, useGpu, view3dCall, writeAsset, writeJson,
  type AssetMaps, type JsonObject, type Planted,
} from './helpers.ts';

const bin = useGpu();
const dir = useDir();
const CAM = PANEL_CAM;
const SIZE = CAM.size;
const MIB64 = 64 * 1024 * 1024;
const PX = 2048 * 2048;

interface Receipt { decoded: number; maps: JsonObject[] }
function receiptOf(reply: JsonObject, what: string): Receipt {
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const r = obj(reply['receipt'], `${what}: receipt`);
  return { decoded: num(r['decoded_bytes'], `${what}: receipt.decoded_bytes`), maps: arr(r['maps'], `${what}: receipt.maps`).map((m, i) => obj(m, `${what}: receipt.maps[${i}]`)) };
}

describe(`${AC[6]} KTX2 maps transcode once in the decode worker to the role's block format, within the decoded-image cap`, () => {
  it(`${AC[6]} four 2,048 px UASTC maps transcode once to BC7 sRGB, BC5, linear BC7 and BC7 sRGB, count about 22.4 MB where PNGs count 89.5 MB and are refused; a second load transcodes nothing`, () => {
    requireReferenceMac();
    const out = dir();
    const k = assetMaps(out, 'ktx2');
    const p = assetMaps(out, 'png');
    const assets = assetsOf(k, p);
    const call = (id: string, mat: string, m: AssetMaps): JsonObject =>
      view3dCall({ doc: writeJson(out, id, panelDoc(id, mat, assetMaterial(m), true)), look: PLAIN_LOOK, size: SIZE, targets: ['final'], assets, receipt: true });
    const { replies, pid } = runGpu(bin(), out, [call('ktx2-asset', 'kit', k), call('ktx2-again', 'kit2', k), { call: 'workers' }, call('png-asset', 'kit3', p)]);
    const problems: string[] = [];
    const want: [string, string, string][] = [[k.base.sha, 'base color', 'bc7-rgba-unorm-srgb'], [k.normal.sha, 'normal', 'bc5-rg-unorm'], [k.orm.sha, 'ORM', 'bc7-rgba-unorm'], [k.emission.sha, 'emission', 'bc7-rgba-unorm-srgb']];
    for (const [n, what] of [[0, 'the first load'], [1, 'the second load']] as const) {
      const r = receiptOf(replies[n]!, what);
      console.log(`${AC[6]}: ${what}: decoded_bytes ${r.decoded}; maps ${r.maps.map((m) => `${String(m['sha256']).slice(0, 8)} ${String(m['format'])} transcoded ${String(m['transcoded'])}`).join(', ')}`);
      if (r.maps.length !== 4) problems.push(`${what}: the receipt names ${r.maps.length} maps, not the 4 distinct hashes`);
      for (const [sha, role, format] of want) {
        const m = r.maps.find((x) => x['sha256'] === sha);
        if (!m) { problems.push(`${what}: the receipt doesn't name the ${role} map ${sha}`); continue; }
        if (m['source'] !== 'ktx2') problems.push(`${what}: the ${role} map's source is ${shown(m['source'])}, not ktx2`);
        if (m['format'] !== format) problems.push(`${what}: the ${role} map is ${shown(m['format'])}, not ${format}`);
        if (m['transcoded'] !== (n === 0)) problems.push(`${what}: the ${role} map is marked transcoded ${shown(m['transcoded'])}${n === 1 ? ': a second load of the same hash transcoded it again' : ''}`);
      }
      const about = 4 * PX * (4 / 3);
      if (Math.abs(r.decoded - about) > 0.01 * about) problems.push(`${what}: the decoded-image cap counts ${r.decoded} B, not about ${about.toFixed(0)} (22.4 MB)`);
      if (r.decoded > MIB64) problems.push(`${what}: ${r.decoded} B is over the 64 MiB cap`);
    }
    const workers = arr(obj(replies[2]!, 'workers')['workers'], 'workers').map((w, i) => obj(w, `workers[${i}]`));
    const decoders = workers.filter((w) => w['role'] === 'decode_worker');
    if (decoders.length !== 1) problems.push(`workers lists ${decoders.length} decode workers, not one: ${shown(workers as JsonObject[])}`);
    for (const d of decoders) {
      if (num(d['pid'], 'the decode worker\'s pid') === pid) problems.push('the decode worker is deep-gpu\'s own process');
      const jobs = arr(d['jobs'], 'the decode worker\'s jobs').map((j, i) => obj(j, `jobs[${i}]`)).filter((j) => j['op'] === 'transcode');
      for (const [sha, role] of want) {
        const n = jobs.filter((j) => str(j['file'], 'a transcode job\'s file') === sha).length;
        if (n !== 1) problems.push(`the ${role} map ${sha.slice(0, 8)} was transcoded ${n} times in the decode worker over two loads, not once`);
      }
      if (jobs.length !== 4) problems.push(`the decode worker ran ${jobs.length} transcode jobs over two loads of 4 maps, not 4`);
    }
    const png = replies[3]!;
    console.log(`${AC[6]}: the PNG asset: ${shown(png)}`);
    if (png['code'] !== 'over_budget') problems.push(`the same maps as PNG are ${png['code'] === undefined ? 'drawn' : `refused ${shown(png['code'])}`}, not refused over_budget`);
    else {
      const about = 4 * PX * 4 * (4 / 3);
      const counted = typeof png['decoded_bytes'] === 'number' ? png['decoded_bytes'] : NaN;
      if (!(Math.abs(counted - about) <= 0.01 * about)) problems.push(`the PNG refusal counts ${shown(png['decoded_bytes'])} B, not about ${about.toFixed(0)} (89.5 MB)`);
      if (!(counted > MIB64)) problems.push(`the PNG refusal's count ${shown(png['decoded_bytes'])} isn't over the 64 MiB cap`);
    }
    none(problems, 'the KTX2 asset');
  }, 1_800_000);

  it(`${AC[6]} a flat KTX2 normal map shades as the bare plane within 1%; the planted normal_map_as_srgb drops n·l under 0.25 and fails, naming the map`, () => {
    requireReferenceMac();
    const white = { base_color: [1, 1, 1, 1], metallic: 0, roughness: 1, specular_level: 0 };
    const MAP = 'items/bumped/params/normal_map';
    const shading = (out: string, planted?: Planted): { problems: string[]; nl: number } => {
      const n = writeAsset(out, 'flat-normal.ktx2', ktx2Uastc(64, [128, 128, 255, 255], 'linear'));
      const docs = [panelDoc('bare-lit', 'bare', white, true), panelDoc('bare-dark', 'bare', white, false), panelDoc('bumped-lit', 'bumped', { ...white, normal_map: n.sha }, true), panelDoc('bumped-dark', 'bumped', { ...white, normal_map: n.sha }, false)];
      const { replies } = runGpu(bin(), out, docs.map((d, i) => view3dCall({ doc: writeJson(out, `wall-${i}`, d), look: PLAIN_LOOK, size: SIZE, targets: ['linear'], assets: { [n.sha]: n.path } })), planted);
      const t = replies.map((r, i) => readLinear(out, frame0(r, `wall ${i}`), SIZE, `wall ${i}: linear`));
      const [cx, cy] = project(CAM, [0, 2, 0.01]).map(Math.floor) as [number, number];
      const nl = (lit: number, dark: number): number => {
        let s = 0;
        for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) s += (Math.PI * (lum(t[lit]!.at(x, y)) - lum(t[dark]!.at(x, y)))) / 100;
        return s / 25;
      };
      const [bare, bumped] = [nl(0, 1), nl(2, 3)];
      console.log(`${AC[6]}${planted ? ` (planted ${planted})` : ''}: n·l bare ${bare.toFixed(4)}, with the flat KTX2 normal map ${bumped.toFixed(4)}`);
      const problems: string[] = [];
      if (Math.abs(bare - Math.SQRT1_2) > 0.01 * Math.SQRT1_2) problems.push(`the bare wall reads n·l ${bare.toFixed(4)}, not 0.707 within 1%: the sun isn't 45° from its normal`);
      if (Math.abs(bumped - bare) > 0.01 * bare) problems.push(`${MAP}: the flat normal map shades at n·l ${bumped.toFixed(4)}, against the bare wall's ${bare.toFixed(4)}: off by over 1%`);
      return { problems, nl: bumped };
    };
    none(shading(dir()).problems, 'the flat KTX2 normal map');
    const planted = shading(dir(), 'normal_map_as_srgb');
    expect(planted.nl, 'the planted twin reads x and y as −0.57, so n·l falls under 0.25').toBeLessThan(0.25);
    failsNaming(planted.problems, [MAP], 'the planted normal_map_as_srgb');
  }, 1_800_000);
});
