// The concrete claim each abstract vector of the Lean model stands for (see agree.test.ts).
import type { ClaimCheck, ClaimInput, EvidenceSlot, Requirement, Run } from '../../packages/verdicts/src/index.ts';

export interface AReq { id: number; depth: number; person: null | 'open' | 'unanswered' | 'PASS' | 'FAIL'; numbers: boolean; fix: boolean }
export type ABase = null | { outcome: 'passed' } | { outcome: 'failed'; on_assertion: boolean; tests: number[] };
export interface ACheck { id: number; own: boolean; depth: number; covers: number[]; need: number | null; cant_fail: boolean; base: ABase; contract: boolean; state: 'auto' | 'running' | 'ended' | 'never_started' }
export interface ARun {
  id: number; check: number; counts: boolean; outcome: Run['outcome']; tests: number;
  failures: { test: number; waived: boolean }[]; evidence: string[]; contract: 'none' | 'counts' | 'INVALID';
}
export interface Vector { seed: number; claim: { reqs: AReq[]; checks: ACheck[]; runs: ARun[]; bad_state: boolean }; verdict: string; checks: string[]; reqs: string[]; rows: string[] }

const D = 'd'.repeat(40), C = 'c'.repeat(40), E = 'e'.repeat(40);
const DEPTHS = ['unit', 'integration', 'journey', 'live'] as const;
const TESTS = ['a.test.ts › t0', 'a.test.ts › t1', 'a.test.ts › t2'];
const ENV = { os: 'darwin-arm64' }, TOOLS = { node: '24.22.0' };
const NOW = 1_000_000;
export const reqId = (i: number): string => `req:DEF#R${i}`;
const digest = (i: number): string => `d1:${i.toString(16).padStart(64, '0')}`;
const CONTRACT = {
  reference: { precision: 'fp64' as const }, accumulate: 'fp32' as const,
  tolerances: [{ output: 'out', size: 4, atol: 1e-3, rtol: 1e-3, unit: 'value' }], twin: { accumulate: 'fp16' as const }, assert: 'assert_close',
};
const side = (outcome: 'passed' | 'failed') => ({ outcome, failed_at: outcome === 'failed' ? 'assert_close' : null, compared: { out: 4 }, largest_error: { out: 0 } });

function slot(state: string, i: number): EvidenceSlot {
  const name = `slot${i}`;
  switch (state) {
    case 'captured': return { slot: name, state: 'captured', sha256: 'a'.repeat(64) };
    case 'not_requested': return { slot: name, state: 'not_requested' };
    case 'no_digest': return { slot: name, state: 'captured' };
    case 'missing_outside': return { slot: name, state: 'missing', reason: 'simulator unavailable', outside_code: true };
    case 'missing': return { slot: name, state: 'missing', reason: 'the page never rendered' };
    case 'truncated': return { slot: name, state: 'truncated', counts: { kept: 3, expected: 5 } };
    default: throw new Error(`unknown evidence ${state}`);
  }
}

/** The concrete claim an abstract one stands for: each abstract field realized the way the engine reads it. */
export function concretize(v: Vector['claim']): ClaimInput {
  const requirements: Requirement[] = v.reqs.map((q) => {
    const r: Requirement = { req: reqId(q.id), depth: DEPTHS[q.depth]!, oracle: q.person ? 'person' : 'code', on_base: q.fix ? 'fails' : 'passes' };
    if (q.numbers) r.numbers = true;
    if (q.person) {
      r.ask = `ask:A${q.id}`;
      if (q.person !== 'open') r.answer = q.person;
    }
    return r;
  });
  const checks: ClaimCheck[] = v.checks.map((a) => {
    const c: ClaimCheck = {
      check: `check${a.id}`, digest: digest(a.id), source: a.own ? 'own' : 'definition', depth: DEPTHS[a.depth]!, proof: 'test_run',
      covers: a.covers.map(reqId), inputs: ['src/**'], environment: { ...ENV }, tools: { ...TOOLS },
    };
    // Unreadable: a rate outside (0, 100%). One clean run: undeclared, or `runs: 1` for odd IDs.
    if (a.need === null) c.accept = '0%';
    else if (a.need > 1 || a.id % 2 === 1) c.runs = a.need;
    if (a.cant_fail) c.cant_fail = 'exit status masked by `|| true`';
    if (a.base) c.base = a.base.outcome === 'passed'
      ? { outcome: 'passed', on_assertion: false, failed_tests: [] }
      : { outcome: 'failed', on_assertion: a.base.on_assertion, failed_tests: a.base.tests.map((t) => TESTS[t]!) };
    if (a.contract) c.contract = CONTRACT;
    if (a.state !== 'auto') c.state = a.state;
    if (a.state === 'never_started') c.never_started = 'loop';
    return c;
  });
  const runs: Run[] = v.runs.map((a) => {
    const r: Run = {
      run: `run:R${a.id}`, check: `check${a.check}`, claim: 'claim:X', commit: a.id % 2 === 0 ? D : C, digest: digest(a.check),
      environment: { ...ENV }, tools: { ...TOOLS }, outcome: a.outcome, ended: 1000 + a.id, tests_run: a.tests, reads: [],
      failures: a.failures.map((f) => ({ test: TESTS[f.test]!, message: `${f.waived ? 'waived' : 'broke'} ${f.test}`, cause: 'change:c1', frames: [], covers: [], case: null })),
      evidence: a.evidence.map(slot), kept: true,
    };
    // A run that doesn't count: its key or its evidence or its commit keeps it out, one way per run ID.
    if (!a.counts) {
      const way = a.id % 5;
      if (way === 0) r.digest = digest(1000 + a.check);
      else if (way === 1) r.environment = { os: 'linux-x64' };
      else if (way === 2) r.tools = { node: '20.18.0' };
      else if (way === 3) r.kept = false;
      else r.commit = E;
    }
    if (a.outcome === 'missing') r.missing = { cause: 'secret STRIPE_TEST_KEY not set', owner: 'ops', since: 0 };
    if (a.contract === 'counts') r.contract = { run: side('passed'), twin: side('failed'), outcome: 'counts', reasons: [] };
    if (a.contract === 'INVALID') r.contract = { run: side('passed'), twin: side('passed'), outcome: 'INVALID', reasons: ['the twin passed'] };
    return r;
  });
  const waivers = v.checks.flatMap((a) => [0, 1, 2].map((t) => ({
    check: `check${a.id}`, error: `waived ${t}`, owner: 'person:owner', approved_by: 'person:owner', ends: { date: NOW + 1 },
  })));
  return {
    claim: 'claim:X', agent: 'session:A', repo: 'shop', task: 'task:T', commit: D, requirements, checks, runs,
    // Runs on C carry: the change from C touches nothing. Runs on E don't: the claim names no change from it.
    changes: [{ from: C, paths: [] }], waivers, now: NOW, ...(v.bad_state ? { state: ['not-a-digest'] } : {}),
  };
}
