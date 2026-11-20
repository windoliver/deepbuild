// #1879's second criterion: the same hub started without `--safe` loads the package.
//
// "The same hub" is the first criterion's: `deep hub run` over a home with one installed package. Here the package is
// installed through `deep install` on a first hub, that hub is stopped, and the hub under test is started again over
// the same home with plain `deep hub run`. What "loaded" means is read where a user's agent reads it: the package's
// action is found through `deep mcp actions` and runs, with the output only the package's own code makes; and the
// hub's own output names no refusal of the package (README, Readings).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Agent, deep, makeWorktree, pkg, requestId, startHub, tempDir, TEST_TIMEOUT, WAIT, type Line } from './helpers.ts';

const PACKAGE = 'test/hello';
const VERSION = '1.0.0';
const ACTION = 'ext.hello.greet';
/** The hub's lines about the package not being loaded, or about safe mode, if it wrote any. */
const refusals = (stderr: string): string[] => stderr.split('\n').filter((l) => (l.includes(PACKAGE) && /not loaded|refused/i.test(l)) || /safe mode/i.test(l));

describe('#1879.81f0a695 The same hub started without `--safe` loads the package', () => {
  it('AC2 a hub started with `deep hub run` over a home with test/hello installed offers and runs its action, and names no refusal of it', async () => {
    const tmp = tempDir('hub');
    const home = join(tmp, 'h');
    mkdirSync(home);
    const worktree = makeWorktree(join(tmp, 'work'));

    // The home gets its one installed package: `deep install`, as a person runs it, on a first hub, then that hub stops.
    const first = await startHub(home, [], { confirm: true });
    const installed = await deep(['install', await pkg('hello')], home, WAIT.install);
    if (installed.code !== 0) {
      throw Error(`BLOCKED: deep install of ${PACKAGE} ${installed.timedOut ? `gave no answer in ${WAIT.install} ms` : `exited ${installed.code}`}: ${installed.stdout}${installed.stderr}\n${first.stderr().slice(-2000)}`);
    }
    await first.stop();

    // The start under test: the same home, no --safe.
    const hub = await startHub(home, []);
    expect(hub.ready.safe, `a hub started without --safe doesn't say safe in its ready line: ${JSON.stringify(hub.ready)}`).toBeUndefined();

    const agent = Agent.start(home, worktree);
    await agent.establish(hub, agent.session(worktree));
    await agent.initialize();
    const found = await agent.callTool('find_actions', { query: null });
    const said = () => refusals(hub.stderr()).join(' | ') || 'none';
    expect(found.isError, `find_actions must answer: ${JSON.stringify(found.reply).slice(0, 1500)}`).toBe(false);
    const actions = (found.value?.actions ?? []) as Line[];
    expect(
      actions.map((a) => `${a.extension} ${a.action}`),
      `the hub started without --safe did not load ${PACKAGE}@${VERSION}: deep-actions finds no ${ACTION} (the hub's refusals: ${said()})`,
    ).toContain(`${PACKAGE} ${ACTION}`);

    // Its code runs: the output is the one only the package's handler makes.
    const called = await agent.callTool('call_action', { action: ACTION, request: requestId(), input: JSON.stringify({ name: 'you' }) });
    expect(called.isError, `${PACKAGE}@${VERSION} is not loaded: ${ACTION} doesn't run (the hub's refusals: ${said()}): ${JSON.stringify(called.reply).slice(0, 1500)}`).toBe(false);
    expect(called.value, `${PACKAGE}@${VERSION} is not loaded: ${ACTION} gave no output of its own`).toMatchObject({ status: 'done', output: { greeting: 'hello, you, from test/hello', letters: 3 } });

    // And the hub names no refusal of it, by safe mode or otherwise.
    expect(refusals(hub.stderr()), `the hub started without --safe refused ${PACKAGE}@${VERSION}`).toEqual([]);
  }, TEST_TIMEOUT);
});
