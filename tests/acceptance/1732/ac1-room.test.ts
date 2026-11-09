// AC1: "A 4 × 3 m room with a table, four chairs, a lamp, a shelf and a rug, given as `chairs next_to table, chairs
// facing table, lamp on table, shelf against north wall, rug on floor, table inside room`, solves with every relation
// held to 1 mm and 1°, and the geometry audit finds no interpenetration past 1 mm. The same document solves to the
// same transforms on two runs and in a fresh process, compared by hash."

import { describe, expect, it } from 'vitest';
import {
  AC, ARRANGED, DOC, ROOM_RELATIONS, SHELL, TIMEOUT, arrangementProblems, auditOf, none, posesHash, posesOf, presented,
  query, roomDoc, runShow, scenario, show, useDir, useShow,
} from './helpers.ts';

const bin = useShow();
const dir = useDir();
const SOLIDS = [...SHELL, ...ARRANGED];

describe(`${AC[1]} the furnished room solves, held to 1 mm and 1°, with nothing interpenetrating`, () => {
  it(`${AC[1]} every relation holds to 1 mm and 1° on the solved transforms, and the geometry audit finds no interpenetration past 1 mm`, () => {
    const doc = roomDoc();
    const [shown, read] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc), query(DOC.a, SOLIDS)]));
    presented(shown!, 'the room');
    none(arrangementProblems(doc, posesOf(read!, SOLIDS, 'the room'), ROOM_RELATIONS, SOLIDS), 'the solved room');
    const pierced = auditOf(shown!, 'the room').filter((f) => f.check === 'overlap' || f.check === 'coincident');
    expect(pierced.map((f) => JSON.stringify(f.raw)), 'the geometry audit finds no interpenetration past 1 mm').toEqual([]);
  }, TIMEOUT);

  it(`${AC[1]} the same document solves to the same transforms on two runs and in a fresh process, compared by hash`, () => {
    const doc = roomDoc();
    const first = runShow(bin(), scenario(dir(), [DOC.a, DOC.b], [show(DOC.a, doc), query(DOC.a, ARRANGED), show(DOC.b, doc), query(DOC.b, ARRANGED)]));
    const fresh = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc), query(DOC.a, ARRANGED)]));
    for (const [r, what] of [[first[0]!, 'run 1'], [first[2]!, 'run 2'], [fresh[0]!, 'the fresh process']] as const) presented(r, what);
    const poses = [posesOf(first[1]!, ARRANGED, 'run 1'), posesOf(first[3]!, ARRANGED, 'run 2'), posesOf(fresh[1]!, ARRANGED, 'the fresh process')];
    // The solve placed the lamp (it starts on the floor), so equal hashes compare solved transforms, not the document's.
    expect(poses[0]!.get('lamp')!.pos[1], 'the lamp was lifted onto the table by the solve').toBeGreaterThan(0.7);
    const [h1, h2, h3] = poses.map(posesHash);
    expect(h2, 'run 2 solves to run 1\'s transforms, by hash').toBe(h1);
    expect(h3, 'a fresh process solves to run 1\'s transforms, by hash').toBe(h1);
  }, TIMEOUT);
});
