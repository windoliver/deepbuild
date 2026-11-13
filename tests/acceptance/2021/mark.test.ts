// AC1: the working mark moves once for each event the record gets from its session and holds still when none comes
// (README, The fixture: `markRun`). Headless: the real `deep-drive` on a copy of a real hub's record, the hooks real.
import { afterAll, describe, expect, it } from 'vitest';
import { shared } from '../16/helpers.ts';
import { cleanup, ID, markRun, MIN, PLANT } from './helpers.ts';

afterAll(cleanup);
const LIMIT = 180 * MIN;
const shipped = shared(() => markRun());

describe(`AC1 ${ID.mark} A mark still through a silent tool call, moving at each event 2 s apart; a timer's mark fails`, () => {
  it('AC1 the shipped app: Image build\'s mark holds still through 60 s of a silent call while Product grid\'s moves at each of its 29 events', async () => {
    expect(await shipped()).toEqual([]);
  }, LIMIT);

  it('AC1 wrong program: a working mark animated by a timer (mark-on-timer) moves during the silence and fails, naming the session', async () => {
    expect(await shipped(), 'the shipped app must pass this judge first, or a plant it fails proves nothing').toEqual([]);
    const failures = await markRun(PLANT.timer);
    expect(failures.join('\n'), `${PLANT.timer} wasn't caught`).toMatch(/session:\S+ \("Image build"\): its tool call sent nothing for 60 s and its working mark moved at /);
  }, LIMIT);
});
