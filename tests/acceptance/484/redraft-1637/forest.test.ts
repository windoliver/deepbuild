// #484.31f1249b, redrafted for #1637 (REDRAFT.md): "Instancers draw from counts the GPU wrote: a forest of 100,000
// trees, culled on the GPU for the view and each of 4 cascades, draws by indexed indirect draws with no count read back;
// over a 10 s orbit every frame equals by pixel hash on one machine the frame drawn from the CPU's f64 cull of the same
// elements, and the GPU's kept set always contains the CPU's; a seek from 10 s back to 2 s draws what playing draws; the
// worker culls no element on the CPU, by its counter; and a planted cull that tests element centers instead of bounds
// drops a tree whose crown enters the frame, and a planted path that reads the count back draws the previous frame's
// count after the seek, each failing, naming the element or the frame"
//
// #1637 lands after #484: with occlusion on, the default, the camera pass's kept set is the frustum cull further culled
// by a depth pyramid from this frame's prepass, so it rightly omits trees other trees hide. Cascades keep their own
// sets. A view3d call with `occlusion: 'off'` draws the same frame, its camera kept set the frustum cull alone. So the
// camera's "kept set holds the CPU's" is held on an `occlusion: 'off'` call; everything else stays on the shipped default.
//
// The forest is `../helpers.ts: forest`. The orbit is sampled at 6 frames a second: frames 0 to 60, t = n ÷ 6 s, all of
// 0 to 10 s, 61 full frames at 960 × 540 (README: Readings). Four `view3d` calls on one machine, two per process:
//
//   plain     the shipped default (occlusion on), with `counts`, no cull report: it plays frames 0 to 60, seeks from
//             frame 60 (10 s) to frame 12 (2 s) in the same session (`seeks`) and draws that frame; its counters are
//             the proof of no read back and no CPU cull, with nothing else reading the cull's buffers
//   reported  the shipped default with `cull_report`: what the GPU kept for each cascade
//   off       `occlusion: 'off'` with `cull_report`: the GPU's frustum cull alone, per view and cascade
//   cpu       `cull: 'cpu'`, `occlusion: 'off'`: the same document drawn from the CPU's f64 cull and nothing else, with
//             `cull_report`: what it kept
//
// Every frame's pixel hash in `plain`, `reported` and `off` equals `cpu`'s. In each of the five views `off`'s kept set
// holds all of the CPU's, and in each of the four cascades `reported`'s does; neither side keeps every tree in any view
// it is compared in (a cull that keeps all would pass the rest). `plain` has one indirect draw per batch for the view at
// every frame, and for each cascade at frame 0, its `cpu_culled` and `counts_read_back` are 0 at every frame, and frame
// 0 draws 4 shadow maps; `cpu` reports `cpu_culled` of at least one full pass over the trees at every frame, so the two
// paths are two paths. The seek's frame hashes as playing's frame 12 did, and frame 12 keeps more trees than frame 60,
// which is what lets a stale count show. The crown tree's pixel names it at frame 0.
//
// `--planted gpu_cull_by_center` fails naming the crown tree and frame 0, on the `occlusion: 'off'` call's view and on
// both calls' clicks. Each plant's run is the same calls as its control's, so only the plant differs. The frozen file's
// third test (`--planted count_read_back`) is unaffected by #1637 and isn't redrafted here.
import { describe, expect, it } from 'vitest';
import {
  AC, CROWN_TREE, FOREST_SIZE, ORBIT, TREES, VIEWS, failsNaming, forest, frameAt, framesOf, keptIn, none, requireGpu, run, useGpu, useOut, view3dCall, writeJson,
  type Click, type Drawn, type JsonObject, type Planted, type View3d,
} from '../helpers.ts';

const bin = useGpu();
const dir = useOut();
const SIZE = FOREST_SIZE;
const TEN_S = 60;
const TWO_S = 12;
const SEEK = { after: TEN_S, to: TWO_S };
/** One indirect draw per (prototype, material) batch: oak and pine. */
const BATCHES = 2;
/** The key sun's four cascades: #1637 leaves their kept sets alone, so they're held at the shipped default. */
const CASCADES = VIEWS.slice(1);

/** #1637's field on a view3d call: `'off'` draws the same frame with no occlusion cull. Absent, occlusion is on. */
type Call = View3d & { occlusion?: 'off' };
const call = (v: Call): JsonObject => view3dCall(v);

const crownClick = (): Click => { const [x, y] = forest().crownPixel; return { frame: 0, at: [x + 0.5, y + 0.5] }; };
const crownSentence = (path: string, got: string | null | undefined): string => {
  const [x, y] = forest().crownPixel;
  return `frame 0, pixel (${x}, ${y}), ${path}: the crown of trees#${CROWN_TREE} enters the frame there, but the click names ${got ?? 'nothing'}`;
};

/** Where the GPU's kept set misses what the CPU's keeps, in each of `views`; each sentence names the frame and the element. */
function missing(out: string, gpu: Drawn, cpu: Drawn, views: readonly string[], path: string): string[] {
  const problems: string[] = [];
  for (const view of views) {
    const kept = new Set(keptIn(out, gpu, 'trees', view, `the GPU cull, ${path}`));
    const wanted = keptIn(out, cpu, 'trees', view, 'the CPU cull');
    for (const id of wanted) if (!kept.has(id)) problems.push(`frame ${gpu.frame}, ${view}: element trees#${id}, which the CPU's f64 cull keeps, isn't in the GPU's kept set (${path})`);
    if (kept.size >= TREES) problems.push(`frame ${gpu.frame}, ${view}: the GPU cull (${path}) keeps all ${TREES} trees, so it culled nothing`);
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
  const [plainReply, reportedReply] = run(bin(), out, [
    call({ ...base, frames: ORBIT.frames + 1, seeks: [SEEK], counts: true, cascades: true, clicks: [crownClick()] }),
    call({ ...base, frames: ORBIT.frames, cull_report: true }),
  ]);
  const [offReply, cpuReply] = run(bin(), out, [
    call({ ...base, frames: ORBIT.frames, cull_report: true, occlusion: 'off' }),
    call({ ...base, frames: ORBIT.frames, counts: true, cull: 'cpu', cull_report: true, occlusion: 'off' }),
  ]);
  const plain = framesOf(plainReply!, 'the shipped path');
  const reported = framesOf(reportedReply!, 'the shipped path, reporting');
  const off = framesOf(offReply!, 'the GPU cull with occlusion off');
  const cpu = framesOf(cpuReply!, 'the CPU cull');
  expect(plain.length, `frames 0 to ${TEN_S}, then the seek's frame`).toBe(ORBIT.frames + 1);
  const problems: string[] = [];
  const [plainHash, reportedHash, offHash] = [hashes(plain), hashes(reported), hashes(off)];
  for (let n = 0; n < ORBIT.frames; n++) {
    const c = frameAt(cpu, n, 'the CPU cull');
    const p = frameAt(plain, n, 'the shipped path');
    if (!c.hash) problems.push(`frame ${n}: the CPU cull's frame has no pixel hash`);
    if (plainHash.get(n) !== c.hash) problems.push(`frame ${n}: the GPU's frame hashes ${String(plainHash.get(n))}, the CPU cull's ${String(c.hash)}`);
    if (reportedHash.get(n) !== c.hash) problems.push(`frame ${n}: the GPU's frame, reporting its cull, hashes ${String(reportedHash.get(n))}, the CPU cull's ${String(c.hash)}`);
    if (offHash.get(n) !== c.hash) problems.push(`frame ${n}: the GPU's frame with occlusion off hashes ${String(offHash.get(n))}, the CPU cull's ${String(c.hash)}`);
    problems.push(...missing(out, frameAt(off, n, 'the GPU cull with occlusion off'), c, VIEWS, 'occlusion off'));
    problems.push(...missing(out, frameAt(reported, n, 'the shipped path, reporting'), c, CASCADES, 'the shipped default'));
    if (p.cpuCulled !== 0) problems.push(`frame ${n}: the worker's cpu_culled is ${String(p.cpuCulled)}, not 0`);
    if (p.countsReadBack !== 0) problems.push(`frame ${n}: counts_read_back is ${String(p.countsReadBack)}, not 0`);
    if ((c.cpuCulled ?? 0) < TREES) problems.push(`frame ${n}: cull: 'cpu' reports cpu_culled ${String(c.cpuCulled)}, under one pass over the ${TREES} trees, so it isn't the CPU's cull`);
    const inView = (p.indirect ?? []).filter((d) => d.item === 'trees' && d.view === 'view');
    if (inView.length !== BATCHES) problems.push(`frame ${n}: ${inView.length} indirect draws of trees in the view, not one per batch (${BATCHES})`);
  }
  const first = frameAt(plain, 0, 'the shipped path');
  if (first.maps !== 4) problems.push(`frame 0: ${String(first.maps)} shadow maps drawn, not 4 cascades`);
  for (const view of CASCADES) {
    const draws = (first.indirect ?? []).filter((d) => d.item === 'trees' && d.view === view);
    if (draws.length !== BATCHES) problems.push(`frame 0: ${draws.length} indirect draws of trees in ${view}, not one per batch (${BATCHES})`);
  }
  if (first.clicks[0] !== `trees#${CROWN_TREE}`) problems.push(crownSentence('the shipped default', first.clicks[0]));
  const after = plain[ORBIT.frames]!;
  if (after.frame !== TWO_S) problems.push(`the frame after the seek is frame ${after.frame}, not ${TWO_S}`);
  if (after.hash !== plainHash.get(TWO_S)) problems.push(`frame ${TWO_S} (2 s), after the seek from frame ${TEN_S} (10 s): it hashes ${String(after.hash)}, playing's ${String(plainHash.get(TWO_S))}`);
  const [at2, at10] = [TWO_S, TEN_S].map((n) => keptIn(out, frameAt(cpu, n, 'the CPU cull'), 'trees', 'view', 'the CPU cull').length);
  if (at2! <= at10!) problems.push(`the view keeps ${at2} trees at 2 s and ${at10} at 10 s, so a stale count couldn't show: the fixture is wrong`);
  return problems;
}

/** Frame 0 alone: what the GPU kept against the CPU's, with occlusion off and at the default, and the crown tree's clicks. */
function crownProblems(planted?: Planted): string[] {
  const out = dir();
  const doc = writeJson(out, 'forest', forest().doc);
  const [cpu] = run(bin(), out, [call({ doc, size: SIZE, cull: 'cpu', cull_report: true, occlusion: 'off' })]);
  const [offReply, shippedReply] = run(bin(), out, [
    call({ doc, size: SIZE, cull_report: true, occlusion: 'off', clicks: [crownClick()] }),
    call({ doc, size: SIZE, cull_report: true, clicks: [crownClick()] }),
  ], planted);
  const c = frameAt(framesOf(cpu!, 'the CPU cull'), 0, 'the CPU cull');
  const off = frameAt(framesOf(offReply!, 'the GPU cull with occlusion off'), 0, 'the GPU cull with occlusion off');
  const shipped = frameAt(framesOf(shippedReply!, 'the shipped default'), 0, 'the shipped default');
  const problems = [...missing(out, off, c, VIEWS, 'occlusion off'), ...missing(out, shipped, c, CASCADES, 'the shipped default')];
  if (off.clicks[0] !== `trees#${CROWN_TREE}`) problems.push(crownSentence('occlusion off', off.clicks[0]));
  if (shipped.clicks[0] !== `trees#${CROWN_TREE}`) problems.push(crownSentence('the shipped default', shipped.clicks[0]));
  return problems;
}

describe(`${AC[1]} instancers draw from counts the GPU wrote (redraft 1637)`, () => {
  it(`${AC[1]} 100,000 trees culled on the GPU for the view and 4 cascades draw by indirect draws with no count read back; over the orbit every frame equals the CPU cull's by pixel hash, the GPU's frustum kept set (occlusion off) holds the CPU's in the view and the shipped default's in each cascade, a seek from 10 s to 2 s draws what playing draws, and the worker culls nothing (redraft 1637)`, () => {
    requireGpu();
    none(orbitProblems(), 'the forest over the orbit');
  }, 3_600_000);

  it(`${AC[1]} a planted cull that tests element centers instead of bounds (--planted gpu_cull_by_center) drops the tree whose crown enters the frame, and fails naming the element and the frame (redraft 1637)`, () => {
    requireGpu();
    none(crownProblems(), 'the correct cull on frame 0');
    failsNaming(crownProblems('gpu_cull_by_center'), [`frame 0`, `trees#${CROWN_TREE}`], '--planted gpu_cull_by_center');
  }, 3_600_000);
});
