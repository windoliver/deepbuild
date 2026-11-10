// #1637.4c39d672: "Bounds, not centres: a planted test by element centres drops an element whose edge shows and fails,
// naming the element"
//
// The walk's first frame (`helpers.ts: cityDoc({camera: 'walk'})`, frame 0, 960 × 540). Bench street#31415, 1.8 m
// long across the view, 0.45 m tall, stands 10 m ahead and 2 m right of the camera; bin street#31416, 1.02 m tall and
// at most 0.27 m in radius, stands 6 m ahead on the line from the eye to the bench's centre, so it hides the middle of
// the bench and both its ends show. By a scratch CPU ray cast the ray to the bench's centre meets the bin's 0.22 m core
// first, and about 780 px of the bench's front face show, at both ends; the bench's centre lands at pixel (646, 392).
// No other street item stands within 60 m of the camera on that street.
//
// The shipped path against `occlusion: 'off'` with its object-ID target, in one process: the hashes match; every
// element and item with a pixel in the target is in the shipped kept set; the bench has at least 50 px there, and the
// target at its centre's pixel holds the bin, so the centre is hidden while the edges show.
//
// `--planted occlusion_by_centre` tests each element's centre against the pyramid in place of its conservative screen
// bounds. The bench's centre lies behind the bin, so it drops the bench and fails, naming street#31415. Its run is the
// shipped path's call; occlusion: 'off' is drawn by the shipped program in its own process.
import { describe, it } from 'vitest';
import {
  AC, BENCH_BOX, BENCH_NAME, BIN_NAME, SIZE, cityDoc, failsNaming, frameAt, framesOf, keptBy, none, project, readIds, requireGpu, run, unkept, useGpu, useOut,
  view3dCall, walkCam, writeJson, type Planted,
} from './helpers.ts';

const bin = useGpu();
const dir = useOut();
const EDGE_PX = 50;

function benchProblems(planted?: Planted): string[] {
  const out = dir();
  const doc = writeJson(out, 'city', cityDoc({ camera: 'walk', shadows: false }));
  const call = { doc, size: SIZE, cull_report: true };
  const [shippedReply] = run(bin(), out, [view3dCall(call)], planted);
  const [unculledReply] = run(bin(), out, [view3dCall({ ...call, occlusion: 'off', targets: ['ids'] })]);
  const what = planted ? `--planted ${planted}` : 'the shipped path';
  const a = frameAt(framesOf(shippedReply!, what), 0, what);
  const b = frameAt(framesOf(unculledReply!, "occlusion: 'off'"), 0, "occlusion: 'off'");
  const ids = readIds(out, b, "frame 0, occlusion: 'off'");
  const problems = unkept(keptBy(out, a, 'view', what), ids, 0, what);
  if (!a.hash || a.hash !== b.hash) problems.push(`frame 0: ${what} hashes ${String(a.hash)}, occlusion: 'off' ${String(b.hash)}`);
  if (!planted) {
    const [x, y] = project(walkCam(0), BENCH_BOX.centre);
    const atCentre = ids.at(x, y);
    const px = ids.count.get(BENCH_NAME) ?? 0;
    if (atCentre !== BIN_NAME || px < EDGE_PX) problems.push(`frame 0: ${BENCH_NAME} has ${px} px and its centre's pixel (${Math.floor(x)}, ${Math.floor(y)}) shows ${atCentre ?? 'nothing'}, not ${BIN_NAME}: the fixture is wrong`);
  }
  return problems;
}

describe(`${AC[3]} elements are tested by their bounds, not their centres`, () => {
  it(`${AC[3]} the bench whose centre the bin hides and whose ends show is kept, and the frame equals occlusion: 'off''s`, () => {
    requireGpu();
    none(benchProblems(), 'the bench at frame 0');
  }, 3_600_000);

  it(`${AC[3]} a planted test by element centres (--planted occlusion_by_centre) drops the bench whose edge shows, and fails naming the element`, () => {
    requireGpu();
    none(benchProblems(), 'the shipped program at frame 0');
    failsNaming(benchProblems('occlusion_by_centre'), [`element ${BENCH_NAME} `], '--planted occlusion_by_centre');
  }, 3_600_000);
});
