// AC2 #239.a88a17ac: "document.determinism, the frame budget (five runs on the reference Mac's environment
// fingerprint), film.audit and film.layout pass on both films, and each one's planted twin fails, naming its fault"
//
// This file: the frame budget. Through `deep-gpu run`'s `frame_budget` (#1899's call, the document check's run): the
// film's whole span at its own size and rate under its own look, a warm-up and five timed runs on the GPU, judged
// against the film's budget class by the five-run rule, on the environment fingerprint the check reads from this
// machine (no stub). It must PASS; a PASS counts only on a reference Mac on mains power, Low Power Mode off and the
// thermal state nominal (scripts/benchmark.mjs's fingerprint, as #501's gate reads it) and with the load at or under
// the core count at the run's start and end, so off those the test reads INCONCLUSIVE, never PASS (and a PASS the
// check gives off them fails, as a false PASS). Its planted twin is the same film's run on the `test-meter` build with
// the test meter reading 100 ms of GPU on every frame (over every class's frame limit) under the reference Mac's
// fingerprint: it must FAIL, naming the GPU limit, with each of the five runs' p95 at 100 ms and the 5% margin.
// Wrong programs: the base (no film: BLOCKED); a check that FAILs the film; one that PASSes it off the reference Mac's
// environment; one that passes or blocks the over-budget twin.
import { describe, expect, it } from 'vitest';
import {
  AC, FILMS, LABEL, REFERENCE, RUNS, TIMEOUT, blocked, budgetCall, budgetOf, docFile, film, flatMeter, inconclusive, loadProblem, referenceMacProblem,
  runGpu, show, useBuilds, useTemp, type Budget, type JsonObject,
} from './helpers.ts';

const bin = useBuilds();
const temp = useTemp();

const runsLine = (b: Budget): string =>
  `GPU p95s ${b.gpu.runs.map((r) => r.p95_ms).join(', ')} ms against ${b.gpu.limit_ms} ms (${b.gpu.verdict}), CPU p95s ${b.cpu.runs.map((r) => r.p95_ms).join(', ')} ms against ${b.cpu.limit_ms} ms (${b.cpu.verdict})`;

describe(`${AC[2]} the frame budget passes on both films on the reference Mac, and its planted twin fails, naming its fault`, () => {
  for (const name of FILMS) {
    it(`${AC[2]} ${LABEL[name]}: the frame budget's five runs, judged on this machine's own environment fingerprint, PASS on the reference Mac`, async () => {
      const f = film(name);
      const doc = docFile(temp(), f);
      const before = loadProblem();
      const [reply] = runGpu(bin('deep-gpu'), [budgetCall(f, doc)], `${f.label}: the frame budget`);
      const after = loadProblem();
      if (reply!['code'] === 'no_device') blocked(`no GPU device for the frame budget here: ${show(reply!)}`);
      const b = budgetOf(reply!, `${f.label}: the frame budget`);
      const off = await referenceMacProblem(true);
      if (b.verdict === 'FAIL') expect.fail(`the frame budget FAILs ${f.label}: ${runsLine(b)}${off ? `; and off the reference Mac's environment (${off}) it is a reading that may never FAIL` : ''}`);
      if (b.verdict === 'PASS' && off) expect.fail(`the frame budget reads PASS off the reference Mac's environment (${off}), where a timing is a reading and never passes: ${runsLine(b)}`);
      if (b.verdict === 'BLOCKED') blocked(`the frame budget is BLOCKED on ${f.label}: ${show(reply!, 2000)}`);
      if (b.verdict === 'INCONCLUSIVE') inconclusive(`the frame budget reads INCONCLUSIVE on ${f.label} (${off ?? 'on a reference Mac in its conditions, its five runs neither all within nor all over'}): ${runsLine(b)}`);
      for (const [which, limit] of [['GPU', b.gpu], ['CPU', b.cpu]] as const) {
        expect(limit.verdict, `${f.label}: the ${which} limit passes: ${runsLine(b)}`).toBe('PASS');
        expect(limit.runs.length, `${f.label}: the ${which} limit carries its five runs`).toBe(RUNS);
        expect(limit.runs.every((r) => r.p95_ms !== null && r.p95_ms <= limit.limit_ms), `${f.label}: every run's ${which} p95 is within ${limit.limit_ms} ms: ${runsLine(b)}`).toBe(true);
      }
      const loaded = before ?? after;
      if (loaded) inconclusive(`the frame budget passes ${f.label} (${runsLine(b)}), but ${loaded}, and a loaded run counts neither way`);
    }, TIMEOUT);

    it(`${AC[2]} ${LABEL[name]}: the frame budget's planted twin, every frame read at 100 ms of GPU by the test meter under the reference Mac's fingerprint, FAILs naming the GPU limit and each run's p95`, () => {
      const f = film(name);
      const doc = docFile(temp(), f);
      const [reply] = runGpu(bin('deep-gpu test-meter'), [budgetCall(f, doc, { stub_meter: flatMeter(100), stub_environment: REFERENCE as unknown as JsonObject })], `${f.label}: the over-budget twin`, { noop: true });
      const b = budgetOf(reply!, `${f.label}: the over-budget twin`);
      expect(b.verdict, `the over-budget twin fails the frame budget: ${runsLine(b)}`).toBe('FAIL');
      expect(b.gpu.verdict, `the GPU limit is the fault named: ${runsLine(b)}`).toBe('FAIL');
      expect(b.gpu.limit_ms, `${f.label}: its class's GPU limit is a frame limit under 100 ms`).toBeLessThan(100);
      expect(b.gpu.runs.map((r) => r.p95_ms), `each of the five runs' GPU p95 is the 100 ms read`).toEqual(Array(RUNS).fill(100));
      expect(b.gpu.runs.every((r) => r.invalid.length === 0), `no frame of the twin is invalid: ${show(reply!, 1500)}`).toBe(true);
      expect(b.gpu.margin, `the margin is 5%, the five runs having no spread`).toBeCloseTo(0.05, 9);
    }, TIMEOUT);
  }
});
