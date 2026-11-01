// AC5, the slot's half: with the command check kind replaced by a test check kind installed with `replaces` (#349,
// #348), a check it runs still can't reach the hub's socket or write outside its declared paths, since the
// supervisor (#236) sandboxes every process the kind starts through the host@1 the hub hands it. The kind's own
// half (the shipped kind builds no sandbox) is in sandbox.test.ts. The twin here runs the same kind on a supervisor
// planted to leave the sandbox to its caller: the check then reaches both, so the confinement is the supervisor's
// and not something the kind, the slot or its kit built.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { CHECKS_COMMAND_DIST, closeListeners, dataOf, openHostOn, openWorld, pkg, project, spec, tempDir, unixListener, VITEST, waitFor, type World } from './helpers.ts';

const worlds: World[] = [];
afterEach(closeListeners);
afterAll(async () => { for (const w of worlds.splice(0)) await w.close(); });

/** The test check kind installed in the hub of a fresh host on `world`, in place of `command`, its checks given `env`. */
async function installed(world: World, env: Record<string, string>): Promise<ExtensionHost> {
  if (!existsSync(CHECKS_COMMAND_DIST)) throw Error(`BLOCKED: ${CHECKS_COMMAND_DIST} isn't built (npm run build --workspaces), and a package in the hub imports the command runner from it`);
  const dir = pkg('command-kind', { 'command.json': JSON.stringify({ command: CHECKS_COMMAND_DIST, env }) });
  const host = await openHostOn(world, [dir]);
  const installedPkg = await host.install({ from: dir, builtBy: null });
  expect(installedPkg.kits ?? [], `the install ran check.kind@1's kit on the kind installed with replaces: ${JSON.stringify(installedPkg.kits)}`).toContainEqual({ slot: 'check.kind@1', fill: 'command', verdict: 'PASS' });
  expect((await host.check(installedPkg)).passed, 'the package passes conformance').toBe(true);
  const load = await host.load(installedPkg);
  expect(load.status === 'loaded' && load.place, `the package loads in the hub: ${JSON.stringify(load)}`).toBe('hub');
  expect((await host.checks()).filter((c) => c.kind === 'command').map((c) => c.extension), 'the command kind is the test package\'s now').toEqual(['deepbuild/test-command']);
  return host;
}
/** The escape fixture's check run through the replacing kind, with a live listener for the hub's socket and a path outside every folder of the run. */
async function escape(world: World) {
  const outside = join(tempDir('outside'), 'escaped.txt');
  const hub = await unixListener(join(tempDir('hub'), 'hub.sock'));
  const host = await installed(world, { HUB_SOCKET: hub.path, OUTSIDE: outside });
  const r = await host.runCheck('command', spec(VITEST), { checkout: project('escape'), deadline: 180_000 });
  return { r, hub, outside };
}

describe('AC5 #30.47dbce22 with the command check kind replaced by a test check kind installed with `replaces`, its checks are still sandboxed (the slot\'s half; the kind\'s is in sandbox.test.ts)', () => {
  it('AC5 a test check kind installed with `replaces` in place of the command check kind runs a check that still can\'t reach the hub\'s socket or write outside its declared paths; the supervisor records the denial', async () => {
    const world = await openWorld();
    worlds.push(world);
    const { r, hub, outside } = await escape(world);
    expect(r.outcome, `the escape suite passes only when both tries were refused: ${JSON.stringify(r.failures)} ${r.evidence.join(' | ')}`).toBe('passed');
    expect(r.testsRun).toBe(2);
    expect(hub.connections(), 'the hub\'s socket saw a connection').toBe(0);
    expect(existsSync(outside), `${outside} was written`).toBe(false);
    await waitFor(async () => (await world.events('sandbox.denied')).some((e) => String(dataOf(e).target).includes(outside)), 15_000, `sandbox.denied naming ${outside}`);
  }, 600_000);

  it('AC5 (wrong program) on a supervisor planted to leave the sandbox to its caller, the same kind\'s check reaches the hub\'s socket and writes outside: the confinement is the supervisor\'s, and a sandbox built inside the command check kind, or the slot, would fail this test', async () => {
    const world = await openWorld('sandbox-left-to-caller');
    worlds.push(world);
    const { r, hub, outside } = await escape(world);
    const confined = `the check was confined by something other than the supervisor (outcome ${r.outcome}: ${JSON.stringify(r.failures.map((f) => f.test))})`;
    expect(hub.connections(), confined).toBeGreaterThan(0);
    expect(existsSync(outside), confined).toBe(true);
  }, 600_000);
});
