// AC1 (the replica's doors) and AC5. Session A of the fixture opened through each door the replica can drive: a click on
// its sidebar row, ⌘K, a click on its notification, a deepbuild:// link and deep_drive's open. Each door runs in a fresh
// replica on the same fixture: session B's page first, by deep_drive's open, then A's by the door, then ⌘[ and ⌘]. Each
// door must land on the one address `session/<A>`, with the page's snapshot equal to every other door's, and must have
// gone through `open`: back goes to B and forward to A again, since `open` is what walks the list. A route that opens a
// page any other way fails, naming the door it came through. `deep open`, the fifth door, is in cli.test.ts: it reaches
// the running app, which a replica is not.
import { describe, expect, it } from 'vitest';
import { DOORS, difference, driveBinary, ID, land, MIN, SESSIONS, sessionAt, type Landed } from './helpers.ts';

let landed: Promise<Landed[]> | undefined;
/** Every door, once a run, in order, on the plain replica. */
const doors = (): Promise<Landed[]> => {
  landed ??= (async () => {
    const bin = await driveBinary();
    const out: Landed[] = [];
    for (const door of DOORS) out.push(await land(bin, door));
    return out;
  })();
  return landed;
};
const A = sessionAt(SESSIONS.A.id);

describe(`AC1 ${ID.doors} On a fixture, a row click, ⌘K, a notification click, \`deep open\` and a \`deepbuild://\` link for one session each land on one page with the same address. A planted route that opens a page without \`open\` fails, naming the caller`, () => {
  it(`AC1 ${ID.doors} a row click, ⌘K, a notification click, a deepbuild:// link and deep_drive's open each land on ${A} through open, and the page each shows is the same snapshot`, async () => {
    const all = await doors();
    expect(all.flatMap((d) => d.failures)).toEqual([]);
    const first = all[0]!;
    const differ = all.slice(1).flatMap((d) => {
      const diff = difference(first.page!, d.page!);
      return diff ? [`the page the ${d.door} opened differs from the ${first.door}'s: ${diff}`] : [];
    });
    expect(differ).toEqual([]);
  }, 30 * MIN);

  it(`AC1 ${ID.doors} (wrong program) plant-row-skips-open, a sidebar row click that opens its session's page without open, fails, naming the row click`, async () => {
    const planted = await land(await driveBinary('plant-row-skips-open'), 'row click');
    expect(planted.failures, 'the planted row click must fail the door check').not.toEqual([]);
    for (const f of planted.failures) expect(f, 'each failure names the caller, the row click').toContain('row click');
  }, 30 * MIN);
});

describe(`AC5 ${ID.drive} \`deep_drive\` opens a session by address and reads the same snapshot as a click there`, () => {
  it(`AC5 ${ID.drive} deep_drive's open of ${A} and a click on A's row land on the same address, and see reads the same page snapshot after each`, async () => {
    const all = await doors();
    const click = all.find((d) => d.door === 'row click')!;
    const open = all.find((d) => d.door === 'deep_drive open')!;
    expect([...click.failures, ...open.failures]).toEqual([]);
    expect(difference(click.page!, open.page!), 'the page after deep_drive\'s open is the page after the click').toBeNull();
  }, 30 * MIN);
});
