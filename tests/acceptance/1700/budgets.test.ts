// #1700.b24f5071: "Budgets, on the reference Mac in the local preflight, compared with the merge base: every reading on
// a closed 100,000-triangle part takes under 50 ms, and one section under 10 ms"
//
// Fixture (helpers.ts `bigTorusDoc`), a stored scene, the one deliverable of a claim of alpha's: `torus`, a `lathe@1`
// about y of a closed 250-point circle of radius 0.25 m centred 1 m from the axis, with 200 segments: 250 × 200 × 2 =
// 100,000 triangles, one closed part of genus 1, placed 0.25 m up so its lowest points are 2e-5 m above the ground.
// Its claim holds eight requirements, one per reading, each `{kind: geometry.shape, of: torus, readings: [<reading>],
// expect: {<reading>: <value>}}`: parts 1; closed true; holes 1; volume in [1.2, 1.25] m³ (2π² × 1 × 0.25² ≈ 1.2337
// for the smooth torus, a little less faceted); `{section: {axis: y, at: 0.26}}` 2 (the outer and inner circles,
// the plane through no ring of vertices); `{probe: {from: [−3, 0.2537, 0.001], dir: [1, 0, 0]}}` true (a line along
// x through both sides of the tube, off every seam and vertex ring); `{tips: {axis: y}}` 0 (seen along its axis the
// outline is a convex 200-gon: none); `{rests: {on: ground}}` true.
//
// asserts:
//   - on this machine (debug build), every requirement is decided PASS, so each reading read the whole part, and each
//     row reports its own `timing.check_ms`;
//   - the budgets: the perf lane's own judgeLimit (scripts/benchmark.mjs) first says whether this machine can judge a
//     timing now (a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load under the core
//     count); if not, INCONCLUSIVE before a release build. If so, `full` is built in release, one warm-up process
//     runs the scenario, then five fresh processes; each must decide as above, and the five readings are judged:
//     each reading's `timing.check_ms` against 50 ms, and the section's against 10 ms too. None may FAIL, and
//     anything but PASS is INCONCLUSIVE, never a pass;
//   - "compared with the merge base": the local preflight's edit guard runs this file on the merge base too, where no
//     module registers geometry.shape and every row is BLOCKED, so it fails here (README: Readings).
import { describe, expect, it } from 'vitest';
import {
  BIG, RELEASE, TIMEOUT, bigTorusDoc, brief, buildInto, claimId, claimOf, decided, docId, inconclusive, judgeLimit, load, probe, reqId, rests,
  rowOf, run, scenarioOf, section, shape, timingOf, tips, useBuild, useFolders, verdict, type JsonValue,
} from './helpers.ts';

/** The criterion's ID: `#1700.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1700.b24f5071';
const bin = useBuild();
const folder = useFolders();
const READING_MS = 50;
const SECTION_MS = 10;
const RUNS = 5;

const DOC = docId(1);
/** Each reading on the torus with its expected value: [name, reading, expect key, value]. */
const READINGS: [string, JsonValue, string, JsonValue][] = [
  ['parts', 'parts', 'parts', 1],
  ['closed', 'closed', 'closed', true],
  ['holes', 'holes', 'holes', 1],
  ['volume', 'volume', 'volume', [1.2, 1.25]],
  ['section', section('y', 0.26), 'section', 2],
  ['probe', probe([-3, 0.2537, 0.001], [1, 0, 0]), 'probe', true],
  ['tips', tips('y'), 'tips', 0],
  ['rests', rests('ground'), 'rests', true],
];
const SECTION = READINGS.findIndex(([name]) => name === 'section');
const claims = { [claimId(1)]: claimOf(DOC, READINGS.map(([, reading, key, value], i) => ({ id: reqId(i + 1), check: shape('torus', [reading], { [key]: value }) }))) };

/** One fresh `deep-show run`: each reading decided PASS on the whole part, and its own check_ms, in READINGS's order. */
function readings(binary: string): number[] {
  const [v] = run(binary, scenarioOf(folder(), { [DOC]: bigTorusDoc() }, claims, [verdict(claimId(1))]));
  return READINGS.map(([name], i) => {
    const row = rowOf(v!, reqId(i + 1), `${name} on the ${BIG.triangles}-triangle torus`);
    decided(row, 'PASS', `${name} on the closed ${BIG.triangles}-triangle torus, read against its expected value`);
    const ms = timingOf(row, 'check_ms');
    expect(ms, `${name}'s row reports its own time, timing.check_ms: ${brief(row.raw['timing'] ?? null)}`).not.toBeNull();
    return ms!;
  });
}

describe(`${ID} geometry.shape's budgets on the reference Mac`, () => {
  it(`${ID} every reading on a closed 100,000-triangle part takes under 50 ms, and one section under 10 ms, on the reference Mac`, async () => {
    readings(bin());
    const open: string[] = [];
    const now = (): { start: number; end: number }[] => Array.from({ length: RUNS }, () => ({ start: load(), end: load() }));
    const gate = await judgeLimit(READING_MS, Array.from({ length: RUNS }, () => 0), now());
    if (gate['status'] !== 'PASS') open.push(`the timings: this machine can't judge them now: ${String(gate['reason'])}`);
    else {
      const built = buildInto(RELEASE, folder());
      expect(built.error, 'deep-show builds in release').toBe('');
      readings(built.bin);
      const times: number[][] = READINGS.map(() => []);
      const loads: { start: number; end: number }[] = [];
      for (let k = 0; k < RUNS; k++) {
        const start = load();
        const ms = readings(built.bin);
        loads.push({ start, end: load() });
        ms.forEach((m, i) => times[i]!.push(m));
      }
      const judge = async (what: string, limit: number, runs: number[]): Promise<void> => {
        const j = await judgeLimit(limit, runs, loads);
        console.log(`#1700 ${what} on ${BIG.triangles} triangles, check_ms per run: ${runs.map((x) => x.toFixed(2)).join(', ')} → ${String(j['status'])}`);
        expect(j['status'], `${what}'s time against ${limit} ms: ${JSON.stringify(j)}`).not.toBe('FAIL');
        if (j['status'] !== 'PASS') open.push(`${what}: ${JSON.stringify(j)}`);
      };
      for (const [i, [name]] of READINGS.entries()) await judge(name, READING_MS, times[i]!);
      await judge('one section', SECTION_MS, times[SECTION]!);
    }
    if (open.length) inconclusive(open.join('; '));
  }, 4 * TIMEOUT);
});
