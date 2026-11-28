import { describe, expect, it } from 'vitest';
import { RELS, SEEDED, chunks, pairRelations, poseOf, poseText, posesDoc, seededPairs, type PosePair } from './fixtures.ts';
import {
  PLANTED, TIMEOUT, claimId, claimOf, docId, none, presented, relations, reqId, run, scenarioOf, show, showBin, useFolders, verdict,
} from './helpers.ts';
import { lastPlaces, measureMismatches, rowOf, solveMisses, type Compared, type Mismatch } from './judges.ts';

const ID = 'AC6 #3225.39a420ed';
const folder = useFolders();
const [DOC, CLAIM] = [docId(1), claimId(1)];
const PAIRS = seededPairs();
const DOCS = chunks(PAIRS, SEEDED.perDoc);
const named = (m: Mismatch): string => `pose ${m.pose} (${poseText(PAIRS[m.pose]!)}): ${m.relation}: ${m.why}`;

function compared(pairs: PosePair[], planted?: string): Compared {
  const what = `poses ${pairs[0]!.k} to ${pairs.at(-1)!.k}`;
  const groups = chunks(pairs, SEEDED.perCheck).map((nine) => nine.flatMap(pairRelations));
  const claims = { [CLAIM]: claimOf(DOC, groups.map((expected, k) => ({ id: reqId(k + 1), check: relations(expected) }))) };
  const [shown, judged] = run(showBin(), scenarioOf(folder(), [DOC], claims, [show(DOC, posesDoc(pairs), true), verdict(CLAIM)], planted));
  presented(shown!, what);
  const { misses, problems } = solveMisses(shown!);
  none(problems, `${what}: the scene audit's relation failures carry the solve's measure`);
  const unreported = pairs.filter((p) => !misses.some((s) => s.a === p.a.id && s.rel === 'apart' && s.b === p.b.id)).map((p) => `pose ${p.k}`);
  none(unreported, `${what}: the scene audit reports each pose's apart of ${SEEDED.apart} m as missed, by the solve's measure`);
  return measureMismatches(groups.map((_, k) => rowOf(judged!, reqId(k + 1))), groups, misses, poseOf);
}

describe(`${ID} one measure serves the solve and the check`, () => {
  it(`${ID} for 1,000 seeded poses of two boxes each reading equals, bit for bit, what the solve's own measure gives for those poses; a planted check with a measure of its own that differs in the last place fails, naming the pose`, () => {
    let [bitwise, heldOnly] = [0, 0];
    for (const pairs of DOCS) {
      const c = compared(pairs);
      none(c.mismatches.map(named), `poses ${pairs[0]!.k} to ${pairs.at(-1)!.k}: each reading equals what the solve's own measure gives`);
      bitwise += c.bitwise;
      heldOnly += c.heldOnly;
    }
    console.log(`${ID} ${bitwise} readings equal the solve's measure bit for bit; ${heldOnly} it holds, read held`);
    expect(bitwise + heldOnly, 'every relation of every pose was compared').toBe(SEEDED.poses * RELS.length);
    expect(bitwise, 'each pose has at least its apart compared bit for bit').toBeGreaterThanOrEqual(SEEDED.poses);

    const failed = DOCS.flatMap((pairs) => compared(pairs, PLANTED.measure).mismatches);
    expect(failed.length, `${PLANTED.measure} fails this test`).toBeGreaterThan(0);
    expect(named(failed[0]!), 'its failure names the pose').toMatch(/^pose \d+ \(a_\d{4} /);
    const last = failed.find((m) => m.read !== undefined && m.solve !== undefined && lastPlaces(m.read, m.solve) === 1n);
    expect(last && named(last), `a reading ${PLANTED.measure} gives differs from the solve's in the last place: ${failed.slice(0, 3).map(named).join('; ')}`).toBeDefined();
  }, 4 * TIMEOUT);
});
