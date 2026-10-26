// The half of #331's AC9 whose surface another issue builds and which has none at this base: a session started as
// a child in its own worktree (#18) asking for its stack through `deep_env` in `deep mcp` (#26). Nothing missing
// passes (AGENTS.md, invariant 2): the test fails BLOCKED, naming what it waits on, until those issues land and a
// blind redraft of this job writes it against the surface they publish (README, What depends on other issues). The
// worktree half #331 owns is tested in stacks.test.ts. AC4's "at install" half, blocked here until #348 and #349
// landed, is now install.test.ts, written by that redraft.
import { describe, it } from 'vitest';

const blocked = (what: string): never => {
  throw Error(`BLOCKED: ${what}; this half of the criterion is tested once that surface exists, by a blind redraft of this job`);
};

describe('AC9 #331.b23ec100 a child agent in its own worktree can\'t use a port its parent leased', () => {
  it('AC9 a child session started in its own worktree, calling deep_env through deep mcp, gets none of the ports its parent session leased, and a lease it asks for on one is refused naming the parent', () => {
    blocked('child sessions (session.child_started@1, mapped by the Claude Code adapter, #18) and the deep_env tool of deep mcp (#26) aren\'t built at this base, so no child agent can ask for its stack');
  });
});
