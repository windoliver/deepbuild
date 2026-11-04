// #325 AC5: a claim on a PR also runs the repo's approved release checks, its local preflight included, on the PR's
// commit merged with main: a failure there is FAIL, and while one still runs the PR says "Part of", never "Closes"
// (design: Done means switched on; At the claim).
//
// The repo's spec names its release checks (README, Release checks): `release: { checks: [preflight] }`, the local
// preflight a node:test suite. The session works on branch `fix`, cut from the base, while main has moved on with
// src/limits.js (strict). The agent's change allows legacy tokens: the preflight passes on the branch's head alone
// and on main alone, and fails only on the head merged with main.
import { afterEach, describe, it } from 'vitest';
import { AC5, cleanup } from './helpers.ts';
import { releaseOnMerge } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`${AC5} release checks run on the PR's merge with main; a failure there is FAIL; Part of while one runs`, () => {
  it(`${AC5} item 9: Closes #9 refused naming Part of while preflight is still to run; Part of allowed; preflight fails on the merge of fix with main, and the PR claim's verdict is FAIL naming it`, async () => {
    await releaseOnMerge(9, AC5);
  }, 360_000);
});
