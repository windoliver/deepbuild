// AC3 #239.7ded5bb7: "On a machine whose environment fingerprint isn't the reference Mac's, the frame budget reads
// INCONCLUSIVE, never PASS or FAIL"
//
// Through `deep-gpu run`'s `frame_budget` on each film, on the `test-meter` build's noop backend, with #1899's stub
// meter and stub environment (the seam that stands in for a machine's fingerprint): at 1 ms of GPU a frame, which the
// reference Mac's fingerprint PASSes, and at 100 ms, which it FAILs (the two controls), the run under another machine's
// fingerprint (Mac14,6, Apple M2 Max, none of the reference Macs) and under the reference Mac's on battery reads
// INCONCLUSIVE, its GPU limit too, with the five runs attached at 1 ms and at 100 ms. And when this machine's own
// fingerprint isn't a reference Mac's in its conditions (scripts/benchmark.mjs's), the film's real run on the shipped
// build, judged on that fingerprint, reads INCONCLUSIVE too. Wrong programs: the base (no film: BLOCKED); a check that
// judges by the readings alone and PASSes or FAILs off the reference Mac; one that ignores the stub or this machine's
// conditions.
import { describe, expect, it } from 'vitest';
import {
  AC, FILMS, LABEL, ON_BATTERY, OTHER_MACHINE, REFERENCE, RUNS, TIMEOUT, blocked, budgetCall, budgetOf, docFile, film, flatMeter, referenceMacProblem,
  runGpu, show, useBuilds, useTemp, type Fingerprint, type JsonObject,
} from './helpers.ts';

const bin = useBuilds();
const temp = useTemp();

const ENVIRONMENTS: [string, Fingerprint][] = [
  ['the reference Mac (Mac15,7) in its conditions', REFERENCE],
  ['another machine, Mac14,6 (Apple M2 Max)', OTHER_MACHINE],
  ['the reference Mac on battery', ON_BATTERY],
];
const READINGS = [1, 100] as const;

describe(`${AC[3]} off the reference Mac's environment fingerprint the frame budget reads INCONCLUSIVE, never PASS or FAIL`, () => {
  for (const name of FILMS) {
    it(`${AC[3]} ${LABEL[name]}: under another machine's fingerprint and the reference Mac's on battery the frame budget reads INCONCLUSIVE at 1 ms and at 100 ms a frame, which the reference Mac's PASSes and FAILs; and so does the real run on this machine when its fingerprint isn't a reference Mac's`, async () => {
      const f = film(name);
      const doc = docFile(temp(), f);
      const legs = ENVIRONMENTS.flatMap(([env, fp]) => READINGS.map((ms) => ({ env, fp, ms })));
      const replies = runGpu(bin('deep-gpu test-meter'), legs.map((l) => budgetCall(f, doc, { stub_meter: flatMeter(l.ms), stub_environment: l.fp as unknown as JsonObject })), `${f.label}: stubbed environments`, { noop: true });
      legs.forEach((l, i) => {
        const what = `${f.label} at ${l.ms} ms a frame under ${l.env}`;
        const b = budgetOf(replies[i]!, what);
        const want = l.fp === REFERENCE ? (l.ms === 1 ? 'PASS' : 'FAIL') : 'INCONCLUSIVE';
        expect(b.verdict, `${what}: ${show(replies[i]!, 1500)}`).toBe(want);
        expect(b.gpu.verdict, `${what}: the GPU limit`).toBe(want);
        expect(b.gpu.runs.map((r) => r.p95_ms), `${what}: the five runs are attached at ${l.ms} ms`).toEqual(Array(RUNS).fill(l.ms));
      });
      const off = await referenceMacProblem(true);
      if (off === null) {
        console.log(`${AC[3]} ${f.label}: this machine is a reference Mac in its conditions, so the stub fingerprints stand in for the others`);
        return;
      }
      const [real] = runGpu(bin('deep-gpu'), [budgetCall(f, doc)], `${f.label}: the frame budget on this machine`);
      if (real!['code'] === 'no_device') blocked(`no GPU device for the frame budget here: ${show(real!)}`);
      const b = budgetOf(real!, `${f.label} on this machine (${off})`);
      if (b.verdict === 'BLOCKED') blocked(`${f.label}'s frame budget on this machine (${off}) is BLOCKED, so it can't show INCONCLUSIVE: ${show(real!, 2000)}`);
      expect(b.verdict, `${f.label} on this machine, whose fingerprint isn't a reference Mac's (${off}): ${show(real!, 2000)}`).toBe('INCONCLUSIVE');
      expect(b.gpu.runs.length, `${f.label} on this machine: the five runs are attached`).toBe(RUNS);
    }, TIMEOUT);
  }
});
