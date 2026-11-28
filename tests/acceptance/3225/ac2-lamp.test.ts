import { describe, it } from 'vitest';
import { LAMP_ON_TABLE, LIFT, TABLE_HEIGHT, placedRoom } from './fixtures.ts';
import {
  SCENE_AUDIT, TIMEOUT, claimId, claimOf, docId, none, presented, relations, reqId, run, scenarioOf, show, showBin, useFolders, verdict,
} from './helpers.ts';
import { auditPassFailures, missedFailures, rowOf } from './judges.ts';

const ID = 'AC2 #3225.e8197c07';
const folder = useFolders();
const [ON_FLOOR, LIFTED] = [docId(1), docId(2)];
const [AUDIT_REQ, FLOOR_REQ, LIFTED_REQ] = [reqId(1), reqId(2), reqId(3)];
const claims = {
  [claimId(1)]: claimOf(ON_FLOOR, [{ id: AUDIT_REQ, check: SCENE_AUDIT }, { id: FLOOR_REQ, check: relations([LAMP_ON_TABLE]) }]),
  [claimId(2)]: claimOf(LIFTED, [{ id: LIFTED_REQ, check: relations([LAMP_ON_TABLE]) }]),
};

describe(`${ID} lamp on table is read from where the lamp stands, which the geometry audit doesn't judge`, () => {
  it(`${ID} with the lamp on the floor beside the table, lamp on table fails scene.relation_missed, naming both and a miss of at least the table's height, while the geometry audit passes that room; lifted 0.2 m straight above the table it reads a miss of 0.2 m within 1e-9 m`, () => {
    const calls = [show(ON_FLOOR, placedRoom('floor')), show(LIFTED, placedRoom('lifted')), verdict(claimId(1)), verdict(claimId(2))];
    const [shownFloor, shownLifted, onFloor, lifted] = run(showBin(), scenarioOf(folder(), [ON_FLOOR, LIFTED], claims, calls));
    presented(shownFloor!, 'the room with the lamp on the floor');
    presented(shownLifted!, 'the room with the lamp lifted above the table');

    none(auditPassFailures(rowOf(onFloor!, AUDIT_REQ), 'the geometry audit of the room whose lamp stands on the floor'), 'the geometry audit passes that room');
    none(
      missedFailures(rowOf(onFloor!, FLOOR_REQ), LAMP_ON_TABLE, { m: { least: TABLE_HEIGHT }, names: ['lamp', 'table'] }, 'the lamp on the floor beside the table'),
      'lamp on table fails scene.relation_missed, naming both and a miss of at least the table\'s height',
    );
    none(
      missedFailures(rowOf(lifted!, LIFTED_REQ), LAMP_ON_TABLE, { m: { near: LIFT, within: 1e-9 } }, 'the lamp lifted 0.2 m straight above the table'),
      'lifted 0.2 m straight above the table, lamp on table reads a miss of 0.2 m within 1e-9 m',
    );
  }, TIMEOUT);
});
