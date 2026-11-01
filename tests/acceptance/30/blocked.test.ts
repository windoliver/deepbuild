// The one half of #30's criteria whose surface another unbuilt issue still owns. Nothing missing passes
// (AGENTS.md, invariant 2): the test fails BLOCKED, naming what it waits on, until that issue lands and a blind
// redraft of this job writes it against the surface it publishes (README, What depends on other issues). The claim
// halves that waited on the gate runner (#29) are in claims.test.ts now, and AC5's slot half, which waited on the
// extension host (#348) and slots (#349), is in replaces.test.ts; a redraft of this job wrote both once those landed.
import { describe, it } from 'vitest';

const blocked = (what: string): never => {
  throw Error(`BLOCKED: ${what}; this half of the criterion is tested once that surface exists, by a blind redraft of this job`);
};

describe('AC19 #30.aebc2446 a timing check\'s unflushed repeat is recorded as not flushed (#87\'s half; the counts are in contract.test.ts and the claim\'s INVALID in claims.test.ts)', () => {
  it('AC19 a timing check whose report leaves out whether a repeat\'s caches were flushed records that repeat as not flushed, never cold', () => {
    blocked('the timing check (#87), its timed repeats and the report that says whether each repeat\'s caches were flushed have no surface at this base');
  });
});
