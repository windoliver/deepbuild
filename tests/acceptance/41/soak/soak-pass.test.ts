// AC18 #41.8d96c961: "The soak's open files, memory and child processes stay within 10% of their level at hour one; a
// planted hub that leaks one file per session fails, naming the count." This file is the unplanted half: the soak of
// this hub passes. soak-plant.test.ts is the planted half.
//
// Surface assumed (the issue and design name no code surface, so this is the one the tests pin):
//   node benchmarks/hub-soak.mjs --sessions 30 --duration <ms> --sample <ms> [--root <dir>]
//   - Starts a hub from this checkout's built CLI with HOME=<dir> (its DeepBuild folder, and so its record, at
//     <dir>/.deepbuild/ledger.db; a given <dir> is left in place for the caller), and passes DEEP_HUB_PLANT from its
//     own environment to that hub, as benchmarks/hub-churn.mjs does.
//   - For <duration> ms it runs 30 sessions' hook traffic over and over: 30 Claude Code sessions open at once
//     (SessionStart, then turn hooks), then each closed (SessionEnd), then 30 more.
//   - Every <sample> ms it reads the hub's health `process: { openFiles, rssBytes, children }` (see health.test.ts).
//   - The baseline is the first sample taken after the warm-up, the first 1/8 of <duration> (hour one of the release's
//     8-hour soak); `last` is the last sample.
//   - It prints one JSON line {"baseline": {openFiles, rssBytes, children}, "last": {...}, "verdict": "PASS"|"FAIL",
//     "reasons": [string, ...]} and exits 0 on PASS. Any metric whose last sample exceeds its baseline by more than
//     10% makes it FAIL with a non-zero exit, and gives one reason per such metric naming the metric (openFiles,
//     rssBytes or children) and both its baseline and last counts as plain integers.
//   - It stops the hub it started by PID before it exits.
// Needs the CLI built (packages/cli/dist/main.js).

import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isMetrics, sessionsOf, soak } from './run-soak.js';

const DURATION = 120_000;
const SAMPLE = 3_000;

describe('AC18 #41.8d96c961 the soak passes a hub that holds steady', () => {
  it('AC18 #41.8d96c961 the soak of this hub, 30 sessions at a time, says PASS with no reasons and exits 0', async () => {
    const run = await soak(DURATION, SAMPLE);
    try {
      expect(run.report, run.out.slice(-4000)).toBeDefined();
      const r = run.report!;
      expect(isMetrics(r.baseline)).toBe(true);
      expect(isMetrics(r.last)).toBe(true);
      expect(r.reasons).toEqual([]);
      expect(r.verdict).toBe('PASS');
      expect(run.code).toBe(0);
      // A PASS agrees with its own numbers: every metric within 10% of its baseline.
      for (const k of ['openFiles', 'rssBytes', 'children'] as const) expect(r.last[k]).toBeLessThanOrEqual(r.baseline[k] * 1.1);
      // The soak ran real sessions through the hub: 30 open at once, and opened and closed more than once over.
      const { ended, mostOpen } = sessionsOf(run.root);
      expect(mostOpen).toBeGreaterThanOrEqual(30);
      expect(ended).toBeGreaterThanOrEqual(60);
    } finally {
      rmSync(run.root, { recursive: true, force: true });
    }
  }, DURATION + 180_000);
});
