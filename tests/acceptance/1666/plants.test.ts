// The wrong programs the criteria name, per agent: a hub planted with each (DEEP_HUB_PLANT) starts the same session,
// and the same reading must fail on it for the reason the criterion names. A hub that doesn't list a plant refuses to
// start, which reads BLOCKED (README, Plants).
import { expect, test } from 'vitest';
import { AC, AGENTS, agentSaid, commitsOnItsBranch, failureOf, named, refusesTheRest, startedSession } from './helpers.ts';

for (const agent of AGENTS) {
  test(`${AC[1]} ${named(agent)}: a start whose sandbox leaves the worktree's git folder closed fails the test, naming index.lock`, async () => {
    const s = await startedSession(agent, { plant: 'sandbox-closes-worktree-git' });
    expect(s.report, `the planted session's command ran in its worktree: ${agentSaid(s)}`).toBeTruthy();
    const failure = await failureOf(() => commitsOnItsBranch(s));
    expect(failure, 'the planted start fails the test').not.toBeNull();
    expect(failure, 'naming index.lock').toContain('index.lock');
  });
  test(`${AC[2]} ${named(agent)}: a sandbox that opens the repo's whole .git lets the writes through and fails the test, naming each path`, async () => {
    const s = await startedSession(agent, { plant: 'sandbox-opens-whole-git' });
    expect(s.report, `the planted session's command ran in its worktree: ${agentSaid(s)}`).toBeTruthy();
    const failure = await failureOf(() => refusesTheRest(s));
    expect(failure, 'the planted sandbox fails the test').not.toBeNull();
    for (const path of [s.w.index, s.w.head, s.w.otherGitDir]) expect(failure, `naming ${path}`).toContain(path);
  });
}
