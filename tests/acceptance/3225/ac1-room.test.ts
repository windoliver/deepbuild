import { describe, expect, it } from 'vitest';
import {
  ARRANGED, LAMP_ON_TABLE, LIFT_OUT, ROOM_RELATIONS, TABLE_HEIGHT, roomAt, roomDoc, withLampAt, type Pose, type V3,
} from './fixtures.ts';
import {
  PLANTED, TIMEOUT, claimId, claimOf, docId, none, posesOf, presented, query, relations, reqId, run, scenarioOf, show, showBin,
  useFolders, verdict,
} from './helpers.ts';
import { brief, heldFailures, missedFailures, rowOf, sameResultsFailures, type Row } from './judges.ts';

const ID = 'AC1 #3225.d1ce56ce';
const folder = useFolders();
const [DOC, CLAIM, REQ] = [docId(1), claimId(1), reqId(1)];
const claims = { [CLAIM]: claimOf(DOC, [{ id: REQ, check: relations(ROOM_RELATIONS) }]) };
const ROUTE = {
  solved: "#1732's room solved by arrange@1",
  written: 'the same room written with at alone at the solved poses',
  moved: 'the room whose lamp a patch broke out and moved',
} as const;

function solved(planted?: string): { poses: Record<string, Pose>; row: Row | null } {
  const [shown, read, judged] = run(showBin(), scenarioOf(folder(), [DOC], claims, [show(DOC, roomDoc()), query(DOC, ARRANGED), verdict(CLAIM)], planted));
  presented(shown!, ROUTE.solved);
  return { poses: posesOf(read!, ARRANGED, ROUTE.solved), row: rowOf(judged!, REQ) };
}
function written(poses: Record<string, Pose>, planted?: string): Row | null {
  const [shown, judged] = run(showBin(), scenarioOf(folder(), [DOC], claims, [show(DOC, roomAt(poses)), verdict(CLAIM)], planted));
  presented(shown!, ROUTE.written);
  return rowOf(judged!, REQ);
}
function moved(poses: Record<string, Pose>, planted?: string): Row | null {
  const lamp = poses['lamp']!.pos;
  const to: V3 = [lamp[0], lamp[1] + LIFT_OUT, lamp[2]];
  const doc = roomDoc();
  const calls = [show(DOC, doc), show(DOC, withLampAt(doc, to)), query(DOC, ['lamp']), verdict(CLAIM)];
  const [first, second, read, judged] = run(showBin(), scenarioOf(folder(), [DOC], claims, calls, planted));
  presented(first!, ROUTE.solved);
  expect(second!['code'], `the patch that moves the lamp is applied, not refused: ${brief(second, 1500)}`).toBeUndefined();
  const at = posesOf(read!, ['lamp'], ROUTE.moved)['lamp']!.pos;
  expect(at.every((x, k) => Math.abs(x - to[k]!) <= 1e-9), `the lamp broke out: it stands where the patch put it, ${JSON.stringify(to)}, not ${JSON.stringify(at)}`).toBe(true);
  return rowOf(judged!, REQ);
}
const judgements = {
  solved: (row: Row | null): string[] => heldFailures(row, ROOM_RELATIONS, ROUTE.solved),
  written: (first: Row | null, second: Row | null): string[] =>
    [...heldFailures(second, ROOM_RELATIONS, ROUTE.written), ...sameResultsFailures(first, second, ROOM_RELATIONS, ROUTE.solved, ROUTE.written)],
  moved: (row: Row | null): string[] => missedFailures(row, LAMP_ON_TABLE, { names: ['lamp', 'table'] }, ROUTE.moved),
};

describe(`${ID} #1732's room reads each of its relations held, by whichever route its items were placed`, () => {
  it(`${ID} #1732's room solved by arrange@1 reads each of its relations held within 1 mm and 1°; the same room written with at alone at the solved poses gives the same results, by hash; a planted check that reads the document's arrangement list passes a room whose lamp was broken out and moved, and fails this test`, () => {
    const one = solved();
    none(judgements.solved(one.row), ROUTE.solved);
    expect(one.poses['lamp']!.pos[1], 'the solve lifted the lamp onto the table, so the poses read are the solve\'s').toBeGreaterThan(TABLE_HEIGHT);
    const two = written(one.poses);
    none(judgements.written(one.row, two), ROUTE.written);
    const three = moved(one.poses);
    none(judgements.moved(three), ROUTE.moved);

    const planted = solved(PLANTED.list);
    const [plantedWritten, plantedMoved] = [written(planted.poses, PLANTED.list), moved(planted.poses, PLANTED.list)];
    expect(plantedMoved?.result, `${PLANTED.list} passes a room whose lamp was broken out and moved: ${brief(plantedMoved?.raw)}`).toBe('PASS');
    const failures = [...judgements.solved(planted.row), ...judgements.written(planted.row, plantedWritten), ...judgements.moved(plantedMoved)];
    expect(failures.filter((f) => f.startsWith(ROUTE.written)), `${PLANTED.list} fails this test on the room written with at alone, which has no arrangement list to read`).not.toEqual([]);
    expect(failures.filter((f) => f.startsWith(ROUTE.moved)), `${PLANTED.list} fails this test on the room whose lamp was moved`).not.toEqual([]);
  }, 2 * TIMEOUT);
});
