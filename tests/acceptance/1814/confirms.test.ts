import { afterAll, describe, expect, it } from 'vitest';
import { ID, SECOND, cleanup, groupsOf, help, shown } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const PHRASE = 'once the OS confirms you';

describe(`${ID.confirmsOnce} the confirmation phrase in deep --help`, () => {
  it(`${ID.confirmsOnce} "${PHRASE}" shows at most once in deep --help`, async () => {
    const r = await help();
    expect(r.code, `deep --help exits 0: ${shown(r)}`).toBe(0);
    expect(groupsOf(r.stdout).length, `deep --help lists its groups of usage lines: ${shown(r)}`).toBeGreaterThanOrEqual(2);
    const text = `${r.stdout}\n${r.stderr}`;
    const lines = text.split('\n').filter((line) => line.includes(PHRASE));
    const count = text.split(PHRASE).length - 1;
    expect(count, `"${PHRASE}" shows ${count} times in deep --help, on:\n${lines.join('\n')}`).toBeLessThanOrEqual(1);
  }, 120 * SECOND);
});
