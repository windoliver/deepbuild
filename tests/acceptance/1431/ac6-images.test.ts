// AC6 #1431.46593b19: the session's `images` map with no entry bound fails the lint, naming it. A 1,000-revision run of
// 1 MB images holds `pictures` at the shown count, with gauges within 10 MB of the device's report.
//
// The lint half: this checkout's `crates/deep-marks-render/src/macos.rs` declares the `images` field of `Session` a
// cache with both bounds (README: The cache lint). A scratch checkout holding that file as it is passes
// `node scripts/cache-lint.mjs --root`; the wrong program is the same file with the `images` declaration's entry bound
// taken out and its byte bound kept, which must fail the lint naming `images` at that file.
//
// The run half: the app's own binary in its canvas fixture, in release (`deep-app --canvas`), its one panel handed 1,000
// revisions 100 ms apart, each one layer whose picture is its own 500 × 500 px PNG (1,000,000 B decoded). The panel
// shows one revision at a time, so the shown count is 1: from the first frame that paints a picture to the run's end,
// every frame's `held` (CanvasPanel.pictures) is 1. A reading a second (`read_every_ms: 1000`): each one's gauges on the
// device sum within 10 MB of the device's report (`device`, the allocated size Metal reports), and while a picture is
// shown both hold at least its 1,000,000 B.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APP_BUILD, ID, MB, copyInto, declarationOf, declares, lint, lintRoot, mb, none, onDevice, probeCanvas, putEvidence, picturePng, presented,
  requireMacos, runCanvas, scratch, short, useBuild, withoutEntryBound, REPO,
} from './helpers.ts';

const app = useBuild(APP_BUILD);
const MACOS = 'crates/deep-marks-render/src/macos.rs';
const REVISIONS = 1_000;
const EVERY_MS = 100;
const SIDE = 500;
const PICTURE_BYTES = SIDE * SIDE * 4;
const WINDOW: [number, number] = [600, 600];
const WITHIN = 10 * MB;

/** The line (0-based) of `Session`'s `images` field in macos.rs, as this checkout has it. */
function imagesField(lines: string[]): number {
  const start = lines.findIndex((l) => /^\s*(pub(\([^)]*\))?\s+)?struct\s+Session\b/.test(l));
  expect(start, `${MACOS} holds struct Session`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && /^}/.test(l));
  const field = lines.findIndex((l, i) => i > start && i < end && /^\s*(pub(\([^)]*\))?\s+)?images\s*:/.test(l));
  expect(field, `Session in ${MACOS} holds its images map, the field images`).toBeGreaterThan(start);
  return field;
}

describe(`${ID.ac6} the image holders keep an entry bound, and the panel holds what it shows`, () => {
  it(`${ID.ac6} the session's images map with no entry bound fails the lint, naming it; a 1,000-revision run of 1 MB images holds pictures at the shown count, with gauges within 10 MB of the device's report`, async () => {
    // The lint half.
    const asIs = scratch('d1431-lint-');
    copyInto(asIs, MACOS);
    const passing = lint(asIs);
    expect(passing.fails, `${MACOS} as this checkout has it passes the lint:\n${passing.output}`).toEqual([]);
    expect(passing.status, passing.output).toBe(0);
    const lines = readFileSync(`${REPO}/${MACOS}`, 'utf8').split('\n');
    const field = imagesField(lines);
    const at = declarationOf(lines, field);
    expect(at, `the session's images map (${MACOS}:${field + 1}) declares itself a cache, in a // cache: line on it or just above it`).toBeGreaterThanOrEqual(0);
    expect(declares(lines[at]!, 'entries') && declares(lines[at]!, 'bytes'), `and declares both bounds: ${lines[at]!.trim()}`).toBe(true);
    const stripped = lines.map((l, i) => (i === at ? withoutEntryBound(l) : l));
    console.log(`PROOF ${ID.ac6} the planted images map: ${stripped[at]!.trim()} above ${lines[field]!.trim()}`);
    const planted = lint(lintRoot({ [MACOS]: stripped.join('\n') }));
    console.log(`PROOF ${ID.ac6} the lint on it:\n${planted.output}`);
    expect(planted.status, `the images map with its byte bound and no entry bound fails the lint:\n${planted.output}`).toBe(1);
    expect(planted.fails.filter((f) => f.path === MACOS && [at + 1, field + 1].includes(f.line) && /\bimages\b/.test(f.message)).length, `one FAIL line names images at ${MACOS}:${at + 1} or :${field + 1}:\n${planted.output}`).toBe(1);

    // The run half.
    requireMacos('the app\'s window');
    const bin = app();
    const evidence = scratch();
    await probeCanvas(bin, evidence, 'the probe');
    const pictures = Array.from({ length: REVISIONS }, (_, n) => putEvidence(evidence, picturePng(SIDE, SIDE, n)));
    expect(new Set(pictures).size, 'each revision\'s picture is its own').toBe(REVISIONS);
    const runMs = REVISIONS * EVERY_MS + 3_000;
    const report = await runCanvas(bin, {
      evidence, window: WINDOW, decode_ms: 0, run_ms: runMs, read_every_ms: 1_000,
      revisions: pictures.map((p, i) => ({ at_ms: i * EVERY_MS, presented: presented(i + 1, p, WINDOW) })),
    }, `${REVISIONS} revisions of ${mb(PICTURE_BYTES)} pictures`);

    expect(report.handed.length, 'every revision was handed to the panel').toBe(REVISIONS);
    const first = report.frames.findIndex((f) => f.pictures.length > 0);
    const last = report.frames.findIndex((f) => f.pictures.includes(pictures[REVISIONS - 1]!));
    expect(first, 'a frame paints the first picture').toBeGreaterThanOrEqual(0);
    if (last < 0) expect.fail(`BLOCKED: the run ended before a frame painted the last revision's picture, so the run can't be judged whole (${report.frames.length} frames)`);
    const over = report.frames.filter((f) => f.frame >= first && f.held !== 1);
    console.log(`PROOF ${ID.ac6} held over ${report.frames.length} frames: most ${Math.max(...report.frames.map((f) => f.held ?? 0))}; from the first painted frame ${first}, ${over.length} frames held other than 1`);
    none(over.slice(0, 20).map((f) => `frame ${f.frame} at ${f.at_ms.toFixed(0)} ms holds ${f.held} pictures`), 'from the first frame that paints a picture to the run\'s end, CanvasPanel.pictures holds the shown count, 1');

    const readings = report.readings!;
    expect(readings.length, `a reading a second over the ${(runMs / 1000).toFixed(0)} s run`).toBeGreaterThanOrEqual(Math.floor(runMs / 1000) - 2);
    const firstPainted = report.frames[first]!.at_ms;
    const problems: string[] = [];
    for (const { at_ms, frame, reading } of readings) {
      if (reading.device === null) { problems.push(`at ${at_ms.toFixed(0)} ms (frame ${frame}) the device's report is unknown: ${short(reading.unknown)}`); continue; }
      const gauged = onDevice(reading);
      if (Math.abs(gauged - reading.device) > WITHIN) problems.push(`at ${at_ms.toFixed(0)} ms (frame ${frame}) the gauges on the device sum ${mb(gauged)}, the device reports ${mb(reading.device)}: ${mb(gauged - reading.device)} apart`);
      if (at_ms > firstPainted && (gauged < PICTURE_BYTES || reading.device < PICTURE_BYTES)) problems.push(`at ${at_ms.toFixed(0)} ms a picture is shown, but the gauges on the device sum ${gauged} B and the device reports ${reading.device} B, less than its ${PICTURE_BYTES} B`);
    }
    const lastReading = readings[readings.length - 1]!.reading;
    console.log(`PROOF ${ID.ac6} the last reading: device ${lastReading.device} B, gauges on the device ${onDevice(lastReading)} B: ${short(lastReading.gauges, 3000)}`);
    none(problems.slice(0, 20), `each reading's gauges on the device are within ${mb(WITHIN)} of the device's report (${problems.length} readings miss)`);
  }, 3_600_000);
});
