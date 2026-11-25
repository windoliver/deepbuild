// AC2 #3511.7e0ccc3e: a session on a host whose claim changes only the code under test, with the same check passing
// there, reads PASS.
//
// The control for AC1 (README, The scenes): the same repo and the same approved check as AC1's first scene. The session
// changes price.txt to 17.00, which takes the coupon off, and nothing else; it stops saying done; the check runs on the
// host and exits 0. Read: the claim's verdict is PASS. A gate that counts every approved check on a host as the
// agent's own, whatever the claim changed, fails here.
import { afterEach, describe, expect, test } from 'vitest';
import { CHECK, cleanup, LIMIT } from '../999/helpers.ts';
import { AC, begin, CODE, edits, exitedZeroThere, proof, shownClaim, stopAndClaim } from './helpers.ts';

afterEach(cleanup, 900_000);

describe(AC[2], () => {
  test('a claim on the host that changes only price.txt, the code under test, with the approved check passing there, reads PASS', async () => {
    const sc = await begin('test-file');
    await edits(sc, CODE, '17.00\n');
    const c = await stopAndClaim(sc);
    exitedZeroThere(sc, c);
    proof(sc.w, 'ac2-code-only.json', { host: sc.w.alias, base: sc.base, edited: [CODE], claim: c.id, outcome: c.outcome, runs: c.runs, verdicts: c.verdicts.map((v) => v.data) });
    expect(c.outcome, `the claim on ${sc.w.alias} that changed only ${CODE}, with ${CHECK} passing there, reads PASS: ${sc.w.redact(shownClaim(c))}`).toBe('PASS');
  }, LIMIT);
});
