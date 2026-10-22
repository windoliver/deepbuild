// The seeded claim generator for the #28 property tests. One seed gives one claim inside the rule table's
// settled ground (README: Open points, The generator): own checks have ended, running checks have runs of one
// polarity with captured evidence, never-started checks have no runs, every check declares inputs, person
// requirements have no covering checks, and there are no waivers.
import type { ClaimCheck, ClaimInput, ContractResult, EvidenceSlot, Failure, NumericContract, Requirement, Run, RunOutcome } from '../../../packages/verdicts/src/index.ts';
import { commitOf, digestOf, int, mulberry32, pick, reqId, T0, type Rng } from './helpers.ts';

export const GLOBS = ['src/**', 'docs/**', 'fixtures/**', 'lib/**'] as const;
export const PATHS = ['src/a.ts', 'src/cart/total.ts', 'docs/guide.md', 'fixtures/prices.json', 'lib/b.ts', 'scripts/build.sh'] as const;
const TESTS = ['cart.test.ts › rounds tax', 'checkout.test.ts › applies coupon', 'total.test.ts › sums lines'] as const;
const CAUSES = ['change:c1', 'change:c2', 'change:c3'] as const;
const DEPTHS = ['unit', 'integration', 'journey', 'live'] as const;

export const CONTRACT: NumericContract = {
  reference: { precision: 'fp64' }, accumulate: 'fp32',
  tolerances: [{ output: 'out', size: 4, atol: 1e-3, rtol: 1e-3, unit: 'value' }],
  twin: { accumulate: 'fp16' }, assert: 'assert_close',
};
const side = (outcome: 'passed' | 'failed', err: number): ContractResult['run'] =>
  ({ outcome, failed_at: outcome === 'failed' ? 'assert_close' : null, compared: { out: 4 }, largest_error: { out: err } });
const contractResult = (counts: boolean): ContractResult => counts
  ? { run: side('passed', 0), twin: side('failed', 0.004), outcome: 'counts', reasons: [] }
  : { run: side('passed', 0), twin: side('passed', 0.004), outcome: 'INVALID', reasons: ['the twin passed: largest error 0.004'] };

function subset<T>(rng: Rng, items: readonly T[], p: number): T[] {
  return items.filter(() => rng() < p);
}
function failures(rng: Rng): Failure[] {
  const n = 1 + int(rng, 2);
  const out: Failure[] = [];
  for (let i = 0; i < n; i++) {
    const test = pick(rng, TESTS);
    out.push({ test, message: `assertion failed in ${test}`, cause: pick(rng, CAUSES), frames: [{ file: 'src/a.ts', line: 1 + int(rng, 99) }], covers: ['src/a.ts'], case: rng() < 0.7 ? `n=${int(rng, 9)}` : null });
  }
  return out;
}
function evidence(rng: Rng, gaps: boolean): EvidenceSlot[] {
  const r = gaps ? rng() : 1;
  if (r < 0.04) return [{ slot: 'screenshot', state: 'missing', reason: 'simulator unavailable', outside_code: true }];
  if (r < 0.07) return [{ slot: 'screenshot', state: 'missing', reason: 'the page never rendered' }];
  if (r < 0.1) return [{ slot: 'video', state: 'truncated', counts: { kept: 3, expected: 5 } }];
  return [{ slot: 'report', state: 'captured', sha256: 'a'.repeat(64) }];
}

/** The claim seed `seed` draws. */
export function genClaim(seed: number): ClaimInput {
  const rng = mulberry32(seed);
  const D = commitOf(`D${seed}`), C = commitOf(`C${seed}`);
  const requirements: Requirement[] = [];
  const nReq = 1 + int(rng, 3);
  for (let i = 1; i <= nReq; i++) {
    const q: Requirement = { req: reqId(i), depth: pick(rng, ['unit', 'integration', 'journey'] as const), oracle: rng() < 0.12 ? 'person' : 'code', on_base: rng() < 0.5 ? 'fails' : 'passes' };
    if (q.oracle === 'person') {
      q.ask = `ask:A${seed % 1000}R${i}`;
      const answer = pick(rng, [undefined, 'unanswered', 'PASS', 'FAIL'] as const);
      if (answer !== undefined) q.answer = answer;
    } else if (rng() < 0.1) q.numbers = true;
    requirements.push(q);
  }
  const codeReqs = requirements.filter((q) => q.oracle !== 'person');
  const nChecks = rng() < 0.04 ? 0 : 1 + int(rng, 4);
  const checks: ClaimCheck[] = [];
  const runs: Run[] = [];
  let ended = T0;
  for (let j = 0; j < nChecks; j++) {
    const id = `check${j}`;
    const depth = pick(rng, DEPTHS);
    const c: ClaimCheck = {
      check: id, digest: digestOf(`${id}/${seed}`), source: pick(rng, ['spec', 'definition', 'definition', 'approved', 'own'] as const),
      depth, proof: depth === 'unit' || depth === 'integration' ? 'test_run' : 'journey',
      covers: subset(rng, codeReqs.map((q) => q.req), 0.6),
      inputs: rng() < 0.8 ? [pick(rng, GLOBS)] : [pick(rng, GLOBS), pick(rng, GLOBS)],
      environment: { os: 'darwin-arm64', viewport: '1280x720' }, tools: { node: '22.11.0' },
    };
    const s = rng();
    c.state = c.source === 'own' || s < 0.6 ? 'ended' : s < 0.82 ? 'running' : 'never_started';
    if (c.state === 'never_started') c.never_started = pick(rng, ['quick_check_failed', 'kept_working', 'loop', 'newer_claim'] as const);
    // Only an ended check carries defects known without its runs; a running or never-started one is clean.
    const isEnded = c.state === 'ended';
    const rate = rng();
    if (rate < 0.5) { /* neither: one clean run */ } else if (rate < 0.72) c.runs = 1 + int(rng, 3);
    else if (rate < 0.82) c.accept = '45%';
    else if (rate < 0.9 || !isEnded) c.accept = '95%';
    else c.accept = pick(rng, ['0%', '100%', '-5%', '10']);
    if (isEnded && rng() < 0.05) c.cant_fail = 'exit status masked by `|| true`';
    if (rng() < 0.15) c.contract = CONTRACT;
    const fix = c.covers.some((req) => requirements.find((q) => q.req === req)?.on_base === 'fails');
    if (fix) c.base = isEnded ? { outcome: rng() < 0.85 ? 'failed' : 'passed', on_assertion: rng() < 0.9, failed_tests: subset(rng, TESTS, 0.5) } : { outcome: 'failed', on_assertion: true, failed_tests: [] };
    else if (rng() < 0.35) c.base = { outcome: 'failed', on_assertion: true, failed_tests: [...new Set([pick(rng, TESTS), ...subset(rng, TESTS, 0.4)])] };
    checks.push(c);
    if (c.state === 'never_started') continue;
    const running = c.state === 'running';
    const polarity: RunOutcome = rng() < 0.5 ? 'passed' : 'failed';
    const nRuns = int(rng, 6);
    for (let k = 0; k < nRuns; k++) {
      let outcome: RunOutcome;
      if (running) outcome = rng() < 0.08 ? 'missing' : rng() < 0.2 ? 'uncounted' : polarity;
      else {
        const o = rng();
        outcome = o < 0.4 ? 'passed' : o < 0.62 ? 'failed' : o < 0.67 ? 'overran' : o < 0.72 ? 'ran_nothing' : o < 0.77 ? 'missing' : o < 0.82 ? 'stopped' : 'uncounted';
      }
      const r: Run = {
        run: `run:S${seed}C${j}K${k}`, check: id, claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', commit: rng() < 0.65 ? D : C, digest: c.digest,
        environment: { ...c.environment }, tools: { ...c.tools }, outcome, ended: ++ended,
        tests_run: outcome === 'passed' ? (!running && rng() < 0.05 ? 0 : 1 + int(rng, 20)) : outcome === 'failed' ? 1 + int(rng, 20) : 0,
        reads: subset(rng, PATHS, 0.15), failures: outcome === 'failed' ? failures(rng) : [],
        evidence: evidence(rng, !running), kept: rng() < 0.92,
      };
      const mismatch = rng();
      if (mismatch < 0.04) r.digest = digestOf(`other/${seed}/${k}`);
      else if (mismatch < 0.08) r.environment = { ...r.environment, viewport: '1440x900' };
      else if (mismatch < 0.12) r.tools = { node: '20.18.0' };
      if (outcome === 'missing') r.missing = { cause: pick(rng, ['secret STRIPE_TEST_KEY not set', 'simulator unavailable']), owner: pick(rng, ['you', 'ops']), since: T0 };
      if (c.contract && (outcome === 'passed' || outcome === 'failed')) r.contract = contractResult(running || rng() < 0.8);
      runs.push(r);
    }
  }
  const changes = rng() < 0.85 ? [{ from: C, paths: subset(rng, PATHS, 0.3) }] : [];
  return {
    claim: `claim:G${seed}`, agent: 'session:01K74FQ8S1T2V3W4X5Y6Z7A8B9', repo: 'shop', task: 'task:01K74FX2B4D6F8H0K2M4P6R8T0',
    commit: D, requirements, checks, runs, changes, waivers: [], now: T0 + 1_000_000,
  };
}

/** The same claim with its run records shuffled and some sent twice. */
export function reorder(claim: ClaimInput, seed: number): ClaimInput {
  const rng = mulberry32(seed ^ 0x5eed);
  const runs = [...claim.runs, ...claim.runs.filter(() => rng() < 0.3)];
  for (let i = runs.length - 1; i > 0; i--) {
    const j = int(rng, i + 1);
    [runs[i], runs[j]] = [runs[j]!, runs[i]!];
  }
  return { ...claim, runs };
}
