// AC5, the command check kind's half: a check it runs can't reach the hub's socket or write outside its run's own
// folders, because the supervisor (#236) sandboxes every process it starts and the command check kind starts its
// processes only through host@1, building no sandbox of its own. Swapping the kind for a test check kind
// installed with `replaces` (#349, #348) is in replaces.test.ts.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { runCommandCheck } from '../../../packages/checks-command/src/index.ts';
import { closeListeners, command, dataOf, lineAfter, openWorld, outputOf, project, recording, tempDir, unixListener, VITEST, waitFor, type World } from './helpers.ts';

const worlds: World[] = [];
afterEach(closeListeners);
afterAll(async () => { for (const w of worlds.splice(0)) await w.close(); });

/** The escape fixture's check, with a live listener for the hub's socket and a path outside every folder of the run. */
async function escape(world: World) {
  const outside = join(tempDir('outside'), 'escaped.txt');
  const hub = await unixListener(join(tempDir('hub'), 'hub.sock'));
  const { host, calls } = recording(world.sup);
  const check = command(host, project('escape'), VITEST, { env: { HUB_SOCKET: hub.path, OUTSIDE: outside } });
  const r = await runCommandCheck(check);
  return { r, hub, outside, calls };
}

describe('AC5 #30.47dbce22 a check can\'t reach the hub\'s socket or write outside its declared paths, since the supervisor sandboxes it (#236)', () => {
  it('AC5 a check the command check kind runs is refused the hub\'s socket and a write outside its folders by the supervisor\'s sandbox, which records the denial against its run; its start and wait go through host@1', async () => {
    const world = await openWorld();
    worlds.push(world);
    const { r, hub, outside, calls } = await escape(world);
    expect(['EPERM', 'EACCES'], `the connect to the hub's socket: ${outputOf(r).slice(0, 800)}`).toContain(lineAfter(r, 'HUB '));
    expect(['EPERM', 'EACCES'], 'the write outside the run\'s folders').toContain(lineAfter(r, 'WRITE '));
    expect(hub.connections(), 'the hub\'s socket saw a connection').toBe(0);
    expect(existsSync(outside), `${outside} was written`).toBe(false);
    expect(r.outcome).toBe('passed');
    await waitFor(async () => (await world.events('sandbox.denied')).some((e) => dataOf(e).run === r.run && String(dataOf(e).target).includes(outside)), 15_000, `sandbox.denied for ${r.run} naming ${outside}`);
    const mine = calls.filter((c) => c.run === r.run).map((c) => c.call);
    expect(mine, 'the run started through host@1').toContain('start');
    expect(mine, 'the run was waited for through host@1').toContain('wait');
  }, 180_000);

  it('AC5 the command check kind builds no sandbox of its own: on a supervisor planted to leave the sandbox to its caller, the same check reaches the hub\'s socket and writes outside, so the confinement above is the supervisor\'s, which a replacing check kind keeps', async () => {
    const world = await openWorld('sandbox-left-to-caller');
    worlds.push(world);
    const { r, hub, outside } = await escape(world);
    const confined = `the command check kind confined its check itself (hub socket: ${lineAfter(r, 'HUB ')}, write: ${lineAfter(r, 'WRITE ')}); a check kind installed in its place would not be`;
    expect(hub.connections(), confined).toBeGreaterThan(0);
    expect(existsSync(outside), confined).toBe(true);
  }, 180_000);
});
