// AC3: a PASS resting only on a model's judgment is refused (Scope: "a model's judgment alone can send a claim back
// but never pass it"; Fields, the Check primitive: "It can never: Produce a PASS on a model's judgment alone").
//
// Through the core's verdict engine, on one claim whose one requirement R1 is covered by one check with one clean
// passed run: with the check's oracle code (the control) the claim passes; with the check's oracle a model, as the
// review check's is, the claim is never PASS; and with R1's own oracle a model, even a passing code check doesn't make
// it PASS. #68 landed this rule in the engine, so at the base this test already passes: it is the regression guard,
// and its wrong program is a planted engine that reads no oracle (the engine before #68), which must fail it.
import { describe, it } from 'vitest';
import { verdict } from '../../../../packages/verdicts/src/index.ts';
import type { ClaimCheck, ClaimInput, Oracle, Verdict } from '../../../../packages/verdicts/src/index.ts';
import { AC3, failureOf, must } from './helpers.ts';

const HEAD = 'c'.repeat(40);
const T0 = 1_761_955_200_000;
const ENV = { os: 'darwin' };

/** A claim whose one requirement R1 (oracle `req`) one check (oracle `check`) covers, with one clean passed run. */
function claim(o: { req: Oracle; check: Oracle }): ClaimInput {
  const name = o.check === 'model' ? 'check:review' : 'check:unit';
  const c: ClaimCheck = {
    check: name, digest: `d1:${name}`, source: 'definition', depth: 'unit', proof: o.check === 'model' ? 'static_check' : 'test_run', covers: ['R1'],
    environment: { ...ENV }, tools: {}, oracle: o.check,
  };
  return {
    claim: 'claim:87', agent: 'session:agent', repo: 'repo:shop', task: 'task:87', commit: HEAD,
    requirements: [{ req: 'R1', depth: 'unit', oracle: o.req, on_base: 'passes' }],
    checks: [c],
    runs: [{
      run: `run:${name.slice(6)}`, check: name, claim: 'claim:87', commit: HEAD, digest: `d1:${name}`, environment: { ...ENV }, tools: {},
      outcome: 'passed', started: T0, ended: T0 + 1, tests_run: 1, reads: ['src/cart.ts'], failures: [], evidence: [], kept: true,
    }],
    changes: [], waivers: [], now: T0 + 2,
  };
}
type Engine = (c: ClaimInput) => Verdict;
const said = (v: Verdict): string => `${v.outcome}; reasons: ${v.reasons.join(' | ') || '(none)'}`;

function judge(engine: Engine): void {
  const control = engine(claim({ req: 'code', check: 'code' }));
  must(control.outcome === 'PASS', `BLOCKED: ${AC3} the control, R1 covered by a passing check whose oracle is code, must PASS: ${said(control)}`);
  const reviewOnly = engine(claim({ req: 'code', check: 'model' }));
  must(reviewOnly.outcome !== 'PASS', `${AC3} R1 covered only by a review whose oracle is a model, with a clean passed run, rests on that model's judgment alone, so it is refused: the verdict is ${said(reviewOnly)}`);
  const modelReq = engine(claim({ req: 'model', check: 'code' }));
  must(modelReq.outcome !== 'PASS', `${AC3} R1 whose own oracle is a model rests on a model's judgment, whatever code check passes beside it, so it is refused: the verdict is ${said(modelReq)}`);
}

/** The planted wrong engine: the engine before #68, which reads no oracle (every check and requirement as code's). */
const oracleBlind: Engine = (c) => verdict({
  ...c,
  requirements: c.requirements.map((q) => ({ ...q, oracle: 'code' })),
  checks: c.checks.map(({ oracle: _oracle, ...check }) => check),
});

describe(`${AC3} a PASS resting only on a model's judgment is refused`, () => {
  it(`${AC3} the core's verdict engine passes R1 on a code check and refuses PASS on a review (oracle model) alone and on a requirement whose oracle is a model`, () => {
    judge(verdict);
  });

  it(`${AC3} (wrong program) a planted engine that reads no oracle passes the review alone and fails this test`, async () => {
    const failure = await failureOf(() => judge(oracleBlind));
    must(failure !== null, `${AC3} the oracle-blind engine must fail this test: it passed`);
    must(failure.startsWith(AC3) && /model/.test(failure), `${AC3} the oracle-blind engine fails where it gives a model's judgment PASS; it failed elsewhere: ${failure}`);
  });
});
