// AC2: "Starting the chairs stacked at the room's center gives the same relations held, and no two chairs overlap. A
// planted solve that ignores pair overlap leaves two chairs in each other and fails the audit, naming both."

import { describe, expect, it } from 'vitest';
import {
  AC, ARRANGED, DOC, FOUR, ROOM_RELATIONS, SHELL, TIMEOUT, arrangementProblems, auditOf, boxOf, depth, none, posesOf,
  presented, query, roomDoc, runShow, scenario, show, useDir, useShow,
} from './helpers.ts';

const bin = useShow();
const dir = useDir();
const SOLIDS = [...SHELL, ...ARRANGED];
const chairs: readonly string[] = FOUR;

describe(`${AC[2]} chairs stacked at the room's centre solve apart; a solve that ignores pair overlap fails the audit`, () => {
  it(`${AC[2]} from four chairs stacked at the centre, the same relations hold to 1 mm and 1°, no two chairs overlap, and the audit names no chair pair`, () => {
    const doc = roomDoc({ stacked: true });
    const [shown, read] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc), query(DOC.a, SOLIDS)]));
    presented(shown!, 'the stacked room');
    // arrangementProblems also lists every pair of solids, chairs included, passing more than 1 mm into each other.
    none(arrangementProblems(doc, posesOf(read!, SOLIDS, 'the stacked room'), ROOM_RELATIONS, SOLIDS), 'the stacked room, solved');
    const chairPairs = auditOf(shown!, 'the stacked room').filter((f) => f.check === 'overlap' && f.ids.filter((id) => chairs.includes(id)).length >= 2);
    expect(chairPairs.map((f) => JSON.stringify(f.raw)), 'the audit finds no two chairs in each other').toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} the planted arrange_ignores_pair_overlap leaves two chairs in each other, and the audit fails naming both`, () => {
    const doc = roomDoc({ stacked: true });
    const [shown, read] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc), query(DOC.a, FOUR)], 'arrange_ignores_pair_overlap'));
    const poses = posesOf(read!, FOUR, 'the planted solve');
    const named = auditOf(shown!, 'the planted solve').filter((f) => f.check === 'overlap').map((f) => f.ids.filter((id) => chairs.includes(id))).filter((ids) => new Set(ids).size >= 2);
    expect(named.length, 'the audit fails an overlap naming two chairs').toBeGreaterThan(0);
    const [a, b] = [...new Set(named[0]!)];
    const d = depth(boxOf(doc, a!, poses.get(a!)!), boxOf(doc, b!, poses.get(b!)!));
    expect(d, `${a} and ${b}, which the audit names, pass more than 1 mm into each other`).toBeGreaterThan(0.001);
  }, TIMEOUT);
});
