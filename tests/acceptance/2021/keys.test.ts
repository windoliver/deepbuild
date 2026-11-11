// AC3: the list from the keyboard as VoiceOver reads it (README, The fixture: `keysRun`). Headless: the real
// `deep-drive` on a copy of a real hub's record of 30 sessions in three repos, at the reference window; what VoiceOver
// reads is the focused element's accessible name in the window's tree, as #1462's suite reads it.
import { afterAll, describe, expect, it } from 'vitest';
import { shared } from '../16/helpers.ts';
import { cleanup, ID, keysRun, MIN, PLANT } from './helpers.ts';

afterAll(cleanup);
const LIMIT = 60 * MIN;
const shipped = shared(() => keysRun());

describe(`AC3 ${ID.keys} The arrows walk 30 rows in drawn order, read by name and state word; "shop"; Return; rows that can't take focus fail`, () => {
  it('AC3 the shipped app: Down walks all 30 session rows in drawn order, each read with its title and state word; "shop" moves the keyboard to shop and hides nothing; Return opens what has it', async () => {
    expect(await shipped()).toEqual([]);
  }, LIMIT);

  it('AC3 wrong program: a sidebar whose rows can\'t take focus (rows-take-no-focus) fails, naming the first row', async () => {
    expect(await shipped(), 'the shipped app must pass this judge first, or a plant it fails proves nothing').toEqual([]);
    const failures = await keysRun(PLANT.noFocus);
    expect(failures.join('\n'), `${PLANT.noFocus} wasn't caught`).toMatch(/the keyboard never reached the first row session:\S+ \("[^"]+"\)/);
  }, LIMIT);
});
