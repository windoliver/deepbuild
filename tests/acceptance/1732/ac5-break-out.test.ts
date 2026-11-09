// AC5: "A patch that moves the lamp breaks it out: the other items keep their solved places, and the lamp's `on
// table` relation is reported as missed by the geometry audit if the patch lifts it off."
//
// A patch is a whole revision that differs from the last only at `items/lamp/at/pos` (README: Choices). The lamp's
// new place is computed from where the solve put it, read in a first process; a second process shows the room, reads
// every arranged item, shows the patch and reads them again.

import { describe, expect, it } from 'vitest';
import {
  AC, ARRANGED, DOC, SIZE, TIMEOUT, auditOf, boxOf, clone, front, obj, posesOf, presented, query, roomDoc, runShow,
  scenario, show, shown, useDir, useShow, type Failure, type JsonObject, type Pose, type V3,
} from './helpers.ts';

const bin = useShow();
const dir = useDir();
const OTHERS = ARRANGED.filter((id) => id !== 'lamp');

function solved(): Map<string, Pose> {
  const [reply, read] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, roomDoc()), query(DOC.a, ARRANGED)]));
  presented(reply!, 'the room');
  return posesOf(read!, ARRANGED, 'the room');
}

/** Shows the room, then the patch moving the lamp to `to`: the poses before and after, and the patch's audit. */
function patched(to: V3): { before: Map<string, Pose>; after: Map<string, Pose>; audit: Failure[] } {
  const doc = roomDoc();
  const moved = clone(doc);
  obj(obj(obj(moved['items'], 'items')['lamp'], 'lamp')['at'], 'lamp.at')['pos'] = to;
  const [first, before, second, after] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc), query(DOC.a, ARRANGED), show(DOC.a, moved), query(DOC.a, ARRANGED)]));
  presented(first!, 'the room');
  expect(second!['code'], `the patch is applied, not refused: ${shown(second)}`).toBeUndefined();
  return { before: posesOf(before!, ARRANGED, 'before the patch'), after: posesOf(after!, ARRANGED, 'after the patch'), audit: auditOf(second!, 'the patch') };
}

const near = (a: readonly number[], b: readonly number[]): boolean => a.every((x, k) => Math.abs(x - b[k]!) <= 1e-9);
function brokeOut(r: { before: Map<string, Pose>; after: Map<string, Pose> }, to: V3): void {
  const lamp = r.after.get('lamp')!.pos;
  expect(near(lamp, to), `the lamp broke out: it stands where the patch put it, ${JSON.stringify(to)}, not ${JSON.stringify(lamp)}`).toBe(true);
  for (const id of OTHERS) {
    const [b, a] = [r.before.get(id)!, r.after.get(id)!];
    expect(near(a.pos, b.pos) && near(a.rot, b.rot), `${id} keeps its solved place: before ${JSON.stringify(b)}, after ${JSON.stringify(a)}`).toBe(true);
  }
}
const namesLamp = (f: Failure): boolean => f.ids.includes('lamp') || JSON.stringify(f.raw).includes('"lamp"');

describe(`${AC[5]} a patch that moves the lamp breaks it out of the arrangement`, () => {
  it(`${AC[5]} a patch lifting the lamp 0.3 m off the table: it stands there, the others keep their solved places, and the audit reports lamp on table missed`, () => {
    const lamp = solved().get('lamp')!.pos;
    const to: V3 = [lamp[0], lamp[1] + 0.3, lamp[2]];
    const r = patched(to);
    brokeOut(r, to);
    const missed = r.audit.filter((f) => f.check === 'relation' && namesLamp(f) && JSON.stringify(f.raw).includes('"table"') && JSON.stringify(f.raw).includes('"on"'));
    expect(missed.length, `the geometry audit reports the lamp's on table relation missed: ${JSON.stringify(r.audit.map((f) => f.raw))}`).toBeGreaterThan(0);
  }, TIMEOUT);

  it(`${AC[5]} a patch sliding the lamp along the table's top: it stands there, the others keep their solved places, and the audit reports nothing of the lamp`, () => {
    const poses = solved();
    const lamp = poses.get('lamp')!.pos;
    const table = boxOf(roomDoc(), 'table', poses.get('table')!);
    // 0.3 m from the table's centre along its length (local x, at right angles to its front), the side the lamp isn't on.
    const [fx, fz] = front(table);
    const along: [number, number] = [fz, -fx];
    const side = (lamp[0] - table.c[0]) * along[0] + (lamp[2] - table.c[2]) * along[1] > 0 ? -1 : 1;
    const to: V3 = [table.c[0] + side * 0.3 * along[0], table.c[1] + table.h[1] + SIZE.lamp[1] / 2, table.c[2] + side * 0.3 * along[1]];
    const r = patched(to);
    brokeOut(r, to);
    expect(r.audit.filter(namesLamp).map((f) => f.raw as JsonObject), 'the lamp still rests on the table: the audit names nothing of it').toEqual([]);
  }, TIMEOUT);
});
