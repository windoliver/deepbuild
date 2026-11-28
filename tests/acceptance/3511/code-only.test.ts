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
