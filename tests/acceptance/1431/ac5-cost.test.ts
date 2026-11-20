// AC5 #1431.77e19bb8: reading the gauges costs under 1 ms a minute on the reference Mac.
//
// The app's own binary in its canvas fixture, in release (`deep-app --canvas`, the canvas-fixture build), showing a few
// pictures in its real window, takes a reading once a minute (`read_every_ms: 60000`), as the app does, for five
// minutes: a minute's cost is that minute's reading's `gauges_ms`, the time it spent reading the gauges. The first
// reading, at the run's start, is the warm-up; the readings at minutes 1 to 5 are the five runs, judged by the design's
// rule through scripts/benchmark.mjs's judgeLimit with each run's load: PASS only on a reference Mac (Mac15,7, Mac15,12
// or Mac17,10) on mains power, Low Power Mode off, thermal state nominal and unloaded, with all five under 1 ms. Anywhere
// else the five are printed and the test fails INCONCLUSIVE, never passing. A short probe first, so a build without the
// readings fails at once and not after five minutes. The criterion names no wrong program; a reading that reads nothing
// (no footprint, no gauge) isn't a reading of the gauges and fails before it's timed.
import { describe, expect, it } from 'vitest';
import { APP_BUILD, ID, MB, benchmark, load, probeCanvas, putEvidence, picturePng, presented, requireMacos, runCanvas, scratch, short, useBuild } from './helpers.ts';

const app = useBuild(APP_BUILD);
const LIMIT_MS = 1;
const MINUTE_MS = 60_000;
const RUNS = 5;
const WINDOW: [number, number] = [600, 600];

describe(`${ID.ac5} the gauges are cheap to read`, () => {
  it(`${ID.ac5} reading the gauges costs under 1 ms a minute on the reference Mac`, async () => {
    requireMacos('the app\'s window');
    const bin = app();
    const evidence = scratch();
    await probeCanvas(bin, evidence, 'the probe');

    const pictures = [1, 2, 3].map((n) => putEvidence(evidence, picturePng(500, 500, 5_000 + n)));
    const samples: { ms: number; load: number }[] = [{ ms: 0, load: load() }];
    const report = await runCanvas(bin, {
      evidence, window: WINDOW, decode_ms: 0, run_ms: RUNS * MINUTE_MS + 1_000, read_every_ms: MINUTE_MS,
      revisions: pictures.map((p, i) => ({ at_ms: i * 1_000, presented: presented(i + 1, p, WINDOW) })),
    }, 'five minutes of the app', (ms) => { if (ms % 10_000 < 1_000) samples.push({ ms, load: load() }); });

    console.log(`PROOF ${ID.ac5} readings: ${report.readings!.map((r) => `${(r.at_ms / 1000).toFixed(1)} s: gauges_ms ${r.reading.gauges_ms}`).join('; ')}`);
    // The reading of minute m: the one taken at the first frame at or after m minutes, the warm-up's at minute 0.
    const readings = Array.from({ length: RUNS + 1 }, (_, m) => report.readings!.find((r) => r.at_ms >= m * MINUTE_MS && r.at_ms < (m + 1) * MINUTE_MS));
    expect(readings.every((r) => r !== undefined), `a reading at the start and one each minute for ${RUNS} minutes: ${short(report.readings!.map((r) => r.at_ms))}`).toBe(true);
    for (const [i, { reading }] of readings.map((r) => r!).entries()) {
      expect(reading.footprint, `reading ${i} reads the footprint it is taken beside: ${short(reading.unknown)}`).not.toBeNull();
      expect(reading.footprint!, `reading ${i}'s footprint is the app's, many MB`).toBeGreaterThan(10 * MB);
      expect(reading.gauges.length, `reading ${i} reads the app's gauges`).toBeGreaterThan(0);
      expect(reading.gauges_ms, `reading ${i}'s gauges took some time to read`).toBeGreaterThan(0);
    }

    const runs = readings.slice(1).map((r) => r!.reading.gauges_ms);
    const near = (ms: number): number => samples.reduce((best, s) => (Math.abs(s.ms - ms) < Math.abs(best.ms - ms) ? s : best)).load;
    const loads = readings.slice(1).map((r) => ({ start: near(r!.at_ms - MINUTE_MS), end: near(r!.at_ms) }));
    const { judgeLimit, fingerprint } = await benchmark();
    const verdict = judgeLimit({ limit: LIMIT_MS, runs, fingerprint: fingerprint(), loads });
    console.log(`PROOF ${ID.ac5} gauges_ms per minute ${runs.join(', ')} against ${LIMIT_MS} ms: ${verdict.status}${verdict.reason ? `: ${verdict.reason}` : ''}`);
    expect(['PASS', 'INCONCLUSIVE'], `reading the gauges costs under ${LIMIT_MS} ms a minute: ${verdict.status}: ${verdict.reason ?? ''} (runs ${runs.join(', ')} ms)`).toContain(verdict.status);
    if (verdict.status !== 'PASS') expect.fail(`INCONCLUSIVE: ${verdict.reason}; the five minutes read ${runs.join(', ')} ms; this is not a pass`);
  }, 1_800_000);
});
