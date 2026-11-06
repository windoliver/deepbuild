// #484.31f1249b: "Instancers draw from counts the GPU wrote: a forest of 100,000 trees, culled on the GPU for the view
// and each of 4 cascades, draws by indexed indirect draws with no count read back; over a 10 s orbit every frame equals
// by pixel hash on one machine the frame drawn from the CPU's f64 cull of the same elements, and the GPU's kept set
// always contains the CPU's; a seek from 10 s back to 2 s draws what playing draws; the worker culls no element on the
// CPU, by its counter; and a planted cull that tests element centers instead of bounds drops a tree whose crown enters
// the frame, and a planted path that reads the count back draws the previous frame's count after the seek, each
// failing, naming the element or the frame"
//
// The forest is `helpers.ts: forest`. The orbit is sampled at 6 frames a second: frames 0 to 60, t = n ÷ 6 s, all of
// 0 to 10 s, 61 full frames at 960 × 540 (README: Readings). Three `view3d` calls in one process, so one machine:
//
//   plain     the shipped path, with `counts`, no cull report: it plays frames 0 to 60, seeks from frame 60 (10 s) to
//             frame 12 (2 s) in the same session (`seeks`) and draws that frame; its counters are the proof of no read
//             back and no CPU cull, with nothing else reading the cull's buffers
//   reported  the shipped path with `cull_report`: what the GPU kept, per view and cascade
//   cpu       `cull: 'cpu'`, the same document drawn from the CPU's f64 cull, with `cull_report`: what it kept
//
// Every frame's pixel hash in `plain` and `reported` equals `cpu`'s. In each of the five views the GPU's kept set holds
// all of the CPU's, and neither keeps every tree (a cull that keeps all would pass the rest). `plain` has one indirect
// draw per batch for the view at every frame, and for each cascade at frame 0, its `cpu_culled` and `counts_read_back`
// are 0 at every frame, and frame 0 draws 4 shadow maps; `cpu` reports `cpu_culled` of at least one full pass over the
// trees at every frame, so the two paths are two paths. The seek's frame hashes as playing's frame 12 did, and frame
// 12 keeps more trees than frame 60, which is what lets a stale count show. The crown tree's pixel names it at frame 0.
//
// `--planted gpu_cull_by_center` fails naming the crown tree and frame 0. `--planted count_read_back` fails naming
// frame 12. Each plant's run is the same call as its control's, so only the plant differs.
import { describe, expect, it } from 'vitest';
import {
  AC, CROWN_TREE, FOREST_SIZE, ORBIT, TREES, VIEWS, failsNaming, forest, frameAt, framesOf, keptIn, none, requireGpu, run, useGpu, useOut, view3dCall, writeJson,
  type Click, type Drawn, type Planted,
} from './helpers.ts';

const bin = useGpu();
const dir = useOut();
const SIZE = FOREST_SIZE;
const TEN_S = 60;
const TWO_S = 12;
const SEEK = { after: TEN_S, to: TWO_S };
/** One indirect draw per (prototype, material) batch: oak and pine. */
const BATCHES = 2;

const crownClick = (): Click => { const [x, y] = forest().crownPixel; return { frame: 0, at: [x + 0.5, y + 0.5] }; };
const crownSentence = (got: string | null | undefined): string => {
  const [x, y] = forest().crownPixel;
  return `frame 0, pixel (${x}, ${y}): the crown of trees#${CROWN_TREE} enters the frame there, but the click names ${got ?? 'nothing'}`;
};

/** Where the GPU's kept set misses what the CPU's keeps, in each view; each sentence names the frame and the element. */
function missing(out: string, gpu: Drawn, cpu: Drawn): string[] {
  const problems: string[] = [];
  for (const view of VIEWS) {
    const kept = new Set(keptIn(out, gpu, 'trees', view, 'the GPU cull'));
    const wanted = keptIn(out, cpu, 'trees', view, 'the CPU cull');
    for (const id of wanted) if (!kept.has(id)) problems.push(`frame ${gpu.frame}, ${view}: element trees#${id}, which the CPU's f64 cull keeps, isn't in the GPU's kept set`);
    if (kept.size >= TREES) problems.push(`frame ${gpu.frame}, ${view}: the GPU cull keeps all ${TREES} trees, so it culled nothing`);
    if (wanted.length >= TREES) problems.push(`frame ${gpu.frame}, ${view}: the CPU cull keeps all ${TREES} trees, so it culled nothing`);
  }
  return problems;
}

/** The hash of each drawn frame by its number, the first time it drew. */
const hashes = (frames: Drawn[]): Map<number, string | null> => {
  const m = new Map<number, string | null>();
  for (const f of frames) if (!m.has(f.frame)) m.set(f.frame, f.hash);
  return m;
};

function orbitProblems(): string[] {
  const out = dir();
  const doc = writeJson(out, 'forest', forest().doc);
  const base = { doc, size: SIZE, fps: ORBIT.fps, capture: 'every' as const };
  const [plainReply, reportedReply, cpuReply] = run(bin(), out, [
    view3dCall({ ...base, frames: ORBIT.frames + 1, seeks: [SEEK], counts: true, cascades: true, clicks: [crownClick()] }),
    view3dCall({ ...base, frames: ORBIT.frames, cull_report: true }),
    view3dCall({ ...base, frames: ORBIT.frames, counts: true, cull: 'cpu', cull_report: true }),
  ]);
  const plain = framesOf(plainReply!, 'the shipped path');
  const reported = framesOf(reportedReply!, 'the shipped path, reporting');
  const cpu = framesOf(cpuReply!, 'the CPU cull');
  expect(plain.length, `frames 0 to ${TEN_S}, then the seek's frame`).toBe(ORBIT.frames + 1);
  const problems: string[] = [];
  const [plainHash, reportedHash] = [hashes(plain), hashes(reported)];
  for (let n = 0; n < ORBIT.frames; n++) {
    const c = frameAt(cpu, n, 'the CPU cull');
    const p = frameAt(plain, n, 'the shipped path');
    if (!c.hash) problems.push(`frame ${n}: the CPU cull's frame has no pixel hash`);
    if (plainHash.get(n) !== c.hash) problems.push(`frame ${n}: the GPU's frame hashes ${String(plainHash.get(n))}, the CPU cull's ${String(c.hash)}`);
    if (reportedHash.get(n) !== c.hash) problems.push(`frame ${n}: the GPU's frame, reporting its cull, hashes ${String(reportedHash.get(n))}, the CPU cull's ${String(c.hash)}`);
    problems.push(...missing(out, frameAt(reported, n, 'the shipped path, reporting'), c));
    if (p.cpuCulled !== 0) problems.push(`frame ${n}: the worker's cpu_culled is ${String(p.cpuCulled)}, not 0`);
    if (p.countsReadBack !== 0) problems.push(`frame ${n}: counts_read_back is ${String(p.countsReadBack)}, not 0`);
    if ((c.cpuCulled ?? 0) < TREES) problems.push(`frame ${n}: cull: 'cpu' reports cpu_culled ${String(c.cpuCulled)}, under one pass over the ${TREES} trees, so it isn't the CPU's cull`);
    const inView = (p.indirect ?? []).filter((d) => d.item === 'trees' && d.view === 'view');
    if (inView.length !== BATCHES) problems.push(`frame ${n}: ${inView.length} indirect draws of trees in the view, not one per batch (${BATCHES})`);
  }
  const first = frameAt(plain, 0, 'the shipped path');
  if (first.maps !== 4) problems.push(`frame 0: ${String(first.maps)} shadow maps drawn, not 4 cascades`);
  for (const view of VIEWS.slice(1)) {
    const draws = (first.indirect ?? []).filter((d) => d.item === 'trees' && d.view === view);
    if (draws.length !== BATCHES) problems.push(`frame 0: ${draws.length} indirect draws of trees in ${view}, not one per batch (${BATCHES})`);
  }
  if (first.clicks[0] !== `trees#${CROWN_TREE}`) problems.push(crownSentence(first.clicks[0]));
  const after = plain[ORBIT.frames]!;
  if (after.frame !== TWO_S) problems.push(`the frame after the seek is frame ${after.frame}, not ${TWO_S}`);
  if (after.hash !== plainHash.get(TWO_S)) problems.push(`frame ${TWO_S} (2 s), after the seek from frame ${TEN_S} (10 s): it hashes ${String(after.hash)}, playing's ${String(plainHash.get(TWO_S))}`);
  const [at2, at10] = [TWO_S, TEN_S].map((n) => keptIn(out, frameAt(cpu, n, 'the CPU cull'), 'trees', 'view', 'the CPU cull').length);
  if (at2! <= at10!) problems.push(`the view keeps ${at2} trees at 2 s and ${at10} at 10 s, so a stale count couldn't show: the fixture is wrong`);
  return problems;
}

/** Frame 0 alone: what the GPU kept against the CPU's, and the crown tree's click. */
function crownProblems(planted?: Planted): string[] {
  const out = dir();
  const doc = writeJson(out, 'forest', forest().doc);
  const [cpu] = run(bin(), out, [view3dCall({ doc, size: SIZE, cull: 'cpu', cull_report: true })]);
  const [gpu] = run(bin(), out, [view3dCall({ doc, size: SIZE, cull_report: true, clicks: [crownClick()] })], planted);
  const g = frameAt(framesOf(gpu!, 'the GPU cull'), 0, 'the GPU cull');
  const problems = missing(out, g, frameAt(framesOf(cpu!, 'the CPU cull'), 0, 'the CPU cull'));
  if (g.clicks[0] !== `trees#${CROWN_TREE}`) problems.push(crownSentence(g.clicks[0]));
  return problems;
}

/** The hash of the frame a seek from 10 s to 2 s draws; the run opens at 10 s, so the frame before the seek is that frame. */
function afterSeek(planted?: Planted): string | null {
  const out = dir();
  const doc = writeJson(out, 'forest', forest().doc);
  const [reply] = run(bin(), out, [view3dCall({ doc, size: SIZE, fps: ORBIT.fps, from: TEN_S, frames: 2, seeks: [SEEK] })], planted);
  const f = framesOf(reply!, 'the seek');
  expect(f.map((x) => x.frame), 'the run draws frame 60, then frame 12').toEqual([TEN_S, TWO_S]);
  return f[1]!.hash;
}

describe(`${AC[1]} instancers draw from counts the GPU wrote`, () => {
  it(`${AC[1]} 100,000 trees culled on the GPU for the view and 4 cascades draw by indirect draws with no count read back; over the orbit every frame equals the CPU cull's by pixel hash, the GPU's kept set holds the CPU's, a seek from 10 s to 2 s draws what playing draws, and the worker culls nothing`, () => {
    requireGpu();
    none(orbitProblems(), 'the forest over the orbit');
  }, 3_600_000);

  it(`${AC[1]} a planted cull that tests element centers instead of bounds (--planted gpu_cull_by_center) drops the tree whose crown enters the frame, and fails naming the element and the frame`, () => {
    requireGpu();
    none(crownProblems(), 'the correct cull on frame 0');
    failsNaming(crownProblems('gpu_cull_by_center'), [`frame 0`, `trees#${CROWN_TREE}`], '--planted gpu_cull_by_center');
  }, 3_600_000);

  it(`${AC[1]} a planted path that reads the count back (--planted count_read_back) draws the previous frame's count after the seek, and fails naming the frame`, () => {
    requireGpu();
    const want = afterSeek();
    expect(want, 'the seek\'s frame has a pixel hash').toBeTruthy();
    const got = afterSeek('count_read_back');
    const problems = got === want ? [] : [`frame ${TWO_S} (2 s), after the seek from frame ${TEN_S} (10 s): it hashes ${String(got)}, the correct program's ${String(want)}`];
    failsNaming(problems, [`frame ${TWO_S}`], '--planted count_read_back');
  }, 3_600_000);
});
