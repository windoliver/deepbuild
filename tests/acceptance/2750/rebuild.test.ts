// AC4 #2750.6b561f56: "Rebuilding the reading from the event log twice gives byte-identical rows"
//
// The reading is first made by a real hub from the forge and the record (the shop's ten commits), and must be the
// fixture's: two rebuilds that agree prove nothing unless the rows are there. Then everything but the event log goes:
// the hub stops, the forge stops answering, and the repository and every clone are removed. Twice, a new home is given
// a copy of the event log's files and nothing else, the record drops every table built from the log and replays it
// (`rebuild`, packages/record's public entry), and a hub started there lists its readings. The two readings' rows are
// compared as bytes (judges.ts, bytesOf), and the rebuilt rows are held to the fixture again.
//
// Wrong programs: the merge base, which lists no such reading. A reading kept anywhere but the event log, in the hub's
// memory, in a file beside the log, on the forge or in the repositories, isn't there after the rebuild; rows that hold
// a clock's reading or an order nothing fixes differ between the two.
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_NAME, Shop } from './fixture.ts';
import { AC4, cleanup, keepLedger, rebuilt, TIMEOUT, World } from './helpers.ts';
import { bytesOf, judgeLanded } from './judges.ts';

afterAll(cleanup, 120_000);

describe(`${AC4} the reading is rebuilt from the event log`, () => {
  it(`${AC4} rebuilding the reading from the event log twice gives byte-identical rows, and they are the fixture's ten commits`, async () => {
    const w = await World.make((dir) => Shop.build(dir));
    const { expected } = w.fixture;
    await w.start();
    const made = judgeLanded((await w.read()).reading, REPO_NAME, expected);
    expect(made, `before any rebuild, the reading must be there and be the fixture's, or two rebuilds that agree prove nothing:\n${made.join('\n')}\n`).toEqual([]);

    await w.stop();
    const log = keepLedger(w.ledger());
    const forge = w.fixture.forge.url;
    await w.strip();
    const first = await rebuilt(log, forge, { replay: true });
    const second = await rebuilt(log, forge, { replay: true });
    const kept = judgeLanded(first.reading, REPO_NAME, expected);
    expect(kept, `rebuilt from the event log alone, with no forge to ask and no repository to read, the reading must still be the fixture's ten commits:\n${kept.join('\n')}\n`).toEqual([]);
    expect(bytesOf(second.reading), 'the second rebuild\'s rows, byte for byte the first\'s').toBe(bytesOf(first.reading));
  }, TIMEOUT);
});
