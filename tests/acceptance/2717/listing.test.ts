// #2717.6803fbfb: "`deep_kinds` lists the vehicle body with every field of its `vehicle` and each default the world
// reader takes when the field is left out, and a defaults run builds the car with every field left out and reads those
// values back."
//
// This file holds the first clause, the listing. deep_kinds `{op: "list"}` on `deep-show run` (the full build) answers
// `modules`, one row per canvas module; the physics module's row holds, under `lists`, what its deep_kinds tool entries
// add. The base lists one body kind there, the character body (`body@1.character`), each field of its `character` by
// path with its unit and, after ` = `, its default. The test reads that entry first, the way it reads the vehicle's,
// so its reader is seen to read what the base lists. It then asserts the same row lists `body@1.vehicle`, of kind
// vehicle, with every field of the design's Fields line by path (`<name>` for a wheel's name): the six with a default
// print the issue's (`vehicle.wheels.<name>.suspension.damping_ratio = 0.3`, `grip = 1`, `steers = false`, `drives =
// false`, `brakes = true`, `vehicle.steer_max = 35`), and `at`, `radius`, `rest`, `travel` and `hz`, which the design
// gives no default and the world reader refuses a wheel without, print none (helpers.ts, listingFailures).
//
// The base fails it: the physics module's row lists no vehicle body.

import { describe, expect, it } from 'vitest';
import { CHARACTER, ENTRY, FIELDS, ID, MODULE, TIMEOUT, entryNamed, listingFailures, physicsLists, printedAt, useFullBuild } from './helpers.ts';

const build = useFullBuild();

describe(`${ID} deep_kinds lists the vehicle body among the physics module's body kinds`, () => {
  it(`${ID} deep_kinds lists the vehicle body with every field of its vehicle and each default the world reader takes when the field is left out`, () => {
    const listing = physicsLists(build());
    expect(typeof listing === 'string' ? listing : '', `deep_kinds op: list answers the ${MODULE} module's row`).toBe('');
    if (typeof listing === 'string') throw Error(`BLOCKED: ${listing}`);
    // The character body's entry, which the base lists, read as the vehicle's is: the reader below is not vacuous,
    // and the vehicle body is listed among the body kinds, not in the character body's place.
    const slope = printedAt(entryNamed(listing, CHARACTER), 'character.slope_limit');
    expect(slope, `the ${MODULE} module's row lists ${CHARACTER} with character.slope_limit printed "deg = 45", as the base does; it lists ${listing.names.join(', ') || 'nothing'}`)
      .toEqual({ unit: 'deg', has: true, default: 45 });
    expect(listingFailures(listing), `the ${MODULE} module's row lists ${ENTRY} with the ${FIELDS.length} fields of its vehicle and each default the world reader takes`).toEqual([]);
  }, TIMEOUT);
});
