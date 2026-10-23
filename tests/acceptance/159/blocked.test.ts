// The halves of #159's criteria whose surface another issue builds and which has none at this base. Nothing
// missing passes (AGENTS.md, invariant 2): each test fails BLOCKED, naming what it waits on, until that issue lands
// and a blind redraft of this job writes it against the surface it publishes (README, What depends on other
// issues). The runner's own halves are tested through its surface in hub.test.ts, isolation.test.ts and
// plan.test.ts.
import { describe, it } from 'vitest';
import { blocked } from './helpers.ts';

describe('AC1 #159.bbb96a19 a drafting job and a review check leave no session, claim, verdict or spend', () => {
  it('AC1 (the job kinds\' half) the drafting job (#81, #50) and the review check\'s second model (#87) themselves run through the runner, and leave no session row, claim, verdict or task spend', () => {
    blocked('the drafting job (#81, #50) and the review check (#87) aren\'t built at this base; the runner\'s half runs jobs of kind draft and review in hub.test.ts');
  });
});

describe('AC10 #159.fe8b9734 a session that cds into a job\'s folder or resumes a job\'s session ID is judged as itself', () => {
  it('AC10 (the gate\'s half) such a session still has its stop held and judged, and its claim and spend recorded as its own', () => {
    blocked('the Stop hold for Claude Code (#25) and the claims and spend of a Claude Code session (#18, deep_claim through deep mcp #26) aren\'t built at this base; the hub\'s half (its own session, a reading naming it, the job\'s early hook) is in hub.test.ts');
  });
});

describe('AC16 #159.df0e6721 a drafting job sees none of the session\'s work; a review sees only the diff', () => {
  it('AC16 (the job kinds\' half) the drafting job built from a task gets none of its transcript, diff, claim or PR body, and the review check gets the diff alone; a job kind that passes the PR body to the review, or the diff to the drafting job, fails naming the marker', () => {
    blocked('the drafting job (#81, #50) and the review check (#87), which choose a task\'s inputs, aren\'t built at this base; the runner\'s half (only what a job\'s spec gives reaches its stdin and folder) is in isolation.test.ts');
  });
});

describe('AC20 #159.641cb71a after Claude Code updates past its facts, the first session starts the smoke test under your standing approval', () => {
  it('AC20 (the session\'s half) the first session on an uncovered version starts the smoke test through the runner; its recorded payloads come to you as one diff; holds stay watch-only until you approve it; without the standing approval the session\'s row says the smoke test waits for you', () => {
    blocked('the hub reads every live hook as the newest covered version at this base (no session\'s agent version is read, #18), and holds (#25) and the corpus diff for approval (#47\'s recorder) have no surface to start a smoke test from a session; the runner\'s half is in plan.test.ts');
  });
});
