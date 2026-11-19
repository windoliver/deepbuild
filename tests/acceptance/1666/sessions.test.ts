// AC1 and AC2: for each of Claude Code and Codex, one session started on a test home under an approval, whose one
// command commits in its worktree and then tries each write AC2 names. Both criteria read that same session
// (README, How each criterion is read).
import { test } from 'vitest';
import { AC, AGENTS, commitsOnItsBranch, named, refusesTheRest, startedSession, type Agent, type Session } from './helpers.ts';

const sessions = new Map<Agent, Promise<Session>>();
const sessionOf = (agent: Agent): Promise<Session> => {
  const started = sessions.get(agent) ?? startedSession(agent);
  sessions.set(agent, started);
  return started;
};

for (const agent of AGENTS) {
  test(`${AC[1]} ${named(agent)}: a command in a started session commits in its worktree, and the commit is on the session's branch`, async () => {
    commitsOnItsBranch(await sessionOf(agent));
  });
  test(`${AC[2]} ${named(agent)}: that command's writes to a tracked file in the checkout, its .git/index and .git/HEAD, and another worktree's git folder are each refused`, async () => {
    refusesTheRest(await sessionOf(agent));
  });
}
