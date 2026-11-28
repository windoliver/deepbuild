import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ID, SECOND, cleanup, deep, needBuild, shown, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const UNKNOWN = 'zqxjvk';
const sameShape = (text: string, word: string): string => text.split(word).join('<word>').replace(/\s*Did you mean deep [a-z-]+(?: [a-z-]+)?\?/, '').trim();

describe(`${ID.waiter} deep waiter with no plant set`, () => {
  it(`${ID.waiter} deep waiter exits 2 as an unknown word does`, async () => {
    needBuild();
    const w = world();
    const control = await deep(w, [UNKNOWN], { timeoutMs: 60 * SECOND });
    if (control.code !== 2 || !control.stderr.includes(UNKNOWN)) throw Error(`BLOCKED: the unknown word ${UNKNOWN} doesn't exit 2 naming it, so there is nothing to hold deep waiter to: ${shown(control)}`);
    const r = await deep(w, ['waiter'], { timeoutMs: 30 * SECOND });
    expect(r.code, `deep waiter must exit 2 as an unknown word: ${shown(r)}`).toBe(2);
    expect(sameShape(r.stderr, 'waiter'), `deep waiter must say what an unknown word says (${JSON.stringify(control.stderr)}): ${shown(r)}`).toBe(sameShape(control.stderr, UNKNOWN));
    expect(r.stdout, `deep waiter prints nothing on stdout: ${shown(r)}`).toBe('');
    expect(existsSync(join(w.home, '.deepbuild')), 'deep waiter, an unknown word, sets nothing up in an empty home').toBe(false);
  }, 120 * SECOND);
});
