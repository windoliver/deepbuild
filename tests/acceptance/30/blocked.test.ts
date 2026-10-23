// The halves of #30's criteria whose surface another unbuilt issue owns. Nothing missing passes (AGENTS.md,
// invariant 2): each test fails BLOCKED, naming what it waits on, until that issue lands and a blind redraft of this
// job writes it against the surface it publishes (README, What depends on other issues). The command check kind's
// own half of each criterion is tested for real in the file named beside it.
//
// The claim's verdict halves wait on the gate runner (#29): the verdict engine (#28) judges a claim's run records,
// but the claim itself (which runs of which check count for it, a check's `cant_fail` from the core's masked-exit
// rule, which tests a claim adds or changes, which requirement is about what real users get) is built by #29.
import { describe, it } from 'vitest';

const blocked = (what: string): never => {
  throw Error(`BLOCKED: ${what}; this half of the criterion is tested once that surface exists, by a blind redraft of this job`);
};
const GATE = 'the gate runner (#29), which builds a claim from its checks\' runs and has the verdict engine judge it, has no surface at this base';

describe('AC2 #30.5f9be4a0 a suite that runs zero tests is INVALID (the claim\'s half; the run\'s is in record.test.ts)', () => {
  it('AC2 a claim whose check\'s run ran zero tests is INVALID, naming the check, never PASS', () => {
    blocked(GATE);
  });
});

describe('AC5 #30.47dbce22 with the command check kind replaced by a test check kind installed with `replaces`, its checks are still sandboxed (the slot\'s half; the kind\'s is in sandbox.test.ts)', () => {
  it('AC5 a test check kind installed with `replaces` in place of the command check kind runs a check that still can\'t reach the hub\'s socket or write outside its declared paths', () => {
    blocked('installing a check kind with `replaces` needs the extension slots (#349) and the extension host (#348), which have no surface at this base');
  });
});

describe('AC7 #30.b213a878 an overrun counts as a failed run; a run a hub restart cuts short is INCONCLUSIVE, never PASS or FAIL (the claim\'s half; the run\'s is in ending.test.ts)', () => {
  it('AC7 a check whose run overran its deadline counts it as a failed run in the claim\'s verdict; a crash of its own is a failed run too', () => {
    blocked(GATE);
  });
  it('AC7 a check run in the hub that a hub restart cuts short is kept as stopped and makes the claim INCONCLUSIVE, never PASS or FAIL', () => {
    blocked(`${GATE}, and no check runs in the hub through the command check kind until it does`);
  });
});

describe('AC8 #30.626ffab8 a stand-in can\'t pass a requirement about what real users get (the claim\'s half; the marking is in standin.test.ts)', () => {
  it('AC8 a requirement about what real users get, covered by the stand-in check, stays INCONCLUSIVE; covered by its twin, it can pass', () => {
    blocked(`${GATE}; and no requirement at this base says it is about what real users get`);
  });
});

describe('AC9 #30.506a2ee0 a failure in any of the six runs while another passes makes the claim INCONCLUSIVE; a test that fails every run is FAIL (the claim\'s half; the runs are in added.test.ts)', () => {
  it('AC9 the claim that adds the test failing only a month ahead is INCONCLUSIVE, naming the test and keeping each failing run\'s output; the claim whose added test fails every run is FAIL', () => {
    blocked(`${GATE}, and which tests a claim adds or changes is the gate's to say`);
  });
});

describe('AC10 #30.9c363cec `pnpm test || true` is INVALID naming "exit status masked by `|| true`", never PASS; the bare `pnpm test` is FAIL (the claim\'s half; the runs are in mask.test.ts)', () => {
  it('AC10 the claim on the masked check is INVALID, naming "exit status masked by `|| true`"; the claim on the bare check is FAIL', () => {
    blocked(`${GATE}, and the core's masked-exit rule it shares with the validity gate (#29) is not built either`);
  });
});

describe('AC14 #30.4df04268 the FAIL names src/cart.test.ts and line 30 (the claim\'s half; the stored output and the failure\'s place are in privacy.test.ts)', () => {
  it('AC14 the claim\'s FAIL from the cart check names src/cart.test.ts:30', () => {
    blocked(GATE);
  });
});

describe('AC17 #30.a06dc35a a test that fails and then passes on its retry is a pass and a fail on that commit, so its check is INCONCLUSIVE naming the test (the claim\'s half; the attempts are in retries.test.ts)', () => {
  it('AC17 the claim on the retry suite\'s check is INCONCLUSIVE, naming "settles the order"', () => {
    blocked(GATE);
  });
});

describe('AC19 #30.aebc2446 the sample check is INVALID naming the output and its twin counts; a timing check\'s unflushed repeat is recorded as not flushed (the claim\'s and #87\'s halves; the counts are in contract.test.ts)', () => {
  it('AC19 the claim on the check that compared 40,960 of out\'s 4,096,000 elements is INVALID, naming out; the claim on its twin, which compared them all, counts it', () => {
    blocked(GATE);
  });
  it('AC19 a timing check whose report leaves out whether a repeat\'s caches were flushed records that repeat as not flushed, never cold', () => {
    blocked('the timing check (#87), its timed repeats and the report that says whether each repeat\'s caches were flushed have no surface at this base');
  });
});
