// A proof run that checked no theorem proves nothing: ran_nothing, never a pass (AGENTS.md invariant 2), whatever
// the checker said. A Kani spec naming no harness, or a Lean one naming no theorem, reached `passed` with 0 tests run.
// The Lean and Kani toolchains are #685's, run by hand; this runs the outcome rule alone.
import { describe, expect, it } from 'vitest';
import { finish } from '../src/run.js';

const parts = (testsRun: number) => ({ testsRun, failures: [], causes: [], proposals: [], tools: {}, read: [], evidence: [], receipt: '', smallest: null });

describe('a proof run', () => {
  it('that checked no theorem ran nothing', () => {
    expect(finish(parts(0)).result.outcome).toBe('ran_nothing');
  });
  it('that checked one, refusing nothing, passed', () => {
    expect(finish(parts(1)).result.outcome).toBe('passed');
  });
});
