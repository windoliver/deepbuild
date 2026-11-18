// #1812 AC3 (README): `deep update`, `deep debug` and `deep off now` are listed commands whose arguments fit none of
// their forms, so each prints its own usage (a line that starts `Usage:` and names the command) and exits 2, never
// "Unsupported command". They run in a home where setup finished (#1002's marker), so `deep off now`, a first-run
// command, isn't set up first. The test fails naming each command that doesn't.
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, cleanup, deep, finished, needBuild, shown, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1812.5d580fb2';
const CASES = [['update'], ['debug'], ['off', 'now']];

describe(`${ID} a listed command with arguments that fit none of its forms prints its own usage`, () => {
  it(`${ID} deep update, deep debug and deep off now each print their own usage and exit 2`, async () => {
    needBuild();
    const w = world();
    finished(w);
    const failures: string[] = [];
    for (const args of CASES) {
      const r = await deep(w, args, { timeoutMs: 60 * SECOND });
      const text = `${r.stdout}\n${r.stderr}`;
      const own = new RegExp(`^\\s*Usage:.*\\bdeep ${args[0]}\\b`);
      const why = [
        r.code === 2 ? '' : `exits ${r.code}, not 2`,
        text.split('\n').some((line) => own.test(line)) ? '' : `prints no usage of its own (a line that starts Usage: and names deep ${args[0]})`,
        /Unsupported command/i.test(text) ? 'prints "Unsupported command"' : '',
      ].filter(Boolean);
      if (why.length) failures.push(`deep ${args.join(' ')} ${why.join('; ')}: ${shown(r)}`);
    }
    expect(failures, `${failures.length} of ${CASES.length} commands don't print their own usage and exit 2:\n${failures.join('\n')}`).toEqual([]);
  }, 300 * SECOND);
});
