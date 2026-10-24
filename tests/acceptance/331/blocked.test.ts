// The halves of #331's criteria whose surface another issue builds and which has none at this base: AC4's
// "at install", through the extension host's conformance before anything loads (#348) and the slot registry
// `deep.registerEnvironment` declares (#349); AC9's child agent, a session started as a child in its own
// worktree (#18) asking for its stack through `deep_env` in `deep mcp` (#26). Nothing missing passes (AGENTS.md,
// invariant 2): each test fails BLOCKED, naming what it waits on, until that issue lands and a blind redraft of
// this job writes it against the surface it publishes (README, What depends on other issues). The halves #331
// owns are tested in kit.test.ts (AC4) and stacks.test.ts (AC9).
import { describe, it } from 'vitest';

const blocked = (what: string): never => {
  throw Error(`BLOCKED: ${what}; this half of the criterion is tested once that surface exists, by a blind redraft of this job`);
};

describe('AC4 #331.5c02ca8a env-local passes environment@1, whose four planted environments each fail it at install', () => {
  it('AC4 installing each planted environment through deep.registerEnvironment is refused at install by environment@1, naming the route, the port, the process or the worktree, and env-local installs', () => {
    blocked('the extension host (#348), which runs a package\'s kit before it loads, and the slot registry behind deep.registerEnvironment (#349) aren\'t built at this base, so nothing can be installed');
  });
});

describe('AC9 #331.b23ec100 a child agent in its own worktree can\'t use a port its parent leased', () => {
  it('AC9 a child session started in its own worktree, calling deep_env through deep mcp, gets none of the ports its parent session leased, and a lease it asks for on one is refused naming the parent', () => {
    blocked('child sessions (session.child_started@1, mapped by the Claude Code adapter, #18) and the deep_env tool of deep mcp (#26) aren\'t built at this base, so no child agent can ask for its stack');
  });
});
