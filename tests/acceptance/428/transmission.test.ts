// AC3 #428.1870c341: Over a white backdrop, seen head-on with tone map none on linear targets, two slabs with
// transmission 1, ior 1.5 and attenuation {color [0.5, 0.8, 1], distance 2 cm}, 2 cm and 4 cm thick, show the 4 cm
// slab's pixels as [0.5, 0.8, 1] times the 2 cm slab's within 1%, the color raised to 2 cm ÷ 2 cm; panes of roughness
// 0, 0.3 and 0.6 over a black-to-white edge widen it in that order, the roughness 0 edge within 1 px of the edge with no
// pane and each within 2 code values of a CPU reference of the same mip blur; and with ior 1.5 and dispersion 1, a thin
// white line behind a slab tilted 30°, framed so that a CPU reference of the same model puts its red and blue lines at
// least 3 px apart, splits into red, green and blue at IORs 1.4875, 1.5 and 1.5125, each within 0.5 px of that
// reference, and into one line at dispersion 0. A planted model that ignores thickness shows the two slabs equal, one
// that ignores roughness keeps the three edges equal, and one that samples once keeps one white line, each failing and
// naming the material.
//
// Test 1, thickness and roughness. The slabs (`glass_2cm`, `glass_4cm`: boxes 30 cm square, 2 and 4 cm deep, their
// `absorption.thickness` the same) 1.5 m in front of the camera, over a white unlit backdrop 0.5 m behind them: each
// pixel 3 px inside the 4 cm slab, per channel, ÷ the 2 cm slab's mean = [0.5, 0.8, 1] within 1%. The panes
// (`frost_000`, `frost_030`, `frost_060`: 60 × 12 cm, 2 mm, thin walls, `absorption.thickness` 0) over an unlit backdrop
// black for x < 0 and white beyond, with a row of no pane above them: along each pane's centre rows, the 10–90% width of
// the edge grows from roughness 0 to 0.3 to 0.6; the roughness 0 edge's 50% crossing is within 1 px of the bare row's;
// and every pixel 3 px inside each pane is within 2 code values of the final target the CPU makes: the same document
// without the panes (the opaque copy, as drawn), its mip chain of 2 × 2 box averages read trilinearly at the pane's
// level log2(512) × roughness × clamp(2·ior − 2, 0, 1), scaled by the pane's own transmittance (its white side far
// from the edge ÷ the copy's there). `--planted absorption_ignores_thickness` fails naming `glass_4cm`;
// `--planted transmission_ignores_roughness` fails naming `frost_030` and `frost_060`.
// Test 2, dispersion. A 40 × 30 × 20 cm slab turned 30° about y (`prism`: transmission 1, ior 1.5, `absorption.thickness`
// 0.2) 1 m from the camera (fov 20° on 1024 × 256), a white unlit line 3 mm wide 0.6 m behind it on black: the CPU puts
// the red, green and blue lines (IORs 1.4875, 1.5, 1.5125) where each channel's transmitted point lands on the line,
// at least 3 px apart red to blue; each channel's centroid along the centre rows within 0.5 px of its own; with
// dispersion 0 (`prism_flat`) all three within 0.5 px of the IOR 1.5 line. `--planted dispersion_samples_once` fails
// naming `prism`.
// Wrong programs: the base (no transmission); attenuation by a fixed path; a blur that ignores roughness or picks
// another mip; dispersion that samples once, or splits by another spread.
import { describe, expect, it } from 'vitest';
import {
  AC, DARK_SKY, PLAIN_LOOK, box, camera, failsNaming, frameAt, framesOf, inside, none, px, readIds, readLinear, readPng, requireMetal, runGpu,
  sessionDoc, unlit, useDir, useGpu, view3dCall, writeJson, type GpuPlanted, type JsonObject,
} from './helpers.ts';
import { channelIors, code, lineColumn, mips, project, transmissionLod, trilinear, type Pinhole, type Plane, type TiltedSlab } from './reference.ts';

const ID = AC[3];
const bin = useGpu();
const dir = useDir();

const SLAB_CAM: Pinhole = { position: [0, 0, 1.5], target: [0, 0, 0], fov: 30, size: [480, 320] };
const PANE_CAM: Pinhole = { position: [0, 0, 1.5], target: [0, 0, 0], fov: 40, size: [512, 512] };
const LINE_CAM: Pinhole = { position: [0, 0, 1], target: [0, 0, 0], fov: 20, size: [1024, 256] };
const PANES = [{ id: 'frost_000', r: 0, y: 0.15 }, { id: 'frost_030', r: 0.3, y: 0 }, { id: 'frost_060', r: 0.6, y: -0.15 }];
const BARE_Y = 0.3;
const glass = (extra: JsonObject): JsonObject => ({ kind: 'material@1', params: { base_color: [1, 1, 1, 1], metallic: 0, roughness: 0, transmission: 1, ior: 1.5, ...extra } });

function slabsDoc(): JsonObject {
  return sessionDoc('slabs-428', SLAB_CAM.size, {
    cam: camera(SLAB_CAM.position, SLAB_CAM.target, SLAB_CAM.fov), sky: DARK_SKY, white: unlit([1, 1, 1]), backdrop: box([4, 4, 0.01], [0, 0, -0.505], 'white'),
    glass_2cm: glass({ absorption: { thickness: 0.02, attenuation: { color: [0.5, 0.8, 1], distance: 0.02 } } }),
    glass_4cm: glass({ absorption: { thickness: 0.04, attenuation: { color: [0.5, 0.8, 1], distance: 0.02 } } }),
    slab_2cm: box([0.3, 0.3, 0.02], [-0.2, 0, 0.01], 'glass_2cm'), slab_4cm: box([0.3, 0.3, 0.04], [0.2, 0, 0.02], 'glass_4cm'),
  });
}
function panesDoc(withPanes: boolean): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: camera(PANE_CAM.position, PANE_CAM.target, PANE_CAM.fov), sky: DARK_SKY, black: unlit([0, 0, 0]), white: unlit([1, 1, 1]),
    left: box([2, 4, 0.01], [-1, 0, -0.505], 'black'), right: box([2, 4, 0.01], [1, 0, -0.505], 'white'),
  };
  if (withPanes) for (const p of PANES) { items[p.id] = glass({ roughness: p.r, absorption: { thickness: 0 } }); items[`pane_${p.id}`] = box([0.6, 0.12, 0.002], [0, p.y, 0], p.id); }
  return sessionDoc(withPanes ? 'panes-428' : 'panes-bare-428', PANE_CAM.size, items);
}
function lineDoc(dispersion: number): JsonObject {
  const id = dispersion > 0 ? 'prism' : 'prism_flat';
  return sessionDoc(`line-${id}`, LINE_CAM.size, {
    cam: camera(LINE_CAM.position, LINE_CAM.target, LINE_CAM.fov), sky: DARK_SKY, black: unlit([0, 0, 0]), white: unlit([1, 1, 1]),
    back: box([4, 4, 0.01], [0, 0, -0.605], 'black'), line: box([0.003, 1, 0.001], [0, 0, -0.5995], 'white'),
    [id]: glass({ dispersion, absorption: { thickness: 0.2 } }), slab: box([0.4, 0.3, 0.2], [0, 0, 0], id, [0, 30, 0]),
  });
}

/** The edge along a pane's centre rows: its 50% crossing and its 10–90% width, from the linear target's luminance. */
function edgeOf(lin: ReturnType<typeof readLinear>, cy: number, xs: [number, number]): { mid: number; width: number } {
  const prof: number[] = [];
  for (let x = xs[0]; x < xs[1]; x++) { let s = 0; for (let y = cy - 2; y <= cy + 2; y++) s += lin.at(x, y)[1]; prof.push(s / 5); }
  const white = prof.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const cross = (f: number): number => { for (let i = 1; i < prof.length; i++) if (prof[i - 1]! < f * white && prof[i]! >= f * white) return xs[0] + i - 0.5 + (f * white - prof[i - 1]!) / (prof[i]! - prof[i - 1]!); return NaN; };
  return { mid: cross(0.5), width: cross(0.9) - cross(0.1) };
}
function thicknessAndRoughness(planted?: GpuPlanted): string[] {
  const out = dir();
  const calls = [slabsDoc(), panesDoc(true), panesDoc(false)].map((d, i) => view3dCall({ doc: writeJson(out, `doc-${i}`, d), look: PLAIN_LOOK, size: i === 0 ? SLAB_CAM.size : PANE_CAM.size, targets: ['final', 'linear', 'ids'] }));
  const [s, p, bare] = runGpu(bin(), out, calls, planted).map((r, i) => frameAt(framesOf(r, `doc ${i}`), 0, `doc ${i}`));
  const failures: string[] = [];

  // The slabs: 4 cm ÷ 2 cm = the attenuation color.
  const sl = readLinear(out, s!.linear, SLAB_CAM.size, 'the slabs'); const sid = readIds(out, s!, 'the slabs: ids');
  const thin = inside(sid, 'slab_2cm', 3); const thick = inside(sid, 'slab_4cm', 3);
  expect(thin.length, 'the 2 cm slab shows 3 px inside its edges').toBeGreaterThan(1000);
  expect(thick.length, 'the 4 cm slab shows 3 px inside its edges').toBeGreaterThan(1000);
  const mean = [0, 1, 2].map((c) => thin.reduce((a, [x, y]) => a + sl.at(x, y)[c]!, 0) / thin.length);
  const color = [0.5, 0.8, 1];
  let off = 0; let worst = '';
  for (const [x, y] of thick) for (let c = 0; c < 3; c++) { const r = sl.at(x, y)[c]! / mean[c]!; const e = Math.abs(r / color[c]! - 1); if (e > off) { off = e; worst = `(${x}, ${y}) channel ${c}: ${r.toFixed(4)}, want ${color[c]}`; } }
  console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: the 2 cm slab reads ${mean.map((v) => v.toFixed(4)).join(', ')}; 4 cm ÷ 2 cm worst ${(off * 100).toFixed(2)}% off at ${worst}`);
  if (off > 0.01) failures.push(`glass_4cm: its pixels aren't [0.5, 0.8, 1] times glass_2cm's within 1%: ${(off * 100).toFixed(2)}% off at ${worst}`);

  // The panes: the edge widens with roughness, and each matches the mip blur of the copy.
  const pl = readLinear(out, p!.linear, PANE_CAM.size, 'the panes'); const pf = readPng(out, p!.final, 'the panes: final'); const pid = readIds(out, p!, 'the panes: ids');
  const bl = readLinear(out, bare!.linear, PANE_CAM.size, 'the bare edge');
  const [W, H] = PANE_CAM.size;
  const copy: Plane = { width: W, height: H, data: new Float64Array(W * H * 3) };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) copy.data.set(bl.at(x, y), (y * W + x) * 3);
  const chain = mips(copy);
  const bareRow = Math.floor(project(PANE_CAM, [0, BARE_Y, 0])[1]);
  const span: [number, number] = [W / 2 - 120, W / 2 + 120];
  const bareEdge = edgeOf(bl, bareRow, span);
  const edges = PANES.map((pane) => {
    const cy = Math.floor(project(PANE_CAM, [0, pane.y, 0])[1]);
    const e = edgeOf(pl, cy, span);
    console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: ${pane.id}: edge at ${e.mid.toFixed(2)} px, 10–90% over ${e.width.toFixed(2)} px (bare: ${bareEdge.mid.toFixed(2)}, ${bareEdge.width.toFixed(2)})`);
    // The pane's transmittance: its white side, far from the edge, ÷ the copy's there.
    const far: [number, number][] = inside(pid, `pane_${pane.id}`, 3).filter(([x]) => x > W / 2 + 100);
    expect(far.length, `${pane.id}: pixels on its white side, far from the edge`).toBeGreaterThan(100);
    const k = [0, 1, 2].map((c) => far.reduce((a, [x, y]) => a + pl.at(x, y)[c]!, 0) / far.reduce((a, [x, y]) => a + bl.at(x, y)[c]!, 0));
    const lod = transmissionLod(PANE_CAM.size, pane.r, 1.5);
    let worstCode = 0; let at = '';
    for (const [x, y] of inside(pid, `pane_${pane.id}`, 3)) {
      const ref = trilinear(chain, (x + 0.5) / W, (y + 0.5) / H, lod);
      const drawn = px(pf, x, y);
      for (let c = 0; c < 3; c++) { const d = Math.abs(drawn[c]! - code(k[c]! * ref[c]!)); if (d > worstCode) { worstCode = d; at = `(${x}, ${y}) channel ${c}: drawn ${drawn[c]}, reference ${code(k[c]! * ref[c]!)}`; } }
    }
    if (worstCode > 2) failures.push(`${pane.id}: off the CPU reference of the mip blur (level ${lod.toFixed(2)}) by ${worstCode} code values at ${at}`);
    return { ...pane, ...e };
  });
  if (!(Math.abs(edges[0]!.mid - bareEdge.mid) <= 1)) failures.push(`frost_000: its edge at ${edges[0]!.mid.toFixed(2)} px isn't within 1 px of the bare edge at ${bareEdge.mid.toFixed(2)} px`);
  if (!(edges[1]!.width > edges[0]!.width)) failures.push(`frost_030: its edge (${edges[1]!.width.toFixed(2)} px) isn't wider than frost_000's (${edges[0]!.width.toFixed(2)} px)`);
  if (!(edges[2]!.width > edges[1]!.width)) failures.push(`frost_060: its edge (${edges[2]!.width.toFixed(2)} px) isn't wider than frost_030's (${edges[1]!.width.toFixed(2)} px)`);
  return failures;
}

/** Each channel's line along the centre rows, by centroid in a window round the reference, against it. */
function lines(planted?: GpuPlanted): string[] {
  const out = dir();
  const [d1, d0] = runGpu(bin(), out, [lineDoc(1), lineDoc(0)].map((d, i) => view3dCall({ doc: writeJson(out, `line-${i}`, d), look: PLAIN_LOOK, size: LINE_CAM.size, targets: ['linear'] })), planted)
    .map((r, i) => readLinear(out, frameAt(framesOf(r, `line ${i}`), 0, `line ${i}`).linear, LINE_CAM.size, `line ${i}`));
  const slab: TiltedSlab = { center: [0, 0, 0], rotY: 30, size: [0.4, 0.3, 0.2], thickness: 0.2 };
  const cy = LINE_CAM.size[1] / 2;
  const refs = channelIors(1.5, 1).map((ior) => lineColumn(LINE_CAM, slab, cy + 0.5, 0, -0.6, ior));
  expect(refs.every((r) => r !== null), `the CPU finds each channel's line through the slab: ${refs.join(', ')}`).toBe(true);
  expect(Math.abs(refs[0]! - refs[2]!), 'the CPU reference puts the red and blue lines at least 3 px apart').toBeGreaterThanOrEqual(3);
  const centroid = (lin: typeof d1, c: number, around: number): number => {
    let sw = 0; let sx = 0;
    const xs = Array.from({ length: 17 }, (_, i) => Math.round(around) - 8 + i);
    let base = Infinity;
    for (const x of xs) for (let y = cy - 4; y < cy + 4; y++) base = Math.min(base, lin!.at(x, y)[c]!);
    for (const x of xs) for (let y = cy - 4; y < cy + 4; y++) { const w = lin!.at(x, y)[c]! - base; sw += w; sx += w * (x + 0.5); }
    return sw > 0 ? sx / sw : NaN;
  };
  const failures: string[] = [];
  const names = ['red', 'green', 'blue'];
  for (let c = 0; c < 3; c++) {
    const got = centroid(d1, c, refs[c]!);
    console.log(`${ID}${planted ? ` (--planted ${planted})` : ''}: prism's ${names[c]} line at ${got.toFixed(2)} px, the reference ${refs[c]!.toFixed(2)} px`);
    if (!(Math.abs(got - refs[c]!) <= 0.5)) failures.push(`prism: its ${names[c]} line is at ${got.toFixed(2)} px, not within 0.5 px of the reference's ${refs[c]!.toFixed(2)} px (IOR ${channelIors(1.5, 1)[c]})`);
    const flat = centroid(d0, c, refs[1]!);
    if (!(Math.abs(flat - refs[1]!) <= 0.5)) failures.push(`prism_flat: at dispersion 0 its ${names[c]} line is at ${flat.toFixed(2)} px, not one line with the IOR 1.5 reference at ${refs[1]!.toFixed(2)} px`);
  }
  return failures;
}

describe(`${ID} thickness, roughness and dispersion through transmission`, () => {
  it(`${ID} the 4 cm slab reads [0.5, 0.8, 1] times the 2 cm slab within 1%; panes widen the edge with roughness, each within 2 code values of the CPU mip blur; planted models that ignore thickness or roughness fail, naming the material`, () => {
    requireMetal();
    none(thicknessAndRoughness(), 'the slabs and the panes');
    failsNaming(thicknessAndRoughness('absorption_ignores_thickness'), ['glass_4cm'], '--planted absorption_ignores_thickness');
    failsNaming(thicknessAndRoughness('transmission_ignores_roughness'), ['frost_030', 'frost_060'], '--planted transmission_ignores_roughness');
  }, 3_600_000);

  it(`${ID} a line behind a slab tilted 30° splits into red, green and blue at IORs 1.4875, 1.5 and 1.5125, each within 0.5 px of the CPU reference, and into one line at dispersion 0; a planted model that samples once fails, naming the material`, () => {
    requireMetal();
    none(lines(), 'the dispersion line');
    failsNaming(lines('dispersion_samples_once'), ['prism'], '--planted dispersion_samples_once');
  }, 3_600_000);
});
