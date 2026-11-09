// AC2: `{handle: "ask:…"}` finds its row, with a question as its name and no handle drawn. Through deep-drive, the replica
// an agent drives (#124): `see` scoped to the locator, `expect` counting what it names, and the whole window's snapshot,
// over fixtures/record.events.jsonl.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup } from '../16/helpers.ts';
import { Drive, driveBinary, handlesShown, ID, locatedFailures, NEEDS_YOU, openAsks, RECORD, requireMacos, type Plant, type SNode, type Snapshot } from './helpers.ts';

afterAll(() => cleanup(), 60_000);
const MIN = 60_000;

/** Every way the replica of `plant` (the shipped one when none) breaks AC2 over the fixture, each naming its ask. */
async function failures(plant?: Plant): Promise<string[]> {
  requireMacos();
  const drive = await Drive.start(await driveBinary(plant));
  const out: string[] = [];
  try {
    await drive.must({ call: 'launch', launch: { from: 'fixture', fixture: RECORD, center: NEEDS_YOU } });
    for (const ask of openAsks(RECORD)) {
      const locator = { handle: ask.handle };
      const scoped = await drive.call({ call: 'see', see: { scope: 'locator' }, locator });
      if (!scoped.ok) { out.push(`{handle: "${ask.handle}"} found no row: ${JSON.stringify(scoped.error)}`); continue; }
      out.push(...locatedFailures((scoped.snapshot as Snapshot | undefined)?.tree as SNode | undefined, ask));
      const counted = await drive.call({ call: 'expect', locator, expect: { name: `one row for ${ask.handle}`, assert: 'count', count: 1 }, timeout: 0 });
      if (counted.assertion?.passed !== true) out.push(`{handle: "${ask.handle}"} names ${JSON.stringify(counted.assertion?.actual ?? counted.error)} things, not one row`);
      const drawn = await drive.call({ call: 'expect', locator: { text: ask.handle }, expect: { name: `${ask.handle} isn't drawn`, assert: 'count', count: 0 }, timeout: 0 });
      if (drawn.assertion?.passed !== true) out.push(`${ask.handle} is drawn on the screen: ${JSON.stringify(drawn.assertion ?? drawn.error)}`);
    }
    const whole = await drive.must({ call: 'see' });
    out.push(...handlesShown(whole.snapshot as Snapshot).map((n) => `a handle is named or valued in the tree: ${n}`));
  } finally {
    await drive.stop();
  }
  return out;
}

describe(`AC2 ${ID.handle} \`{handle: "ask:…"}\` finds its row, with a question as its name and no handle drawn`, () => {
  it('AC2 each open ask\'s {handle} finds exactly its row, named first by its question, and no handle is drawn, named or valued anywhere', async () => {
    expect(await failures()).toEqual([]);
  }, 30 * MIN);

  it('AC2 wrong program: rows that show their handle (#1172\'s plant-handle-rows) fail, naming the ask', async () => {
    const found = await failures('plant-handle-rows');
    const first = openAsks(RECORD)[0]!;
    expect(found.join('\n'), 'rows showing their handles fail').toContain(first.handle);
    expect(found.join('\n')).toMatch(/not a row whose name starts with its question|is drawn on the screen|named or valued in the tree/);
  }, 30 * MIN);
});
