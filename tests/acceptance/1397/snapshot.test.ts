import { describe, expect, it } from 'vitest';
import {
  CARD, CARDS, EXPOSURE, FRAMING, RACE_COUNT, TIMEOUT, brief, claimId, claimOf, dividedCardDoc, dividedCardsDoc, docId, gpuGate, namedItem,
  none, proof, refusedFailures, reqId, requireMetal, rowFailsNaming, rowOf, rowPasses, run, scenarioOf, show, snapshotsOf, finiteIssues,
  useBuild, useFolders, verdict, type JsonObject,
} from './helpers.ts';

const ID = '#1397.a937d47d';
const bin = useBuild();
const folder = useFolders();

const [NAN_DOC, GUARDED_DOC, RACE_DOC] = [docId(1), docId(2), docId(3)];
const [NAN_CLAIM, GUARDED_CLAIM] = [claimId(1), claimId(2)];
const [NAN_FRAMING, NAN_EXPOSURE, GUARDED_FRAMING, GUARDED_EXPOSURE] = [reqId(1), reqId(2), reqId(3), reqId(4)];

function claimsOf(): JsonObject {
  return {
    [NAN_CLAIM]: claimOf(NAN_DOC, [{ id: NAN_FRAMING, check: FRAMING }, { id: NAN_EXPOSURE, check: EXPOSURE }]),
    [GUARDED_CLAIM]: claimOf(GUARDED_DOC, [{ id: GUARDED_FRAMING, check: FRAMING }, { id: GUARDED_EXPOSURE, check: EXPOSURE }]),
  };
}

function divided(planted?: string): { nan: JsonObject; nanVerdict: JsonObject; guarded: JsonObject; guardedVerdict: JsonObject } {
  const [nan, nanVerdict, guarded, guardedVerdict] = run(bin(), scenarioOf(folder(), [NAN_DOC, GUARDED_DOC], claimsOf(), [
    show(NAN_DOC, dividedCardDoc(false)), verdict(NAN_CLAIM), show(GUARDED_DOC, dividedCardDoc(true)), verdict(GUARDED_CLAIM),
  ], planted));
  return { nan: nan!, nanVerdict: nanVerdict!, guarded: guarded!, guardedVerdict: guardedVerdict! };
}

function race(planted?: string): JsonObject {
  const [reply] = run(bin(), scenarioOf(folder(), [RACE_DOC], {}, [show(RACE_DOC, dividedCardsDoc())], planted));
  return reply!;
}

function raceFailures(replies: readonly JsonObject[], what: string): string[] {
  const failures = replies.flatMap((r, i) => refusedFailures(r, RACE_COUNT, CARDS, `${what}, run ${i + 1}`));
  const items = replies.map(namedItem);
  if (new Set(items).size !== 1 || items[0] === null) failures.push(`${what}: the runs name the items ${brief(items)}; the smallest offending item is one item, the same on every run`);
  return failures;
}

describe(`${ID} a ledgered first-party operator that divides 0 by 0 at one pixel of a 1080p render-back`, () => {
  it(`${ID} the snapshot is refused with a count of 1, camera.framing and render.exposure reading it fail naming the operator and the item, and with the guard restored both pass`, () => {
    requireMetal('a 1080p render-back');
    const { nan, nanVerdict, guarded, guardedVerdict } = divided();
    const rows = {
      nanFraming: rowOf(nanVerdict, NAN_FRAMING, 'camera.framing on the divided card'),
      nanExposure: rowOf(nanVerdict, NAN_EXPOSURE, 'render.exposure on the divided card'),
      guardedFraming: rowOf(guardedVerdict, GUARDED_FRAMING, 'camera.framing with the guard restored'),
      guardedExposure: rowOf(guardedVerdict, GUARDED_EXPOSURE, 'render.exposure with the guard restored'),
    };
    for (const [what, row] of Object.entries(rows)) gpuGate(row, what);
    proof('the refused render-back', { issues: finiteIssues(nan), snapshots: snapshotsOf(nan) });
    proof('the rows', { framing: rows.nanFraming.raw, exposure: rows.nanExposure.raw });
    const failures = [
      ...refusedFailures(nan, 1, [CARD], 'the render-back of the divided card'),
      ...rowFailsNaming(rows.nanFraming, CARD, 'camera.framing reading it'),
      ...rowFailsNaming(rows.nanExposure, CARD, 'render.exposure reading it'),
      ...(snapshotsOf(guarded).length === 1 ? [] : [`with the guard restored the render-back returns ${snapshotsOf(guarded).length} snapshots, not 1: ${brief(guarded, 1500)}`]),
      ...finiteIssues(guarded).map((i) => `with the guard restored the render-back still raises ${brief(i, 600)}`),
      ...rowPasses(rows.guardedFraming, 'camera.framing with the guard restored'),
      ...rowPasses(rows.guardedExposure, 'render.exposure with the guard restored'),
    ];
    none(failures, ID);
  }, TIMEOUT);

  it(`${ID} a planted settle path that skips the count returns the frame and fails`, () => {
    requireMetal('a 1080p render-back');
    const { nan } = divided('settle_skips_count');
    expect(snapshotsOf(nan).length, `the planted settle path (settle_skips_count) returns the frame: ${brief(nan, 1500)}`).toBeGreaterThan(0);
    expect(refusedFailures(nan, 1, [CARD], 'the render-back under settle_skips_count'), 'the judge fails the planted settle path').not.toEqual([]);
  }, TIMEOUT);

  it(`${ID} the frame's count over four cards names the smallest offending item, the same item on two runs`, () => {
    requireMetal('a 1080p render-back');
    const replies = [race(), race()];
    proof('the two runs over four cards', replies.map((r) => finiteIssues(r)));
    none(raceFailures(replies, 'the render-back of four divided cards'), ID);
  }, TIMEOUT);

  it(`${ID} a planted counter that keeps the last writer instead of the minimum names different items on two runs and fails`, () => {
    requireMetal('a 1080p render-back');
    const replies = [race('nonfinite_last_writer'), race('nonfinite_last_writer')];
    proof('the two runs over four cards under nonfinite_last_writer', replies.map((r) => finiteIssues(r)));
    expect(raceFailures(replies, 'the render-back of four divided cards under nonfinite_last_writer'), 'the judge fails the planted last-writer counter').not.toEqual([]);
  }, TIMEOUT);
});
