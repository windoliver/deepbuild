// #2200, criterion 4: a flag isn't an argument. `deep open`, `deep backup`, `deep run follow` and
// `deep session rules` each take one argument; a flag where it goes is a usage error, exit 2, as `deep inbox` has it.
// On the base each reads `--typo` as its address, folder, run or session and exits 1, 1, 1 and 3.

import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, freshHome, outcome, shown } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('#2200.0122400d a flag isn\'t an argument', () => {
  const FORMS: string[][] = [['open', '--typo'], ['backup', '--typo'], ['run', 'follow', '--typo'], ['session', 'rules', '--typo']];
  it.each(FORMS.map((args) => [args.join(' '), args] as const))('#2200.0122400d deep %s is a usage error: exit 2', async (_shown, args) => {
    const { ran, exit } = await outcome(freshHome(), args);
    expect(exit, `deep ${args.join(' ')} has a flag where its argument goes, so it must exit 2: ${shown(ran)}`).toBe(2);
  }, 300_000);
});
