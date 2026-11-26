// AC6 (#3234.23f156f5), blind redraft: a picture replaced under a presented card, by a new hash, returns the accepting
// option to not armed with 1 of 4 left. It supersedes only the first draft's AC6 test (README). One world, a real hub's
// record: `four`, a taste ask pinned to revision 1 of a document whose canonical document lists four 800 × 700 pictures.
// The replica on a copy of that record at the reference window, on its virtual clock. The replacement is the
// document's next revision, `doc.patched` (README, The event), fed to the running replica.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ACCEPT, ARM_AFTER_MS, askOf, cleanup, drawnIn, ID, isArmed, leftOf, look, makeWorld, MIN, openOn, optionOf, replicaOf,
  fedRevision, scrollPictures, Trace, waitFor, wordsOf, type World,
} from './helpers.ts';

afterAll(cleanup, 60_000);
let world: World;
beforeAll(async () => {
  world = await makeWorld([
    { key: 'header', title: 'Header layout', asks: [{ key: 'four', question: 'Does the new header look right on all four pages?', pictures: [[800, 700], [800, 700], [800, 700], [800, 700]], spare: [[800, 700]] }] },
  ]);
}, 30 * MIN);

describe(`AC6 ${ID.replaced} a picture replaced by a new hash counts as not shown again`, () => {
  it(`AC6 ${ID.replaced}: a picture replaced under a presented card, by a new hash, returns the option to not armed with 1 left`, async () => {
    const ask = askOf(world, 'four');
    const card = `the card for ${ask.handle} ("${ask.question}")`;
    const [spare] = ask.spare;
    const trace = new Trace([...ask.pictures, spare!]);
    const r = await replicaOf(world);
    try {
      await openOn(r, ask.handle, trace);
      await r.wait(ARM_AFTER_MS + 200);
      const first = await look(r);
      trace.add(first.t, first.s);
      expect(drawnIn(first.s, ask.pictures).size, `${card} draws its pictures (nodes picture:<sha256>)`).toBeGreaterThan(0);
      // All four shown, the option armed: the state the criterion starts from.
      const s = await scrollPictures(r, trace, () => ask.pictures.every((p) => trace.shown(p.sha)));
      expect(ask.pictures.filter((p) => !trace.shown(p.sha)).map((p) => p.sha), `the wheel shows each of ${card}'s pictures`).toEqual([]);
      const armed = await waitFor(r, (x) => isArmed(optionOf(x, ACCEPT)));
      expect(isArmed(optionOf(armed.s, ACCEPT)), `${card}'s accepting option arms once its four pictures were shown: it reads "${wordsOf(armed.s, optionOf(armed.s, ACCEPT))}"`).toBe(true);
      // The picture to replace: one the window no longer draws whole, so the new one, drawn in its place, stays not shown.
      const now = drawnIn(s, ask.pictures);
      const at = Math.max(0, ask.pictures.findIndex((p) => !now.get(p.sha)?.whole));
      const old = ask.pictures[at]!.sha;
      await r.feed(ask.session, fedRevision(ask, 2, ask.replaced[at]!, Date.now()));
      const fed = await look(r);
      trace.add(fed.t, fed.s);
      // Past the arming interval, so a card that only re-arms on the change, as for any change, has armed again by now.
      await r.wait(ARM_AFTER_MS + 200);
      const after = await look(r);
      trace.add(after.t, after.s);
      expect(trace.shown(spare!.sha), `the fixture's premise: the new picture ${spare!.sha} is not drawn whole at half its size for the arming interval after it replaced ${old}`).toBe(false);
      const option = optionOf(after.s, ACCEPT);
      expect(isArmed(option), `${card}'s accepting option must be not armed once ${ask.doc}'s revision 2 replaces ${old} by ${spare!.sha}`).toBe(false);
      expect(leftOf(after.s, option), `${card}'s accepting option must read that 1 of 4 is not shown yet; it reads ${JSON.stringify(wordsOf(after.s, option))}`).toEqual([1, 4]);
    } finally {
      await r.stop();
    }
  }, 30 * MIN);
});
