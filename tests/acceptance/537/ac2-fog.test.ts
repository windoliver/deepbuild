// AC2 #537.f46857ff: A 128 × 128 m terrain plate at 1 m spacing with a fog overlay over a 128 × 128 logic i32 grid, with
// roles [fog, dim, none] and opacity 1: after a step that sets a 9 × 9 square of cells centred on cell (64, 64) to 2 and
// every other cell to 0, a frame from straight above matches, at every cell centre, a reference frame of the same plate
// whose cover outside that square is the fog role's color, within 1 code value, and pixels 0.1 m either side of the
// square's edge show the two colors unmixed; the plate's content key and mesh are the same across 600 steps that change
// the grid; seeking to t and playing to t give the same pixel hash; a planted overlay that keeps the previous frame's grid
// on a seek fails, naming the first cell that differs; and a third overlay is refused at check
//
// `ground` (fixtures.ts) is the plate, centred on the origin, flat, in `soil`, lit by one sun; its overlay reads
// `fogger.fog` (programs.ts `fogProgram`): bands of fog, dim and none that move at every step up to 599, and from step 600
// the square, 2 (none) inside and 0 (fog) everywhere else. Frames are `view3d`'s final target from straight above, 128 m
// across 2,048 px (16 px a metre), so cell (cx, cz) spans px 16 cx to 16 cx + 16 across and 16 cz to 16 cz + 16 down.
// The reference frame is built from two frames of the same plate with no overlay, drawn by the same camera, sun and
// look: inside the square its cover as it is (`soil`), outside it a material whose base color is the look's `fog` role
// (README: Readings). The content key and the mesh are `deep_show`'s `geometry` rows at 21 steps, and `view3d`'s
// `meshes_built` at every frame; the refusal is the document check's.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CELLS, GRID, SQUARE, SQUARE_STEP, fogProgram, fogValue, inSquare } from './programs.ts';
import { FOG_SIZE, FOG_TARGET, PLATE, fogAgent, fogSession, overlaysAgent, plateRefSession, threeGridsProgram } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, arr, at, binOf, codeOff, failsNaming, finalOf, frameAt, framesOf, issuesOf, namedIn, names, namesItem, none, obj,
  pixel, prebuild, presented, putAsset, putEvidence, requireMetal, runGpu, runShow, scenario, sha256, show, showCall, str, topDownPx,
  geometryCall, useTemp, view3dCall, writeJson, type Frame, type Image, type JsonObject, type Planted, type Rgb,
} from './helpers.ts';

prebuild(['deep-gpu', 'deep-show']);
const temp = useTemp();
/** The step the seeked session draws before it jumps to step 600. */
const SEEK_FROM = 10;

/** The pixel of world point (x, z). */
const px = (x: number, z: number): [number, number] => {
  const [sx, sy] = topDownPx(FOG_SIZE, FOG_TARGET, PLATE, x, z);
  return [Math.floor(sx), Math.floor(sy)];
};
/** Cell (cx, cz)'s centre: the plate's corner is at (−64, −64) m. */
const cellPx = (cx: number, cz: number): [number, number] => px(-PLATE / 2 + cx + 0.5, -PLATE / 2 + cz + 0.5);
const cell = (cx: number, cz: number): string => `cell (${cx}, ${cz})`;

interface Refs { soil: Image; fogged: Image }
/** At every cell centre, the overlay frame against the reference: the plate's own cover inside the square, the fog
 * role's color outside it, within 1 code value. */
function cellFailures(frame: Image, refs: Refs): string[] {
  const out: string[] = [];
  for (let cz = 0; cz < GRID; cz++) for (let cx = 0; cx < GRID; cx++) {
    const [x, y] = cellPx(cx, cz);
    const want = pixel(inSquare(cx, cz) ? refs.soil : refs.fogged, x, y);
    const got = pixel(frame, x, y);
    if (codeOff(got, want) > 1) out.push(`${cell(cx, cz)} at px (${x}, ${y}): ${JSON.stringify(got)}, the reference's ${JSON.stringify(want)} (${inSquare(cx, cz) ? 'its own cover' : 'the fog role\'s color'})`);
  }
  return out;
}
/** Along the square's four edges, at each of its nine cells: the pixel 0.1 m outside shows the fog role's color and the
 * pixel 0.1 m inside the plate's own cover, each within 1 code value of the reference: two colors, unmixed. */
function edgeFailures(frame: Image, refs: Refs): string[] {
  const out: string[] = [];
  const lo = -PLATE / 2 + SQUARE.from;
  const hi = -PLATE / 2 + SQUARE.to + 1;
  for (let c = SQUARE.from; c <= SQUARE.to; c++) {
    const along = -PLATE / 2 + c + 0.5;
    const sides: [string, [number, number], [number, number]][] = [
      [`the left edge at z ${along}`, px(lo - 0.1, along), px(lo + 0.1, along)],
      [`the right edge at z ${along}`, px(hi + 0.1, along), px(hi - 0.1, along)],
      [`the top edge at x ${along}`, px(along, lo - 0.1), px(along, lo + 0.1)],
      [`the bottom edge at x ${along}`, px(along, hi + 0.1), px(along, hi - 0.1)],
    ];
    for (const [where, outside, inside] of sides) {
      const [fogWant, coverWant] = [pixel(refs.fogged, ...outside), pixel(refs.soil, ...inside)];
      const [fogGot, coverGot] = [pixel(frame, ...outside), pixel(frame, ...inside)];
      if (codeOff(fogGot, fogWant) > 1) out.push(`${where}: 0.1 m outside, px (${outside.join(', ')}) shows ${JSON.stringify(fogGot)}, not the fog role's ${JSON.stringify(fogWant)}`);
      if (codeOff(coverGot, coverWant) > 1) out.push(`${where}: 0.1 m inside, px (${inside.join(', ')}) shows ${JSON.stringify(coverGot)}, not the plate's own ${JSON.stringify(coverWant)}`);
    }
  }
  return out;
}
/** Seeked against played at step 600: equal pixel hashes; on a difference, the first cell (row by row, from cell (0, 0))
 * whose centre's pixel differs, which the failure names. */
function seekFailures(played: Frame, playedIm: Image, seeked: Frame, seekedIm: Image): string[] {
  if (played.hash !== null && played.hash === seeked.hash) return [];
  for (let cz = 0; cz < GRID; cz++) for (let cx = 0; cx < GRID; cx++) {
    const [x, y] = cellPx(cx, cz);
    const a: Rgb = pixel(playedIm, x, y);
    const b: Rgb = pixel(seekedIm, x, y);
    if (codeOff(a, b) > 0) return [`step ${SQUARE_STEP}: the seeked frame's pixel hash ${seeked.hash} isn't the played one's ${played.hash}; the first cell that differs is ${cell(cx, cz)}: seeked ${JSON.stringify(b)}, played ${JSON.stringify(a)}`];
  }
  return [`step ${SQUARE_STEP}: the seeked frame's pixel hash ${seeked.hash} isn't the played one's ${played.hash}, though no cell centre differs`];
}
/** The first cell, row by row, whose value at step `a` names another role than at step `b`. */
function firstChanged(a: number, b: number): string {
  for (let cz = 0; cz < GRID; cz++) for (let cx = 0; cx < GRID; cx++) if (fogValue(cx, cz, a) !== fogValue(cx, cz, b)) return cell(cx, cz);
  return 'none';
}

const playCall = (doc: string, assets: Record<string, string>): JsonObject =>
  view3dCall({ doc, size: FOG_SIZE, frames: SQUARE_STEP + 1, capture: [SQUARE_STEP], targets: ['final'], counts: true, assets });
const seekCall = (doc: string, assets: Record<string, string>): JsonObject =>
  view3dCall({ doc, size: FOG_SIZE, frames: SEEK_FROM + 2, seeks: [{ after: SEEK_FROM, to: SQUARE_STEP }], capture: [SQUARE_STEP], targets: ['final'], assets });
interface Run { out: string; played: Frame[]; seeked: Frame[]; refs: Refs }
/** One `deep-gpu run`: the fog played from step 0 to 600, the same seeked from step 10 to 600, and the two references. */
function fogRun(out: string, planted?: Planted): Run {
  requireMetal();
  const program = fogProgram();
  const assets = putAsset(out, program.bytes, 'wasm');
  const doc = writeJson(out, 'fog', fogSession(program));
  const what = `AC2 the fog overlay${planted ? ` (planted ${planted})` : ''}`;
  const [played, seeked, soil, fogged] = runGpu(binOf('deep-gpu'), out, [
    playCall(doc, assets), seekCall(doc, assets),
    view3dCall({ doc: writeJson(out, 'plate-soil', plateRefSession('soil')), size: FOG_SIZE, capture: [0], targets: ['final'] }),
    view3dCall({ doc: writeJson(out, 'plate-fogged', plateRefSession('fogged')), size: FOG_SIZE, capture: [0], targets: ['final'] }),
  ], what, planted);
  const ref = (r: JsonObject, w: string): Image => finalOf(out, frameAt(framesOf(r, w), 0, w), w);
  return {
    out, played: framesOf(played!, `${what}, played`), seeked: framesOf(seeked!, `${what}, seeked`),
    refs: { soil: ref(soil!, 'the plate with its own cover'), fogged: ref(fogged!, 'the plate in the fog role\'s color') },
  };
}
// The honest run is shared by the file's first three tests; its folder is deleted after the file.
let shared: Run | null = null;
let sharedDir = '';
const honest = (): Run => (shared ??= fogRun((sharedDir ||= mkdtempSync(join(tmpdir(), 'deep-537-fog-')))));
afterAll(() => { if (sharedDir) rmSync(sharedDir, { recursive: true, force: true }); });

describe(`${AC[2]} a fog overlay on a 128 × 128 m terrain plate from a logic grid`, () => {
  it(`${AC[2]} after the square's step, the frame from straight above matches the reference at every cell centre within 1 code value, and pixels 0.1 m either side of the square's edge show the two colors unmixed`, () => {
    const run = honest();
    const f = frameAt(run.played, SQUARE_STEP, 'the fog played to step 600');
    const frame = finalOf(run.out, f, 'the fog played to step 600');
    const [x, y] = cellPx(0, 0);
    expect(codeOff(pixel(run.refs.soil, x, y), pixel(run.refs.fogged, x, y)), 'the fixture: the plate\'s own cover and the fog role\'s color differ by more than 20 code values').toBeGreaterThan(20);
    none(cellFailures(frame, run.refs), `the ${CELLS} cell centres at step ${SQUARE_STEP} against the reference`);
    none(edgeFailures(frame, run.refs), 'the pixels 0.1 m either side of the square\'s edges');
  }, TIMEOUT);

  it(`${AC[2]} the plate's content key and mesh are the same across 600 steps that change the grid`, () => {
    const run = honest();
    const built = run.played.map((f) => f.meshesBuilt);
    expect(built.length, 'the play draws steps 0 to 600').toBe(SQUARE_STEP + 1);
    expect(built[0], 'frame 0 builds the plate\'s mesh (meshes_built, counts)').toBeGreaterThan(0);
    const rebuilt = run.played.filter((f) => f.frame > 0 && f.meshesBuilt !== 0).map((f) => `step ${f.frame} built ${f.meshesBuilt} meshes`);
    none(rebuilt, 'no mesh is built again at steps 1 to 600, each of which changes the grid');

    const ev = temp();
    const program = fogProgram();
    putEvidence(ev, program.bytes);
    const steps = Array.from({ length: 21 }, (_, i) => 30 * i);
    const [shown, ...rows] = runShow(binOf('deep-show'), scenario(ev, [DOC(1)], [
      showCall(DOC(1), fogAgent(program)), ...steps.map((k) => geometryCall(DOC(1), ['ground'], at(k))),
    ]), 'AC2 the plate\'s geometry at 21 steps');
    presented(shown!, 'the fogged plate');
    const read = rows.map((r, i) => {
      const w = `the plate's geometry row at step ${steps[i]}`;
      expect(r['code'], `${w}: the geometry call answers: ${show(r)}`).toBeUndefined();
      const row = arr(r['items'], `${w}: items`).map((x) => obj(x, w)).find((x) => x['id'] === 'ground');
      expect(row, `${w}: a row for ground`).toBeDefined();
      return { key: str(row!['key'], `${w}: key`), mesh: sha256(JSON.stringify([row!['positions'], row!['indices']])) };
    });
    for (let k = 1; k < 600; k++) expect(fogValue(5, 7, k), 'the fixture: every step up to 600 changes the grid').not.toBe(fogValue(5, 7, k - 1));
    none(read.flatMap((r, i) => (r.key !== read[0]!.key ? [`step ${steps[i]}: the plate's content key ${r.key}, not step 0's ${read[0]!.key}`] : [])), 'the plate\'s content key at steps 0 to 600');
    none(read.flatMap((r, i) => (r.mesh !== read[0]!.mesh ? [`step ${steps[i]}: the plate's mesh differs from step 0's`] : [])), 'the plate\'s mesh at steps 0 to 600');
  }, TIMEOUT);

  it(`${AC[2]} seeking to step 600 and playing to it give the same pixel hash`, () => {
    const run = honest();
    const p = frameAt(run.played, SQUARE_STEP, 'played');
    const s = frameAt(run.seeked, SQUARE_STEP, 'seeked');
    expect(run.seeked.map((f) => f.frame), 'the seeked session draws steps 0 to 10, then step 600').toEqual([...Array.from({ length: SEEK_FROM + 1 }, (_, k) => k), SQUARE_STEP]);
    // The frame compared shows the overlay: fog outside the square (cell (0, 0)), the plate's own cover inside (64, 64).
    const seekedIm = finalOf(run.out, s, 'seeked');
    const shows = (cx: number, cz: number, ref: Image, what: string): void => {
      const [x, y] = cellPx(cx, cz);
      expect(codeOff(pixel(seekedIm, x, y), pixel(ref, x, y)), `the seeked step 600 shows ${what} at ${cell(cx, cz)}`).toBeLessThanOrEqual(1);
    };
    shows(0, 0, run.refs.fogged, 'the fog role\'s color');
    shows(64, 64, run.refs.soil, 'the plate\'s own cover');
    none(seekFailures(p, finalOf(run.out, p, 'played'), s, seekedIm), 'step 600 seeked from step 10 against played from step 0');
    expect(s.hash, 'the frames carry a pixel hash').not.toBeNull();
  }, TIMEOUT);

  it(`${AC[2]} planted overlay_keeps_grid_on_seek fails the seek against play, naming the first cell that differs`, () => {
    const run = fogRun(temp(), 'overlay_keeps_grid_on_seek');
    const p = frameAt(run.played, SQUARE_STEP, 'played');
    const s = frameAt(run.seeked, SQUARE_STEP, 'seeked');
    const first = firstChanged(SEEK_FROM, SQUARE_STEP);
    expect(first, 'the fixture: step 10\'s grid and step 600\'s first differ at cell (0, 0)').toBe('cell (0, 0)');
    failsNaming(seekFailures(p, finalOf(run.out, p, 'played'), s, finalOf(run.out, s, 'seeked')), [new RegExp(`first cell that differs is ${first.replace(/[()]/g, '\\$&')}`)], 'the seek against play under overlay_keeps_grid_on_seek');
  }, TIMEOUT);

  it(`${AC[2]} a third overlay is refused at check`, () => {
    const ev = temp();
    const program = threeGridsProgram();
    putEvidence(ev, program.bytes);
    const [three, two] = runShow(binOf('deep-show'), scenario(ev, [DOC(1), DOC(2)], [
      showCall(DOC(1), overlaysAgent(program, 3)), showCall(DOC(2), overlaysAgent(program, 2)),
    ]), 'AC2 the overlay refusal');
    expect(three!['outcome'], `the plate with three overlays is refused at check: ${show(three, 2500)}`).toBe('refused');
    const errors = issuesOf(three!).filter((i) => i['severity'] === 'error');
    const naming = errors.filter((e) => e['code'] !== 'unknown_field' && namesItem(e, 'ground') && names(namedIn(e), 'overlays'));
    expect(naming.length, `an error, other than a field the check doesn't know, names ground and its overlays; the errors: ${show(errors, 2500)}`).toBeGreaterThan(0);
    presented(two!, 'the same plate with two overlays');
  }, TIMEOUT);
});
