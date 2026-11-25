// AC1 #3032.dae946a2: "`node scripts/census.mjs --check` passes with at most 402 names open, none of the twenty among
// them, and its totals equal the rows. On the merge base 422 are open"
//
// The census script runs as a process on the checkout, with the fetch cache this machine holds and the network never
// allowed: it must exit 0 with a `PASS census:` line and no line in another state (a reference that isn't cached reads
// BLOCKED, and fails here). The census it checked, the one the tree's familiar pack names, is then read as a file:
// each state's total counts its rows in both tables, at most 402 names are open, and each of the issue's twenty has
// one row, mapped or refused. Wrong programs: the merge base, whose census holds the twenty among 422 open names; a
// census that leaves one of the twenty open or drops its row; totals written by hand.

import { homedir } from 'node:os';
import { describe, it } from 'vitest';
import { SLOW, checkCensus, familiar, none, passFailures, suite } from './helpers.ts';
import { AC, censusProblems } from './judges.ts';

describe(`${AC[1]} the census decides the twenty`, () => {
  it(`${AC[1]} node scripts/census.mjs --check passes with at most 402 names open, none of the twenty among them, and totals equal to the rows`, () => {
    suite();
    const pack = familiar();
    none(passFailures(checkCensus(homedir())), 'node scripts/census.mjs --check on the checkout');
    none(censusProblems(pack.census), `packs/${pack.folder}'s census`);
  }, SLOW);
});
