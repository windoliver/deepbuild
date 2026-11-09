// #1359 AC4 (README): `deep help` and `deep -h` print what `deep --help` prints, and exit 0.
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, cleanup, deep, needBuild, shown, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1359.16cd308c';

describe(`${ID} deep help and deep -h`, () => {
  it.each(['help', '-h'])(`${ID} deep %s prints what deep --help prints and exits 0`, async (word) => {
    needBuild();
    const reference = await deep(world(), ['--help'], { timeoutMs: 60 * SECOND });
    expect(reference.code, `deep --help: ${shown(reference)}`).toBe(0);
    const r = await deep(world(), [word], { timeoutMs: 60 * SECOND });
    expect(r.code, `deep ${word}: ${shown(r)}`).toBe(0);
    expect(r.stdout, `deep ${word} must print what deep --help prints`).toBe(reference.stdout);
  }, 120 * SECOND);
});
