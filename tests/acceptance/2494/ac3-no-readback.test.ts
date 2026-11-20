// AC3: a played 3D frame in the app makes no read-back buffer: counted on the app's device, and a planted view that
// reads every frame back fails, naming the count.
//
// The same path as AC2 (`deep show` to a real hub, the hub's presentation handed as it came to the app's canvas
// panel in the app's real window), with no capture, so the fixture reads nothing back itself. The document's box
// slides for the whole of its 60 s span, so every frame the view draws is a new one for the 12 s the window runs.
//
// What is read (README: The surface under test). Each frame of the window lists the slots it painted, each with the
// view frame it holds (`frame_seq`) and its handoff (`path`), and gives `readback_buffers`: the read-back buffers
// the app's device has made since the app started, by the counted device's count. The frames played are the
// distinct view frames the window showed from the frame after the first that painted the layer's slot, when the
// view is built, to the last. Over those frames the count must not move, and the slot's handoff must be zero copy:
// the copy path reads every frame back through memory, which the Scope rules out on the live path.
//
// The wrong program, DEEP_CANVAS_PLANT=reads_every_frame_back (a `canvas-fixture` build reads it): the view reads
// every frame it draws back, a read-back buffer made for each, as the base's `deep-show` does. The same check fails
// on it and its failure names the count, which is one for each frame played.
//
// On the merge base the app plays no 3D frame at all: no frame paints a slot, and both tests fail there.
import { describe, expect, it } from 'vitest';
import type { TestContext } from 'vitest';
import {
  AC3, canvas, onlyOnMacos, played, presentation, proof, readbackFailures, readbacksMade, useApp, useShown, type Played, type Report,
} from './helpers.ts';

const app = useApp();
const shown = useShown();

const RUN_MS = 12_000;
/** A window that drew fewer frames than this in the run was starved, and the count is not judged. */
const MIN_FRAMES = 120;
/** The count is judged over at least this many played frames. */
const MIN_PLAYED = 60;
const PLANT = 'reads_every_frame_back';
/** A view's ring holds three slots, so up to three frames shown after the count's first reading were drawn before it. */
const AHEAD = 3;

/** The frames the run played for `layer`: fails when it played none, skips INCONCLUSIVE when it played too few to judge. */
function playedIn(ctx: TestContext, report: Report, layer: string, what: string): Played {
  const p = played(report, layer);
  expect(
    p.first,
    `${what}: a 3D frame played in the app: the first of the window's ${report.frames.length} frames that painted a GPU-layer slot for the 3D layer "${layer}" (frames[k].slots)`,
  ).not.toBeNull();
  if (report.frames.length < MIN_FRAMES) ctx.skip(`INCONCLUSIVE: ${what}: the window drew ${report.frames.length} frames in ${RUN_MS} ms, fewer than ${MIN_FRAMES}; the machine starved it`);
  if (p.seqs.length < MIN_PLAYED) {
    ctx.skip(`INCONCLUSIVE: ${what}: the view played ${p.seqs.length} frames in window frames ${p.from} to ${p.to} (its first slot was painted in frame ${p.first}); the count is judged over at least ${MIN_PLAYED}`);
  }
  return p;
}

describe(`${AC3} a played 3D frame in the app makes no read-back buffer: counted on the app's device`, () => {
  it(`${AC3} while the app's panel plays a 3D document, the app's device makes no read-back buffer and the slot is handed off zero copy`, (ctx) => {
    onlyOnMacos(ctx);
    const bin = app();
    const hub = shown();
    const p = presentation(hub);
    const report = canvas(ctx, bin, hub, p, { runMs: RUN_MS });
    proof('ac3-report.json', report.raw);
    const frames = playedIn(ctx, report, p.layer, 'the app');
    const made = readbacksMade(report, frames);
    const failures = readbackFailures(report, frames);
    const counts = { played: frames.seqs.length, window_frames: [frames.from, frames.to], readback_buffers_made: made, paths: frames.paths };
    proof('ac3-counts.json', counts);
    console.log(`PROOF #2494 AC3 the app: ${JSON.stringify(counts)}`);
    expect(failures, `${frames.seqs.length} 3D frames played in window frames ${frames.from} to ${frames.to}`).toEqual([]);
  }, 3_600_000);

  it(`${AC3} planted ${PLANT}: a view that reads every frame back makes a read-back buffer for each frame played, and the check fails, naming the count`, (ctx) => {
    onlyOnMacos(ctx);
    const bin = app();
    const hub = shown();
    const p = presentation(hub);
    const report = canvas(ctx, bin, hub, p, { runMs: RUN_MS, planted: PLANT });
    proof('ac3-planted-report.json', report.raw);
    const frames = playedIn(ctx, report, p.layer, `planted ${PLANT}`);
    const made = readbacksMade(report, frames);
    const failures = readbackFailures(report, frames);
    const counts = { played: frames.seqs.length, window_frames: [frames.from, frames.to], readback_buffers_made: made, paths: frames.paths };
    proof('ac3-planted-counts.json', counts);
    console.log(`PROOF #2494 AC3 planted ${PLANT}: ${JSON.stringify(counts)}`);
    expect(failures.length, `the check fails on the planted view; it played ${frames.seqs.length} frames and the count moved by ${made}`).toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure names the count').toContain(`made ${made} read-back buffers`);
    expect(made, `the planted view reads every frame back: a read-back buffer for each of the ${frames.seqs.length} frames played, less the ${AHEAD} it may have drawn before the count's first reading`).toBeGreaterThanOrEqual(frames.seqs.length - AHEAD);
  }, 3_600_000);
});
