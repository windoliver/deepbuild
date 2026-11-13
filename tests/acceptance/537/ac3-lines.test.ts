// AC3 #537.04600c21: 3D lines read logic arrays: a `mark.line` in segments mode whose points read a 64-element vec3 array
// draws 32 segments whose ends sit at the array's values at t, projected within 0.5 px at 20 sampled steps, the same
// frame seeked or played by pixel hash on one machine; after a step that changes only elements 10 and 11, only that row
// range uploads; a NaN at element 7 hides segment 3 alone and raises column.out_of_range, naming the line, row 7 and
// the step; and a planted reader that takes the previous step's array draws a moved segment at its old place and fails,
// naming the segment
//
// `links` (fixtures.ts), 4 px wide in the look's `sand`, reads `laser.points` (programs.ts `lineProgram`): every point
// moves at every step up to 99; step 100 moves segment 5 alone (elements 10 and 11) 1.5 m along +z; element 7 is NaN at
// steps 120 to 129. `view3d` draws it from straight above, 40 m across 800 px (20 px a metre), at 60 fps. Each frame's
// segments are `counts`' `segments.links` (world m, a hidden one null), projected here and held to the array's values
// projected; that each is drawn is its midpoint's pixel in the final target, against the empty sky's. The uploads are
// `counts`' `row_uploads.links`. The issue is `eval`'s at the step, through `deep-show` (README: The surface under test).
import { describe, expect, it } from 'vitest';
import { MOVED_SEGMENT, NAN_ELEMENT, NAN_FROM, NAN_SEGMENT, ONLY_10_11, SAMPLED, SEGMENTS, lineProgram, pointAt } from './programs.ts';
import { LINE_SIZE, LINE_TARGET, LINE_WIDTH_M, lineAgent, lineSession } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, arr, at, binOf, codeOff, countsEntry, evalCall, failsNaming, finalOf, frameAt, framesOf, issuesOf, namedIn, names,
  none, num, pixel, prebuild, presented, putAsset, putEvidence, requireMetal, runGpu, runShow, scenario, show, showCall, topDownPx,
  useTemp, view3dCall, writeJson, type Frame, type Image, type JsonObject, type JsonValue, type Planted, type V3,
} from './helpers.ts';

prebuild(['deep-gpu', 'deep-show']);
const temp = useTemp();

/** The play draws steps 0 to 130; the sampled steps, step 100 and step 120 are captured. */
const PLAYED = 131;
/** The tolerance the criterion gives on screen. */
const PX = 0.5;
const project = (p: V3): [number, number] => topDownPx(LINE_SIZE, LINE_TARGET, LINE_WIDTH_M, p[0], p[2]);
/** A pixel no segment ever reaches: the empty sky. */
const SKY: [number, number] = [4, 4];
const v3 = (v: JsonValue | undefined, what: string): V3 => {
  const a = arr(v, what);
  expect(a.length, `${what} is [x, y, z]`).toBe(3);
  return a.map((x, i) => num(x, `${what}[${i}]`)) as V3;
};

/** Step k's frame: each segment's reported ends against the array's values (projected, within 0.5 px), drawn at its
 * midpoint; a segment with a NaN end null and not drawn. Each failure names its segment. */
function segmentFailures(f: Frame, im: Image, k: number, what: string): string[] {
  const out: string[] = [];
  const list = countsEntry(f, 'segments', 'links', what);
  const rows = arr(list, `${what}: step ${k}'s segments.links`);
  if (rows.length !== SEGMENTS) return [`step ${k}: ${rows.length} segments reported for links, not ${SEGMENTS}`];
  const sky = pixel(im, ...SKY);
  for (let s = 0; s < SEGMENTS; s++) {
    const [a, b] = [pointAt(2 * s, k), pointAt(2 * s + 1, k)];
    const hidden = [...a, ...b].some(Number.isNaN);
    const mid = project(hidden ? [Number.isNaN(a[0]) ? b[0] - 2 : a[0] + 2, 0, a[2]] : [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2]);
    const shown = codeOff(pixel(im, ...mid), sky) > 40;
    if (hidden) {
      if (rows[s] !== null) out.push(`step ${k}: segment ${s} meets NaN element ${NAN_ELEMENT} and is reported ${show(rows[s])}, not hidden (null)`);
      if (shown) out.push(`step ${k}: segment ${s} meets NaN element ${NAN_ELEMENT} and is drawn at its midpoint, px (${mid.map((x) => x.toFixed(1)).join(', ')})`);
      continue;
    }
    if (rows[s] === null) { out.push(`step ${k}: segment ${s} is hidden (null), though both its ends are numbers`); continue; }
    const ends = arr(rows[s], `${what}: step ${k}'s segment ${s}`);
    const [ra, rb] = [v3(ends[0], `segment ${s}'s first end`), v3(ends[1], `segment ${s}'s second end`)];
    for (const [got, want, end] of [[ra, a, 'first'], [rb, b, 'second']] as const) {
      const [g, w] = [project(got), project(want)];
      const off = Math.hypot(g[0] - w[0], g[1] - w[1]);
      if (!(off <= PX)) out.push(`step ${k}: segment ${s}'s ${end} end sits ${off.toFixed(3)} px from the array's value at the step (${JSON.stringify(got)} for ${JSON.stringify(want)})`);
    }
    if (!shown) out.push(`step ${k}: segment ${s} isn't drawn at its midpoint, px (${mid.map((x) => x.toFixed(1)).join(', ')}): the frame shows the sky's ${JSON.stringify(sky)} there`);
  }
  return out;
}
interface Run { out: string; played: Frame[]; seeked: Frame[] }
/** One `deep-gpu run`: the line played from step 0, and (unless `playOnly`) seeked backwards from step 95 to 0, 5 at a time. */
function lineRun(planted?: Planted, frames = PLAYED, playOnly = false): Run {
  requireMetal();
  const out = temp();
  const program = lineProgram();
  const assets = putAsset(out, program.bytes, 'wasm');
  const doc = writeJson(out, 'links', lineSession(program));
  const what = `AC3 the line${planted ? ` (planted ${planted})` : ''}`;
  const back = [...SAMPLED].reverse();
  const replies = runGpu(binOf('deep-gpu'), out, [
    view3dCall({ doc, size: LINE_SIZE, frames, capture: [...SAMPLED, ONLY_10_11, NAN_FROM].filter((k) => k < frames), targets: ['final'], counts: true, assets }),
    ...(playOnly ? [] : [view3dCall({
      doc, size: LINE_SIZE, from: back[0]!, frames: back.length, seeks: back.slice(0, -1).map((k, i) => ({ after: k, to: back[i + 1]! })),
      capture: 'every', targets: ['final'], counts: true, assets,
    })]),
  ], what, planted);
  return { out, played: framesOf(replies[0]!, `${what}, played`), seeked: playOnly ? [] : framesOf(replies[1]!, `${what}, seeked`) };
}

describe(`${AC[3]} a 3D line in segments mode whose points read a logic vec3 array`, () => {
  it(`${AC[3]} 32 segments sit at the array's values within 0.5 px at 20 sampled steps, seeked as played by pixel hash`, () => {
    const run = lineRun();
    const failures: string[] = [];
    for (const k of SAMPLED) {
      const p = frameAt(run.played, k, 'played');
      const s = frameAt(run.seeked, k, 'seeked');
      failures.push(...segmentFailures(p, finalOf(run.out, p, 'played'), k, 'played'));
      failures.push(...segmentFailures(s, finalOf(run.out, s, 'seeked'), k, 'seeked'));
      if (p.hash === null || p.hash !== s.hash) failures.push(`step ${k}: the seeked frame's pixel hash ${s.hash} isn't the played one's ${p.hash}`);
    }
    expect(run.seeked.map((f) => f.frame), 'the seeked session draws steps 95, 90, … 0').toEqual([...SAMPLED].reverse());
    none(failures, 'the line at the 20 sampled steps, played and seeked');
  }, TIMEOUT);

  it(`${AC[3]} after the step that changes only elements 10 and 11, only that row range uploads`, () => {
    const run = lineRun(undefined, ONLY_10_11 + 1, true);
    for (let j = 0; j < 64; j++) {
      const changed = JSON.stringify(pointAt(j, ONLY_10_11)) !== JSON.stringify(pointAt(j, ONLY_10_11 - 1));
      expect(changed, `the fixture: step 100 changes element ${j} ${j === 10 || j === 11 ? '' : 'not '}`).toBe(j === 10 || j === 11);
    }
    const f = frameAt(run.played, ONLY_10_11, 'played');
    const rows = arr(countsEntry(f, 'row_uploads', 'links', 'played') ?? [], 'step 100\'s row_uploads.links').map((r) => num(r, 'an uploaded row'));
    expect([...rows].sort((a, b) => a - b), `step 100 uploads rows 10 and 11 of the line's points, and no other: ${show(f.raw['row_uploads'])}`).toEqual([10, 11]);
    none(segmentFailures(f, finalOf(run.out, f, 'played'), ONLY_10_11, 'played'), 'the line at step 100');
  }, TIMEOUT);

  it(`${AC[3]} a NaN at element 7 hides segment 3 alone and raises column.out_of_range, naming the line, row 7 and the step`, () => {
    const run = lineRun(undefined, NAN_FROM + 1, true);
    const f = frameAt(run.played, NAN_FROM, 'played');
    none(segmentFailures(f, finalOf(run.out, f, 'played'), NAN_FROM, 'played'), `the line at step ${NAN_FROM}: segment ${NAN_SEGMENT} hidden, the other 31 drawn at their values`);

    const ev = temp();
    const program = lineProgram();
    putEvidence(ev, program.bytes);
    const [shown, before, atNan] = runShow(binOf('deep-show'), scenario(ev, [DOC(1)], [
      showCall(DOC(1), lineAgent(program)), evalCall(DOC(1), at(NAN_FROM - 1)), evalCall(DOC(1), at(NAN_FROM)),
    ]), 'AC3 the line\'s issues');
    presented(shown!, 'the line');
    const raised = (r: JsonObject, w: string): JsonObject[] => {
      expect(r['outcome'], `${w} is evaluated: ${show(r)}`).toBe('evaluated');
      return issuesOf(r).filter((i) => i['code'] === 'column.out_of_range' && names(namedIn(i), 'links'));
    };
    expect(raised(before!, `eval at step ${NAN_FROM - 1}`), `no column.out_of_range names the line at step ${NAN_FROM - 1}`).toEqual([]);
    const found = raised(atNan!, `eval at step ${NAN_FROM}`);
    expect(found.some((i) => i['row'] === NAN_ELEMENT && i['step'] === NAN_FROM),
      `eval at step ${NAN_FROM} raises column.out_of_range naming the line links, row ${NAN_ELEMENT} and step ${NAN_FROM}: ${show(issuesOf(atNan!), 2500)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[3]} planted line_reads_previous_step draws the moved segment at its old place and fails, naming the segment`, () => {
    const run = lineRun('line_reads_previous_step', ONLY_10_11 + 1, true);
    const f = frameAt(run.played, ONLY_10_11, 'played');
    failsNaming(segmentFailures(f, finalOf(run.out, f, 'played'), ONLY_10_11, 'played under the plant'), [new RegExp(`segment ${MOVED_SEGMENT}[ '’]`)], 'the line at step 100 under line_reads_previous_step');
  }, TIMEOUT);
});
