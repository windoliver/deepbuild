// #1700.77550f02: "On the window, a probe along z through each hole's centre meets nothing, and one through the
// centre of the bar between holes meets the slab with entry and exit 0.1 m apart within 1e-9 m. A planted probe that
// tests only bounding boxes meets the slab through every hole and fails, naming the probe"
//
// Fixture (helpers.ts `windowDoc`), a stored scene, the one deliverable of a claim of alpha's: `window`, an
// `extrude@1` of a 1 × 1 m square outline (x and y from −0.5 to 0.5) with four 0.2 m square holes centred at
// (±0.25, ±0.25) m, from z = 0 to 0.1 m. The bar between the two upper holes spans x from −0.15 to 0.15 and y from
// 0.15 to 0.35, so its centre is (0, 0.25). Each probe starts 1 m before the window, at z = −1, along +z. The claim
// holds two requirements: `{kind: geometry.shape, of: window, readings: [the four hole probes], expect: {probe:
// false}}` and `{of: window, readings: [the bar probe], expect: {probe: true}}`.
//
// asserts:
//   - both requirements PASS; each hole probe's one result is false; the bar probe's one result is true, with `entry`
//     and `exit` (m along dir from `from`) 0.1 m apart within 1e-9 m;
//   - with the planted `probe_tests_bounds_only` (a probe meets the item wherever its line crosses the item's bounds,
//     never testing a triangle): every hole probe reads true, the holes' requirement FAILs, and for each hole probe a
//     geometry.reading issue on its own readings/<i> names the probe, expected false and actual true.
import { describe, expect, it } from 'vitest';
import {
  HOLE_CENTRES, PLANTED, TIMEOUT, WINDOW_DEPTH, brief, claimId, claimOf, decided, docId, nearAbs, oneAt, probe, readingIssuesAt, reqId, rowOf,
  run, scenarioOf, shape, useBuild, useFolders, verdict, windowDoc,
} from './helpers.ts';

/** The criterion's ID: `#1700.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1700.77550f02';
const bin = useBuild();
const folder = useFolders();

const WINDOW = docId(1);
const HOLE_PROBES = HOLE_CENTRES.map(([x, y]) => probe([x, y, -1], [0, 0, 1]));
const BAR_PROBE = probe([0, 0.25, -1], [0, 0, 1]);
const claims = {
  [claimId(1)]: claimOf(WINDOW, [
    { id: reqId(1), check: shape('window', HOLE_PROBES, { probe: false }) },
    { id: reqId(2), check: shape('window', [BAR_PROBE], { probe: true }) },
  ]),
};
const judged = (planted?: string) => {
  const [v] = run(bin(), scenarioOf(folder(), { [WINDOW]: windowDoc() }, claims, [verdict(claimId(1))], planted));
  const under = planted ? ` under ${planted}` : '';
  return [rowOf(v!, reqId(1), `the probes through the holes${under}`), rowOf(v!, reqId(2), `the probe through the bar${under}`)] as const;
};
const where = (i: number): string => `the probe through the hole at (${HOLE_CENTRES[i]!.join(', ')})`;

describe(`${ID} a probe meets the triangles, never the bounds`, () => {
  it(`${ID} a probe along z through each hole's centre meets nothing and one through the bar's centre meets the slab with entry and exit 0.1 m apart within 1e-9 m; a planted probe that tests only bounding boxes meets the slab through every hole and fails, naming the probe`, () => {
    const [holes, bar] = judged();
    decided(holes, 'PASS', 'the probes through the holes, read for meeting nothing');
    for (let i = 0; i < HOLE_PROBES.length; i++) expect(oneAt(holes, i, where(i)).value, `${where(i)} meets nothing`).toBe(false);
    decided(bar, 'PASS', 'the probe through the bar, read for meeting the slab');
    const b = oneAt(bar, 0, 'the probe through the bar');
    expect(b.value, `the probe through the bar meets the slab: ${brief(b.raw)}`).toBe(true);
    const [entry, exit] = [b.raw['entry'], b.raw['exit']];
    expect(typeof entry === 'number' && nearAbs(exit, entry + WINDOW_DEPTH, 1e-9), `its entry and exit are 0.1 m apart within 1e-9 m: entry ${brief(entry)}, exit ${brief(exit)}`).toBe(true);

    // The planted probe that tests only bounding boxes.
    const [planted] = judged(PLANTED.probe);
    decided(planted, 'FAIL', `the probes through the holes under ${PLANTED.probe}`);
    for (let i = 0; i < HOLE_PROBES.length; i++) {
      expect(oneAt(planted, i, `${where(i)} under ${PLANTED.probe}`).value, `the planted probe meets the slab through the hole at (${HOLE_CENTRES[i]!.join(', ')})`).toBe(true);
      const issue = readingIssuesAt(planted, i)[0];
      expect(issue, `a geometry.reading issue names ${where(i)}, readings/${i}: ${brief(planted.raw['issues'] ?? null, 3000)}`).toBeDefined();
      expect(JSON.stringify(issue!.reading ?? null), `the issue names the probe reading: ${brief(issue!.raw)}`).toContain('probe');
      expect([issue!.expected, issue!.actual], `the issue on ${where(i)} names expected false and actual true: ${brief(issue!.raw)}`).toEqual([false, true]);
    }
  }, TIMEOUT);
});
