// #1856 AC1 and AC2: deep-hook with the hub away and no ~/.deepbuild/rules.json, after setup and before it. Every hook
// runs as Claude Code's entry runs it (`deep-hook claude-code PreToolUse`, a Bash payload on stdin) in a temp HOME where
// no hub ever ran, so nothing listens at the hub's address. "After setup" is setup-finished.json in ~/.deepbuild, as
// the issue's Scope names it. Each criterion is decided by the `expect`s; a setup or control that can't be made throws
// BLOCKED or INCONCLUSIVE instead (helpers.ts), which never reads as a failure at an assertion.
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AC1, AC2, built, cleanup, decision, finishSetup, hook, makeHome, newSession, rootOf, rulesFile, said, seedDefaults, shown } from './helpers.ts';

beforeAll(built, 120_000);
afterEach(cleanup, 60_000);

const KILL = 'pkill -f node';

describe(`${AC1} after setup, rules.json deleted, the hub stopped`, () => {
  it(`${AC1} setup-finished.json there, rules.json deleted, no hub: \`${KILL}\` is denied and the denial names rules.json`, async () => {
    const home = makeHome();
    seedDefaults(home);
    finishSetup(home);
    const s = newSession(home);

    // Control: while the file setup wrote is there, the hub-away floor holds this call (no-kill-by-name, fail_closed).
    const before = await hook(home, s, KILL);
    if (decision(before) !== 'deny' || !said(before).includes('no-kill-by-name')) {
      throw Error(`BLOCKED: control: with rules.json there and the hub away, \`${KILL}\` must be denied by no-kill-by-name: ${shown(before)}`);
    }

    rmSync(rulesFile(home));
    const r = await hook(home, s, KILL);
    expect(decision(r), `after setup, with rules.json deleted and the hub stopped, the call \`${KILL}\` must be denied, not let run: ${shown(r)}`).toBe('deny');
    expect(said(r), `the denial of \`${KILL}\` must name rules.json: ${shown(r)}`).toContain('rules.json');
  }, 180_000);
});

describe(`${AC2} before setup, no ~/.deepbuild/rules.json`, () => {
  it(`${AC2} a home with no ~/.deepbuild at all, no hub: \`ls\` runs`, async () => {
    const home = makeHome();
    const s = newSession(home);
    if (existsSync(rootOf(home))) throw Error(`BLOCKED: the fresh home already holds ${rootOf(home)}`);
    const r = await hook(home, s, 'ls');
    expect(decision(r), `before setup, with no ~/.deepbuild/rules.json, \`ls\` must run: ${shown(r)}`).toBe('allow');
  }, 180_000);

  it(`${AC2} a ~/.deepbuild with neither rules.json nor setup-finished.json, no hub: \`ls\` runs`, async () => {
    const home = makeHome();
    mkdirSync(rootOf(home), { mode: 0o700 });
    const s = newSession(home);
    const r = await hook(home, s, 'ls');
    expect(decision(r), `before setup, with no ~/.deepbuild/rules.json, \`ls\` must run: ${shown(r)}`).toBe('allow');
  }, 180_000);
});
