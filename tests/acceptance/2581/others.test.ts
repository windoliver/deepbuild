// #2581, criterion 3: the other three. `deep secret add --typo x`, `deep rules credit --typo` and
// `deep host changes --typo` each have a flag where a value goes, so each is a usage error: exit 2. The criterion reads
// the exit code alone, and so does each test, in an empty working folder with a fresh home and no hub. On the base each
// reads `--typo` as its package, rule or host and goes on.

import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, freshPlace, outcome, shown, TEST_MS } from './helpers.ts';

afterAll(cleanup, 60_000);

describe('#2581.995b5ffd the other three', () => {
  const FORMS: string[][] = [['secret', 'add', '--typo', 'x'], ['rules', 'credit', '--typo'], ['host', 'changes', '--typo']];
  it.each(FORMS.map((args) => [args.join(' '), args] as const))('#2581.995b5ffd deep %s is a usage error: exit 2', async (_shown, args) => {
    const { ran, exit } = await outcome(freshPlace(), args);
    expect(exit, `deep ${args.join(' ')} has a flag where a value goes, so it must exit 2: ${shown(ran)}`).toBe(2);
  }, TEST_MS);
});
