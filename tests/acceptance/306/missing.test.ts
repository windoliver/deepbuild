// AC3: "A document that names a pack version this build lacks is refused with pack_missing, naming the
// pack and the version, never drawn with another version, and a check that needs it is BLOCKED; the pack
// versions task later opens such a document and keeps that pack's instances byte for byte"
//
// asserts: in the build without scene3d, with test/chart@1.0.0 installed, a board naming test/chart@2.0.0
// (a version the store lacks) with c1 {n: 5} is refused whole: no snapshot, no current revision, an error
// `pack_missing` naming the pack and the version 2.0.0 (so it was never drawn with 1.0.0, the version
// that is installed), and its `--check` is BLOCKED; with no pack installed a board naming
// test/chart@1.0.0 is refused the same way. The pack versions task's later opening (instances kept and
// skipped) is #203's and not read here (README: Readings).

import { describe, expect, it } from 'vitest';
import {
  CHART, DOC, R1, board, check, currents, errors, instance, issues, names, outcome, packAt, revisionsOf, run, scenario, show, snapshots,
  useBuilds, useEvidence, type JsonObject, type PackFixture,
} from './helpers.ts';

const builds = useBuilds([R1]);
const evidence = useEvidence();
const MISSING = { id: 'test/chart', version: '2.0.0' };

const bars = (pack: string) => board('Bars', [pack], [instance('c1', 'chart.bars@1', { n: 5 }, 'a0', [40, 40])]);

function refusedMissing(reply: JsonObject, pack: string, version: string, what: string): void {
  expect(outcome(reply), `${what} is refused`).toBe('refused');
  expect(snapshots(reply).length, `${what} carries no snapshot: it is never drawn`).toBe(0);
  const missing = errors(issues(reply, what)).filter((i) => i.code === 'pack_missing');
  expect(missing.length, `${what} has a pack_missing error: ${JSON.stringify(reply['issues']).slice(0, 600)}`).toBeGreaterThan(0);
  expect(missing.some((i) => names(i, pack) && names(i, version)), `a pack_missing issue names the pack ${pack} and the version ${version}: ${JSON.stringify(missing.map((i) => i.raw)).slice(0, 600)}`).toBe(true);
}

describe('AC3 a document naming a pack version this build lacks is refused whole with pack_missing, and its check is BLOCKED', () => {
  it('AC3 with 1.0.0 installed, a board naming test/chart@2.0.0 is refused naming the pack and 2.0.0, never drawn with 1.0.0, no revision current, its check BLOCKED', () => {
    const [shown, revs, checked] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main', [DOC.b]: 'main' }, [CHART], [
      show(bars(`${MISSING.id}@${MISSING.version}`), { pixels: true }),
      revisionsOf(DOC.a),
      check(bars(`${MISSING.id}@${MISSING.version}`), { doc: DOC.b }),
    ]));
    refusedMissing(shown!, MISSING.id, MISSING.version, 'the board naming test/chart@2.0.0');
    expect(currents(revs!), 'no revision of the refused board is current').toEqual([]);
    expect(checked!['result'], `the check of a document that needs the missing pack is BLOCKED: ${JSON.stringify(checked).slice(0, 600)}`).toBe('BLOCKED');
    refusedMissing(checked!, MISSING.id, MISSING.version, 'the check of the board naming test/chart@2.0.0');
  });

  it('AC3 with no pack installed, a board naming test/chart@1.0.0 is refused naming the pack and 1.0.0, and its check is BLOCKED', () => {
    const none: PackFixture[] = [];
    const [shown, checked] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: 'main', [DOC.b]: 'main' }, none, [
      show(bars(packAt(CHART)), { pixels: true }),
      check(bars(packAt(CHART)), { doc: DOC.b }),
    ]));
    refusedMissing(shown!, CHART.id, CHART.version, 'the board naming test/chart@1.0.0 in a store without it');
    expect(checked!['result'], 'its check is BLOCKED').toBe('BLOCKED');
  });
});
