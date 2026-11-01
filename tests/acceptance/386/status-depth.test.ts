// #386.5663e962: At internal scale 0.75, a status-bound building half behind another reads its exact sRGB status
// value where it shows and doesn't show where it's hidden, since status colors draw after the upscale and sharpen,
// depth-tested against the core's depth target.
//
// The street is `streetDoc` (helpers.ts): a tower whose stroke slot is bound to a verdict in state fail (Status
// binding: on a 3D object a status binding takes its stroke slot, drawn as an outline around the object), with a nearer
// hall hiding its lower left half. Each frame is drawn by #378's `view3d` (with #382's `states` and `status`) through
// this suite's `surface` field at internal scale 0.75. Where the outline goes is read from the same street drawn with
// the hall left out (same scale, same camera): its pixels of the exact fail color, all within 8 px of the tower's
// silhouette (from the object-ID target at scale 1). With the hall in, those pixels must keep the exact fail color
// where nothing hides them (4 px or more from every hall pixel), and no pixel the hall covers (4 px or more inside it)
// may come within 0.10 OKLab of fail. The frame's passes run the status guard, then the upscale and sharpen, then the
// status colors, which read the depth target.
// Wrong programs: the base (a stroke binding is refused, `status_slot_kind`, and view3d has no `surface`); `--planted
// status_before_upscale` (status colors drawn at internal size, before the upscale and sharpen); `--planted
// status_without_depth` (status colors drawn with no depth test).
import { describe, expect, it } from 'vitest';
import {
  COLORS_PASS, FAIL, GUARD_PASS, SHARPEN_PASS, STATUS_LOOK, STREET, UPSCALE_PASS, VERDICT, answered, band, deltaEOk, frameAt, framesOf, grow, hex, passesOf, pixel, readIds,
  readPng, requireMetal, run, statusOf, streetDoc, surfaceOf, surfaceProblems, useBuilds, useOut, view3dCall, writeJson,
  type Ids, type Image, type JsonObject, type Planted, type StatusReport, type SurfaceSpec,
} from './helpers.ts';

const ID = '#386.5663e962';
const AT: SurfaceSpec = { internal_scale: 0.75, upscale: 'edge_adaptive', sharpen: 0.2 };
const RING = 8;
const CLEAR = 4;

const builds = useBuilds(['default']);
const out = useOut();

const exact = (c: [number, number, number]): boolean => c[0] === FAIL[0] && c[1] === FAIL[1] && c[2] === FAIL[2];

/** The pixels the status report's legend and mark labels own (grown 2 px): they may hold the fail color anywhere. */
function owned(status: StatusReport, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  for (const [x, y, bw, bh] of status.boxes) {
    for (let j = Math.max(0, Math.floor(y - 2)); j < Math.min(h, Math.ceil(y + bh + 2)); j++)
      for (let i = Math.max(0, Math.floor(x - 2)); i < Math.min(w, Math.ceil(x + bw + 2)); i++) mask[j * w + i] = 1;
  }
  return mask;
}

interface Street { hall: Image; open: Image; hallStatus: StatusReport; openStatus: StatusReport; passes: { name: string; reads: string[] }[]; idsHall: Ids; idsOpen: Ids }
/** The four frames: with and without the hall at internal scale 0.75 with the binding, and their object-ID targets at scale 1. */
function draw(bin: string, planted?: Planted): Street {
  const docHall = writeJson(out(), 'street-hall', streetDoc({ hall: true, binding: true }));
  const docOpen = writeJson(out(), 'street-open', streetDoc({ hall: false, binding: true }));
  const idsHall = writeJson(out(), 'ids-hall', streetDoc({ hall: true, binding: false }));
  const idsOpen = writeJson(out(), 'ids-open', streetDoc({ hall: false, binding: false }));
  const bound = (doc: string): JsonObject => view3dCall({ doc, look: STATUS_LOOK, size: STREET, frames: 1, capture: [0], targets: ['final'], surface: AT, states: { [VERDICT]: 'fail' } });
  const ids = (doc: string): JsonObject => view3dCall({ doc, look: STATUS_LOOK, size: STREET, frames: 1, capture: [0], targets: ['final', 'ids'] });
  const [rh, ro, ih, io] = run(bin, out(), [bound(docHall), bound(docOpen), ids(idsHall), ids(idsOpen)], planted ? { planted } : {});
  const frame = (reply: JsonObject, what: string): Image => {
    answered(reply, what);
    expect(surfaceProblems(surfaceOf(reply, what), AT, STREET, what), `${what} drew at internal scale 0.75 through the edge-adaptive upscale`).toEqual([]);
    return readPng(out(), frameAt(framesOf(reply, what), 0, what).final, `${what}: the final target`);
  };
  const hall = frame(rh!, 'the street with the hall');
  const open = frame(ro!, 'the street without the hall');
  return {
    hall, open, hallStatus: statusOf(rh!, 'the street with the hall'), openStatus: statusOf(ro!, 'the street without the hall'),
    passes: passesOf(rh!, 'the street with the hall'),
    idsHall: readIds(out(), frameAt(framesOf(answered(ih!, 'ids with the hall'), 'ids with the hall'), 0, 'ids'), 'the ID target with the hall'),
    idsOpen: readIds(out(), frameAt(framesOf(answered(io!, 'ids without the hall'), 'ids without the hall'), 0, 'ids'), 'the ID target without the hall'),
  };
}

/** The criterion's check on the street: failures as sentences, each naming where. */
function problemsOf(s: Street): string[] {
  const [w, h] = STREET;
  const problems: string[] = [];
  const order = s.passes.map((p) => p.name);
  const at = (n: string): number => order.indexOf(n);
  if (!(at(GUARD_PASS) >= 0 && at(GUARD_PASS) < at(UPSCALE_PASS) && at(UPSCALE_PASS) < at(SHARPEN_PASS) && at(SHARPEN_PASS) < at(COLORS_PASS)))
    problems.push(`passes: the frame runs ${order.join(' → ')}, not the status guard, then the upscale and sharpen, then the status colors`);
  const colors = s.passes.find((p) => p.name === COLORS_PASS);
  if (colors && !colors.reads.includes('depth')) problems.push(`passes: ${COLORS_PASS} reads ${colors.reads.join(', ') || 'nothing'}, not the core's depth target`);
  const mark = s.hallStatus.marks.find((m) => m.item === 'tower');
  if (!mark || mark.slot !== 'stroke' || mark.state !== 'fail' || !exact(mark.color)) problems.push(`status: no stroke mark on tower in fail's exact ${hex(FAIL)}: ${JSON.stringify(s.hallStatus.marks)}`);

  const tower = (x: number, y: number): boolean => s.idsOpen.at(x, y) === 'tower';
  const ring = band(w, h, tower, RING);
  let boundary = 0;
  const edge = band(w, h, tower, 0);
  for (const v of edge) boundary += v;
  const hallMask = new Uint8Array(w * h); const notHall = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (s.idsHall.at(x, y) === 'hall') hallMask[y * w + x] = 1; else notHall[y * w + x] = 1; }
  const nearHall = grow(hallMask, w, h, CLEAR - 1);
  const nearOpen = grow(notHall, w, h, CLEAR - 1);
  const ownedOpen = owned(s.openStatus, w, h);
  const ownedHall = owned(s.hallStatus, w, h);

  // Where the outline goes: the street without the hall, its pixels of the exact fail color.
  let outline = 0; let away = 0; const awayAt: string[] = [];
  let shows = 0; let showsWrong = 0; const showsAt: string[] = [];
  let hiddenRef = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (ownedOpen[i] || !exact(pixel(s.open, x, y))) continue;
    if (!ring[i]) { away++; if (awayAt.length < 3) awayAt.push(`(${x}, ${y})`); continue; }
    outline++;
    if (!nearHall[i] && !ownedHall[i]) {
      shows++;
      const c = pixel(s.hall, x, y);
      if (!exact(c)) { showsWrong++; if (showsAt.length < 3) showsAt.push(`(${x}, ${y}) ${hex(c)}`); }
    }
    if (hallMask[i] && !nearOpen[i]) hiddenRef++;
  }
  // Where it's hidden: every ring pixel 4 px or more inside the hall.
  let hidden = 0; let leaks = 0; const leakAt: string[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!ring[i] || !hallMask[i] || nearOpen[i] || ownedHall[i]) continue;
    hidden++;
    const c = pixel(s.hall, x, y);
    if (deltaEOk(c, FAIL) < 0.1) { leaks++; if (leakAt.length < 3) leakAt.push(`(${x}, ${y}) ${hex(c)}`); }
  }
  console.log(`${ID}: tower boundary ${boundary} px; outline ${outline} px of exact fail without the hall, ${shows} where it shows (${showsWrong} not exact with the hall), ${hiddenRef} where the hall hides it; ${hidden} hidden ring px, ${leaks} within 0.10 of fail`);
  if (outline < 0.5 * boundary) problems.push(`tower: only ${outline} pixels of the exact fail color around it, under half its silhouette's ${boundary} boundary pixels: no exact outline around the object`);
  if (away > 0) problems.push(`tower: ${away} pixels of the exact fail color lie more than ${RING} px from its silhouette, e.g. ${awayAt.join(', ')}`);
  if (shows < 100) problems.push(`tower: only ${shows} outline pixels where the hall doesn't reach (the fixture needs 100)`);
  if (hiddenRef < 30) problems.push(`tower: only ${hiddenRef} outline pixels where the hall hides it (the fixture needs 30)`);
  if (showsWrong > 0) problems.push(`tower: ${showsWrong} of ${shows} outline pixels where it shows aren't the exact ${hex(FAIL)}, e.g. ${showsAt.join(', ')}`);
  if (leaks > 0) problems.push(`tower: the status outline shows where the hall hides it: ${leaks} of ${hidden} hidden pixels within 0.10 OKLab of fail, e.g. ${leakAt.join(', ')}`);
  return problems;
}

describe(`${ID} the fixture`, () => {
  it(`${ID} the fixture tries: the hall hides between a third and three quarters of the tower, whose top shows above it (holds at the base)`, () => {
    requireMetal();
    const docHall = writeJson(out(), 'street-hall', streetDoc({ hall: true, binding: false }));
    const docOpen = writeJson(out(), 'street-open', streetDoc({ hall: false, binding: false }));
    const call = (doc: string): JsonObject => view3dCall({ doc, look: STATUS_LOOK, size: STREET, frames: 1, capture: [0], targets: ['final', 'ids'] });
    const [a, b] = run(builds.bin(), out(), [call(docHall), call(docOpen)]);
    const withHall = readIds(out(), frameAt(framesOf(answered(a!, 'with the hall'), 'with the hall'), 0, 'with'), 'with the hall');
    const without = readIds(out(), frameAt(framesOf(answered(b!, 'without the hall'), 'without the hall'), 0, 'without'), 'without the hall');
    const full = without.count.get('tower') ?? 0;
    const seen = withHall.count.get('tower') ?? 0;
    console.log(`${ID}: the tower covers ${full} px alone and ${seen} px behind the hall`);
    expect(full, 'the tower is on screen').toBeGreaterThan(5_000);
    expect(seen / full, 'the hall hides between a third and three quarters of it').toBeGreaterThan(0.25);
    expect(seen / full, 'the hall hides between a third and three quarters of it').toBeLessThan(0.67);
    expect(withHall.count.get('hall') ?? 0, 'the hall is on screen').toBeGreaterThan(5_000);
  }, 1_800_000);
});

describe(`${ID} at internal scale 0.75 the status outline of a building half behind another is exact where it shows and absent where it's hidden`, () => {
  it(`${ID} the tower's stroke binding draws its outline in fail's exact sRGB where it shows and not where the hall hides it, after the upscale and sharpen, depth-tested`, () => {
    requireMetal();
    expect(problemsOf(draw(builds.bin())), 'the status outline reads exact where it shows and doesn\'t show where it\'s hidden').toEqual([]);
  }, 1_800_000);

  it(`${ID} a planted path that draws status colors before the upscale and sharpen fails`, () => {
    requireMetal();
    const problems = problemsOf(draw(builds.bin(), 'status_before_upscale'));
    expect(problems.length, '--planted status_before_upscale fails the check').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming the tower or the pass order').toMatch(/^(tower|passes):/m);
  }, 1_800_000);

  it(`${ID} a planted path that draws status colors without the depth test fails, naming the hidden pixels`, () => {
    requireMetal();
    const problems = problemsOf(draw(builds.bin(), 'status_without_depth'));
    expect(problems.length, '--planted status_without_depth fails the check').toBeGreaterThan(0);
    expect(problems.join('\n'), 'naming the outline where the hall hides it').toMatch(/^tower: the status outline shows where the hall hides it/m);
  }, 1_800_000);
});
