// #3336.f0336513: "A planted writer that targets `docs/evidence` fails: a test that writes a tracked file under
// `docs/evidence/` makes the unit lane FAIL, naming the path."
//
// Two lane runs (helpers.ts `laneRun`), each in a fixture repository holding this checkout's scripts/ and one planted
// vitest file, through the fixture's own `runLanes` on the `unit` entry of `checks` with that lane's parallel vitest
// command. The planted writer rewrites the tracked docs/evidence/3336-planted/scene-before.png and passes: the lane
// FAILs, its FAIL line names that path, and its record reads FAIL. Its clean twin writes the same screenshot to a temp
// folder and passes: the lane PASSes, so the FAIL is the tree's, not any lane run's.
import { afterAll, describe, expect, it } from 'vitest';
import { dispose, laneRun, PLANTED_SHOT, WRITERS } from './helpers.ts';

const roots: Array<{ root: string }> = [];
afterAll(() => { for (const r of roots) dispose(r); });

const shown = (r: ReturnType<typeof laneRun>): string => `exit ${r.exit}; verdicts: ${JSON.stringify(r.verdicts)}; records: ${JSON.stringify(r.records.map((rec) => rec['state']))}\n--- the lane's output (last 60 lines, each cut to 300 characters):\n${r.lines.slice(-60).map((l) => (l.length > 300 ? `${l.slice(0, 300)} …` : l)).join('\n')}`;

describe('#3336 the unit lane reads its tree again after its commands', () => {
  it('#3336.f0336513 a planted test that writes a tracked file under docs/evidence/ makes the unit lane FAIL, naming the path; its twin writing to a temp folder passes', () => {
    const clean = laneRun(WRITERS.temp);
    roots.push(clean);
    expect(clean.lines.some((l) => l.startsWith('LANE unit')), `the fixture's runLanes ran its unit lane: ${shown(clean)}`).toBe(true);
    expect(clean.after, 'the clean twin writes nothing into the fixture').toEqual([]);
    expect({ exit: clean.exit, verdicts: clean.verdicts.map((v) => v.split(/[\s:]/)[0]), records: clean.records.map((rec) => rec['state']) },
      `the clean twin, whose test writes its screenshot to a temp folder, passes the unit lane: ${shown(clean)}`).toEqual({ exit: 0, verdicts: ['PASS'], records: ['PASS'] });

    const planted = laneRun(WRITERS.evidence);
    roots.push(planted);
    expect(planted.lines.some((l) => l.startsWith('LANE unit')), `the fixture's runLanes ran its unit lane: ${shown(planted)}`).toBe(true);
    // The planted writer did write the tracked file: the fixture's tree changed.
    expect(planted.after, 'the planted writer rewrote the tracked screenshot').toEqual([` M ${PLANTED_SHOT}`]);
    const failures = planted.verdicts.filter((v) => v.startsWith('FAIL unit'));
    expect(failures.length, `a test that writes the tracked ${PLANTED_SHOT} makes the unit lane FAIL: ${shown(planted)}`).toBeGreaterThan(0);
    expect(failures.some((v) => v.includes(PLANTED_SHOT)), `the unit lane's FAIL names ${PLANTED_SHOT}: ${shown(planted)}`).toBe(true);
    expect(planted.exit, `the lane run exits 1: ${shown(planted)}`).toBe(1);
    expect(planted.records.map((rec) => rec['state']), `the unit lane's evidence record reads FAIL: ${shown(planted)}`).toEqual(['FAIL']);
  }, 18 * 60_000);
});
