// #2581, criterion 2: a single dash is a flag too. `deep status -x --why`, `deep env up --root -x` and `deep install -x`
// each exit 2 with nothing set up in a fresh home. One assertion holds the values together, as #2200's suite does for a
// usage error: exit 2, no new or changed file under the temporary folder (home, working folder and stand-ins), no
// stand-in call. On the base `deep status` takes `-x` as the session and runs setup, and `deep env up` takes it as the
// root and asks a hub there. `deep install -x` runs where `-x` is a package folder with a readable manifest (README:
// The reading of each criterion, 3): on the base it reads `-x` as that folder and runs setup.

import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, freshPlace, manifestAtDashX, outcome, shown, TEST_MS, type Place } from './helpers.ts';

afterAll(cleanup, 60_000);

/** What a usage error leaves: the issue's values. */
const NOTHING = { exit: 2, written: [] as string[], called: [] as string[] };

async function setsNothingUp(p: Place, args: readonly string[]): Promise<void> {
  const { ran, exit, written, called } = await outcome(p, args);
  expect({ exit, written, called }, `deep ${args.join(' ')} has a flag where a value goes, so it must exit 2, write nothing and call no stand-in: ${shown(ran)}`).toEqual(NOTHING);
}

describe('#2581.43938b6c a single dash is a flag too', () => {
  it('#2581.43938b6c deep status -x --why in a fresh home exits 2 with nothing set up', async () => {
    await setsNothingUp(freshPlace(), ['status', '-x', '--why']);
  }, TEST_MS);

  it('#2581.43938b6c deep env up --root -x in a fresh home exits 2 with nothing set up', async () => {
    await setsNothingUp(freshPlace(), ['env', 'up', '--root', '-x']);
  }, TEST_MS);

  it('#2581.43938b6c deep install -x in a fresh home, a package folder named -x beside it, exits 2 with nothing set up', async () => {
    const p = freshPlace();
    manifestAtDashX(p);
    await setsNothingUp(p, ['install', '-x']);
  }, TEST_MS);
});
