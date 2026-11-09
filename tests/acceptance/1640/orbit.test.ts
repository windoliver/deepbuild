// AC3: "A 10 s orbit of a 100,000-triangle asset with crease edges derives the set once, counted on the noop lane,
// and every frame equals by pixel hash a run that derives it every frame"
//
// The asset is generated (reference.ts: foldedSheet): a folded sheet of exactly 100,000 triangles written as a JSON
// glTF and drawn as `mesh.asset@1`, read by a `mark.line@1` with `edges: {of: "sheet", kind: {crease: {angle: 30}},
// border: false}`. The camera orbits it once in 10 s (a channel on `items/cam/params/orbit/azimuth`, 0° to 360°),
// 600 frames at 60 fps. Conditions: on the noop lane, with `counts: true`, every frame reports the line's
// `edge_sets_derived`, frame 0 derives the set once and no later frame derives it again (a total of 1 over the
// orbit), and frame 0's segments are the CPU reference's crease set (its four 200-edge fold lines); on the same lane
// the planted `edges_derive_every_frame`, the run the criterion compares with, derives it in every frame, so the
// count can see a derivation. On the reference Mac, each of the 600 frames of the orbit has a pixel hash equal to
// that frame of the run under `edges_derive_every_frame`, and the orbit moves (the frames differ). The comparison's
// planted-mismatch twin: under `crease_below_angle` (another edge set) the first 30 frames' hashes all differ from
// the clean run's, so the hash comparison can see a wrong set.

import { describe, expect, it } from 'vitest';
import {
  AC, ANGLE, ASSET_TRIANGLES, ORBIT, SHA, creaseEdges, edgeLine, failsNaming, look, none, requireGpu, runGpu, segKey, segmentsOf, sessionDoc,
  startName, useDir, useGpuBin, view3d, view3Reply, writeFile, type Frame3, type Startup,
} from './helpers.ts';
import { SHEET, creaseReference, foldedSheet, gltf } from './reference.ts';

const bin = useGpuBin();
const dir = useDir();
const SIZE: [number, number] = [640, 480];
const LINE = 'sheet_crease';
const MISMATCH_FRAMES = 30;

function orbit(startup: Startup, counts: boolean, frames: number = ORBIT.frames): Frame3[] {
  const mesh = foldedSheet();
  expect(mesh.triangles.length, 'the asset has the issue\'s 100,000 triangles').toBe(ASSET_TRIANGLES);
  const g = gltf(mesh);
  const asset = writeFile(dir(), `${g.sha}.gltf`, g.bytes);
  const doc = writeFile(dir(), 'orbit.json', sessionDoc('Crease orbit', {
    cam: { kind: 'camera@1', params: { projection: 'perspective', target: [0, 0.5, 0], orbit: { azimuth: 0, elevation: 35, distance: 9 }, fov: 40, near: 0.1 } },
    sheet: { kind: 'mesh.asset@1', params: { sha256: g.sha, node: 0 }, at: { pos: [0, 0, 0] } },
    [LINE]: edgeLine({ edges: creaseEdges('sheet', ANGLE, false), width: 2 }),
  }, {
    transport: { span: `${ORBIT.seconds}s` },
    channels: { spin: { target: 'items/cam/params/orbit/azimuth', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: `${ORBIT.seconds}s`, value: 360 } } } },
  }));
  const [reply] = runGpu(bin(), dir(), [view3d({ doc, look: look(), size: SIZE, frames, fps: ORBIT.fps, counts, assets: { [g.sha]: asset } })], startup);
  return view3Reply(reply!, `the orbit on ${startName(startup)}`, frames);
}

/** How many times each frame derived the line's edge set, failing when a frame doesn't report it. */
function derivedOf(frames: Frame3[], what: string): number[] {
  return frames.map((f) => {
    expect(f.derived, `${what}: frame ${f.frame} reports edge_sets_derived (counts: true)`).not.toBeNull();
    const n = f.derived!.get(LINE);
    expect(n, `${what}: frame ${f.frame} reports ${LINE} in edge_sets_derived`).toBeDefined();
    return n!;
  });
}

/** The pixel-hash comparison: each frame of `a` equals that frame of `b`; failures name the frame. */
function hashProblems(a: Frame3[], b: Frame3[], what: string): string[] {
  const out: string[] = [];
  for (const f of a) {
    const g = b.find((x) => x.frame === f.frame);
    if (!g) { out.push(`${what}: frame ${f.frame} has no counterpart`); continue; }
    if (f.pixel_hash === null || !SHA.test(f.pixel_hash)) out.push(`${what}: frame ${f.frame} has no pixel hash`);
    else if (f.pixel_hash !== g.pixel_hash) out.push(`${what}: frame ${f.frame}'s pixel hash ${f.pixel_hash} isn't the other run's ${g.pixel_hash}`);
  }
  return out;
}

describe(`${AC[3]} a 10 s orbit of a 100,000-triangle asset with crease edges`, () => {
  it(`${AC[3]} derives the crease set once over the ${ORBIT.frames} frames, the reference's ${SHEET.folds} fold lines (noop lane)`, () => {
    const what = 'the orbit on noop';
    const frames = orbit({ backend: 'noop' }, true);
    const derived = derivedOf(frames, what);
    const later = derived.map((n, i) => ({ n, i })).filter(({ n, i }) => i > 0 && n !== 0);
    const problems: string[] = [];
    if (derived[0] !== 1) problems.push(`frame 0 derives ${LINE}'s edge set ${derived[0]} times, not once`);
    if (later.length) problems.push(`${later.length} later frames derive it again (first: frame ${later[0]!.i}, ${later[0]!.n} times)`);
    const total = derived.reduce((s, n) => s + n, 0);
    if (total !== 1) problems.push(`the orbit derives it ${total} times in all, not once`);
    none(problems, `${what}: the crease set is derived once`);
    const want = new Set(creaseReference(foldedSheet(), ANGLE, false).map(([a, b]) => segKey(a, b)));
    expect(want.size, 'the reference crease set: four fold lines of 200 edges').toBe(SHEET.folds * SHEET.nz);
    for (const n of [0, ORBIT.frames - 1]) {
      const got = segmentsOf(frames[n]!, LINE, what).map(([a, b]) => segKey(a, b));
      const missing = [...want].filter((k) => !got.includes(k));
      const extra = got.filter((k) => !want.has(k));
      none([
        ...(got.length !== want.size ? [`frame ${n} draws ${got.length} segments, not the reference's ${want.size}`] : []),
        ...(missing.length ? [`frame ${n} leaves out ${missing.length} reference crease edges, e.g. ${missing[0]}`] : []),
        ...(extra.length ? [`frame ${n} draws ${extra.length} edges that aren't creases, e.g. ${extra[0]}`] : []),
      ], `${what}: the drawn crease set`);
    }
  }, 3_600_000);

  it(`${AC[3]} the comparison run, edges_derive_every_frame, derives the set in every frame (noop lane)`, () => {
    const what = 'the orbit on noop with --planted edges_derive_every_frame';
    const derived = derivedOf(orbit({ backend: 'noop', planted: 'edges_derive_every_frame' }, true), what);
    const short = derived.map((n, i) => ({ n, i })).filter(({ n }) => n < 1);
    expect(short.map(({ i }) => i), `${what}: every frame derives the edge set`).toEqual([]);
  }, 3_600_000);

  it(`${AC[3]} every frame of the orbit equals by pixel hash the run that derives the set every frame; a run with another edge set differs (reference Mac)`, () => {
    requireGpu();
    const clean = orbit({}, false);
    const every = orbit({ planted: 'edges_derive_every_frame' }, false);
    expect(new Set(clean.map((f) => f.pixel_hash)).size, 'the camera orbits: the frames differ').toBeGreaterThan(ORBIT.frames / 2);
    none(hashProblems(clean, every, 'the orbit against edges_derive_every_frame'), 'derived once equals derived every frame');
    // The planted-mismatch twin: the same comparison against a run that draws another edge set fails at every frame.
    const wrong = orbit({ planted: 'crease_below_angle' }, false, MISMATCH_FRAMES);
    const problems = hashProblems(clean.slice(0, MISMATCH_FRAMES), wrong, 'the orbit against crease_below_angle');
    failsNaming(problems, Array.from({ length: MISMATCH_FRAMES }, (_, n) => `frame ${n}'s pixel hash`), 'the comparison with another edge set');
  }, 3_600_000);
});
