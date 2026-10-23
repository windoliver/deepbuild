// The halves of #236's criteria whose surface another issue builds and which has none at this base: the
// read-only job of the runner (#159, AC4), the command check kind (#30) and the environment's stack (#36, AC13).
// Nothing missing passes (AGENTS.md, invariant 2): each test fails BLOCKED, naming what it waits on, until that
// issue lands and a blind redraft of this job writes it against the surface it publishes (README, What
// depends on other issues). The halves the supervisor owns are tested in contain.test.ts, hub.test.ts and
// host.test.ts.
import { describe, it } from 'vitest';

const blocked = (what: string): never => {
  throw Error(`BLOCKED: ${what}; this half of the criterion is tested once that surface exists, by a blind redraft of this job`);
};

describe('AC4 #236.cc0de139 a read-only job\'s undeclared write is refused by the sandbox, and recorded', () => {
  it('AC4 a read-only job run by the runner (#159) whose extension or MCP server writes outside what it declared is refused by the sandbox and the refusal recorded', () => {
    blocked('the runner of DeepBuild\'s headless jobs (#159) has no surface at this base, so no read-only job can be started through it');
  });
});

describe('AC13 #236.6e7cc737 checks and environments start, signal and wait only through host@1', () => {
  it('AC13 a command check\'s run (#30), with a recording test host in place of local, shows every start, signal and wait, and its verdict and evidence equal those on local', () => {
    blocked('the command check kind (#30) isn\'t built at this base');
  });
  it('AC13 an environment\'s stack (#36), with a recording test host in place of local, shows every start, signal and wait in its log', () => {
    blocked('environments (#36: deep env up, #331) aren\'t built at this base');
  });
  it('AC13 (wrong program) a check kind that spawns a child process itself leaves a start out of the log and fails, naming the check kind', () => {
    blocked('check kinds (#30, installed through the extension slots of #349) aren\'t built at this base, so no planted check kind can be installed');
  });
});
