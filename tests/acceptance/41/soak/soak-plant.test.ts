// AC18 #41.8d96c961: "The soak's open files, memory and child processes stay within 10% of their level at hour one; a
// planted hub that leaks one file per session fails, naming the count." This file is the planted half.
//
// Surface assumed: the soak runner as pinned in soak-pass.test.ts, plus the planted wrong program
//   DEEP_HUB_PLANT=leak-file-per-session: a hub selected through the existing plant mechanism
//   (packages/hub/src/plant.ts, read by the hub at start) that opens one file for each session and never closes it.
// The soak passes DEEP_HUB_PLANT on to the hub it starts; with this plant it must FAIL, exit non-zero, and give a
// reason that names openFiles with its baseline and last counts.
// Needs the CLI built (packages/cli/dist/main.js).

import { rmSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isMetrics, soak } from './run-soak.js';

const DURATION = 80_000;
const SAMPLE = 2_000;

describe('AC18 #41.8d96c961 the soak fails a hub that leaks one file per session', () => {
  it('AC18 #41.8d96c961 a planted hub leaking one file per session fails the soak, naming openFiles and both counts', async () => {
    const run = await soak(DURATION, SAMPLE, 'leak-file-per-session');
    try {
      expect(run.report, run.out.slice(-4000)).toBeDefined();
      const r = run.report!;
      expect(isMetrics(r.baseline)).toBe(true);
      expect(isMetrics(r.last)).toBe(true);
      expect(r.verdict).toBe('FAIL');
      expect(run.code).not.toBe(0);
      expect(run.code).not.toBeNull();
      // The leak shows as growth past 10% of the baseline's open files.
      expect(r.last.openFiles).toBeGreaterThan(r.baseline.openFiles * 1.1);
      const named = r.reasons.filter((reason) => /openFiles/.test(reason));
      expect(named).toHaveLength(1);
      const numbers = named[0]!.match(/\d+/g) ?? [];
      expect(numbers).toContain(String(r.baseline.openFiles));
      expect(numbers).toContain(String(r.last.openFiles));
    } finally {
      rmSync(run.root, { recursive: true, force: true });
    }
  }, DURATION + 180_000);
});
