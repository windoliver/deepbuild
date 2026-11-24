// #3229 AC1 and AC2: where a held-out variant's bytes are, at rest and once its run ends. Through a real hub: a session's
// prompt locks a definition whose one check has one held-out variant, named by a random marker that is nowhere else in
// the world but the handed drafts beside the home; the hub's home is then searched on disk.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AC, CHECK, claim, cleanup, draft, filesHolding, FIXED, FIXTURE, journal, LIMIT, Log, makeWorld, mustFail, open, PLANTS, PROMPT, shownClaim, startHub, variant, type Claim, type Variant } from './helpers.ts';

afterEach(cleanup, 120_000);

describe(`${AC[1]} After a definition with one held-out variant locks, a search of the hub's home for its marker finds no file, and no journal line holds the fixture's path`, () => {
  it(`${AC[1]} no file under ~/.deepbuild holds the variant's marker, and no line of the store's journal the fixture's path`, async () => {
    const v = variant();
    const w = makeWorld([draft(PROMPT, [v])]);
    const r = await Log.open(await startHub(w));
    await open(w, r);
    const failures = [
      ...filesHolding(w.root, v.marker).map((f) => `${f} holds the variant's marker ${v.marker} in the clear`),
      ...journal(w).filter((l) => l.includes(FIXTURE)).map((l) => `a line of evidence/records.jsonl holds the fixture's path ${FIXTURE}: ${l}`),
    ];
    expect(failures, `after the definition locked, in the hub's home ${w.root}: ${failures.join('; ')}`).toEqual([]);
    r.close();
  }, LIMIT);
});

interface Ended { c: Claim; checkouts: string; left: string[] }
/** An honest fix's claim, its check run on the visible fixture and on the variant, and the checkouts searched once both ended. */
async function cleanClaim(v: Variant, plant?: string): Promise<Ended> {
  const w = makeWorld([draft(PROMPT, [v])]);
  const r = await Log.open(await startHub(w, plant));
  const c = await claim(await open(w, r), r, FIXED(1), { runs: 2 });
  const checkouts = join(w.root, 'checkouts');
  return { c, checkouts, left: filesHolding(checkouts, v.marker) };
}
/** AC2: the outcome is the merge base's (the visible run and the variant's both passed, a PASS), and no checkout holds the variant's file. */
function sameAndGone(e: Ended, v: Variant): void {
  const runs = e.c.runs.filter((x) => x.check === CHECK);
  expect(runs.map((x) => x.outcome), `the check's run on the visible fixture and its variant's run both pass on the honest fix, as on the merge base: ${shownClaim(e.c)}`).toEqual(['passed', 'passed']);
  expect(e.c.outcome, `and the claim reads PASS on the two, as on the merge base: ${shownClaim(e.c)}`).toBe('PASS');
  expect(e.left, `once the variant's run ended (${shownClaim(e.c)}), no file under ${e.checkouts} may hold the variant's marker ${v.marker}, yet these do: ${e.left.join(', ')}`).toEqual([]);
}

describe(`${AC[2]} The variant's run gives the same outcome on the clean fixture repo as on the merge base, and when it ends its checkout holds no variant file`, () => {
  it(`${AC[2]} the honest fix passes the visible fixture and the variant, PASS, and no checkout holds the variant's file after`, async () => {
    const v = variant();
    sameAndGone(await cleanClaim(v), v);
  }, LIMIT);

  it(`${AC[2]} (wrong program ${PLANTS.leaves}) a hub that leaves the unsealed file behind fails, naming it`, async () => {
    const v = variant();
    const e = await cleanClaim(v, PLANTS.leaves);
    expect(e.left.length, `${PLANTS.leaves}: the planted hub must leave the variant's file under ${e.checkouts} once its run ended: ${shownClaim(e.c)}`).toBeGreaterThan(0);
    await mustFail(`${PLANTS.leaves} on AC2`, () => sameAndGone(e, v), [e.left[0]!]);
  }, LIMIT);
});
