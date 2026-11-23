// AC7: on a batched taste card each row arms on its own pictures. One world, a real hub's record (README, The
// fixtures): three taste asks in three sessions, two 800 × 700 pictures each, shown as one batch (`ask.batched`, as the
// core writes it, #1345). The replica opens the first row's ask, whose card draws the three rows (`card-row:<ULID>`);
// the wheel brings row 1's pictures into view for the arming interval, and no more.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ARM_AFTER_MS, askOf, byId, cleanup, core, ID, isArmed, look, makeWorld, MIN, named, openOn, PLANT, replicaOf, said, scrollPictures, Trace,
  ulidNow, waitFor, type Ask, type Snapshot, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const ROWS = ['row1', 'row2', 'row3'] as const;
let world: World;
beforeAll(async () => {
  world = await makeWorld(ROWS.map((key, i) => ({ key, title: `Page ${i + 1} polish`, asks: [{ key, question: `Does page ${i + 1} look right?`, pictures: [[800, 700], [800, 700]] as [number, number][] }] })), {
    more: async (s, w) => {
      const asks = ROWS.map((k) => askOf(w, k));
      s.at(s.now() + 60_000);
      await s.record.append(core(asks[0]!.session) as never, { v: 1, id: ulidNow(), kind: 'ask.batched', ts: s.now(), data: { batch: `batch:${ulidNow()}`, asks: asks.map((a) => ({ ask: a.handle, plan_hash: null })) } } as never);
    },
  });
}, 30 * MIN);

const rowId = (a: Ask): string => `card-row:${a.handle.slice('ask:'.length)}`;

async function batchRun(plant?: string): Promise<string[]> {
  const asks = ROWS.map((k) => askOf(world, k));
  const trace = new Trace(asks.flatMap((a) => a.pictures));
  const rowShown = (a: Ask): boolean => a.pictures.every((p) => trace.shown(p.sha));
  const out: string[] = [];
  /** A row read armed while one of its own pictures was never drawn whole at half its size: named once each. */
  const early = (s: Snapshot): void => {
    for (const a of asks) {
      const never = a.pictures.filter((p) => trace.neverHalf(p.sha)).map((p) => p.sha);
      if (!isArmed(byId(s, rowId(a))) || !never.length || out.some((f) => f.startsWith(`row ${rowId(a)} `))) continue;
      out.push(`row ${rowId(a)} (${a.handle}) armed with its pictures not shown: ${named(never)}`);
    }
  };
  const r = await replicaOf(world, plant ? { plant } : {});
  try {
    await openOn(r, asks[0]!.handle, trace);
    await r.wait(ARM_AFTER_MS + 200);
    let x = await look(r);
    trace.add(x.t, x.s);
    if (!asks.every((a) => byId(x.s, rowId(a)))) return [`the card for ${asks[0]!.handle} draws no row for each of the batch's three asks: ${asks.map((a) => `${rowId(a)} ${byId(x.s, rowId(a)) ? 'drawn' : 'missing'}`).join(', ')}`];
    early(x.s);
    if (!rowShown(asks[0]!)) await scrollPictures(r, trace, () => rowShown(asks[0]!), early);
    if (!rowShown(asks[0]!)) return [...out, `the wheel never drew row 1's pictures (${named(asks[0]!.pictures.map((p) => p.sha))}) whole at half their size or more for the arming interval`];
    for (const a of asks.slice(1)) if (rowShown(a)) out.push(`the fixture's premise doesn't hold: ${a.handle}'s pictures were all shown on the way to row 1's`);
    x = await waitFor(r, (s) => { early(s); return isArmed(byId(s, rowId(asks[0]!))); });
    early(x.s);
    if (!isArmed(byId(x.s, rowId(asks[0]!)))) out.push(`row 1 (${rowId(asks[0]!)}) never armed once its pictures were shown: it reads ${said(byId(x.s, rowId(asks[0]!))?.value)}`);
  } finally {
    await r.stop();
  }
  return out;
}

describe(`AC7 ${ID.batch} each row of a batched taste card arms on its own pictures`, () => {
  it(`AC7 ${ID.batch}: on a batched card with three rows, scrolling row 1's pictures into view arms row 1 alone`, async () => {
    expect(await batchRun()).toEqual([]);
  }, 30 * MIN);

  it(`AC7 ${ID.batch} wrong program: a planted card that arms every row fails, naming rows 2 and 3`, async () => {
    const asks = ROWS.map((k) => askOf(world, k));
    const failures = (await batchRun(PLANT.armsEveryRow)).join('\n');
    for (const a of asks.slice(1)) expect(failures, `the planted card (README, Plants: ${PLANT.armsEveryRow}) wasn't caught naming ${rowId(a)}`).toContain(`row ${rowId(a)} (${a.handle}) armed with its pictures not shown`);
  }, 30 * MIN);
});
