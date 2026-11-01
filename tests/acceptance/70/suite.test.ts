// #70 AC4: the bubblewrap backend passes the platform sandbox's suite (#236) on the Linux this runs on, named in the
// output; the planted backend that allows egress still fails it here, naming the egress case; and a profile without
// its network filter fails the egress case, naming it. Each wrong program is also checked to be the wrong program it
// says it is, by a probe of the test's own run through its `confine` and through the real backend's (README, AC4).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  bins, cleanup, closeListeners, expectDenied, home, linux, own, sub, tcpListener, tempDir, tried, unixListener, type Listener,
} from './helpers.ts';
import { bubblewrap, plantedBackends, sandboxSuite, type Grant, type SandboxBackend, type SuiteResult } from '../../../packages/supervisor/src/index.ts';

// BLOCKED, by throwing, off Linux, off Ubuntu LTS and Fedora, or without /usr/bin/bwrap; never a pass by skipping.
beforeAll(() => { linux(); });
afterEach(async () => { await closeListeners(); await cleanup(); }, 30_000);

/** The cases #236's seam suite holds, by name (tests/acceptance/236/README.md, The sandbox seam). */
const CASES = ['egress', 'write-outside', 'read-outside', 'hub-socket', 'inbox-socket', 'camera', 'microphone', 'audio-output', 'screen-capture'] as const;

async function sockets(): Promise<{ hub: Listener; inbox: Listener }> {
  const dir = tempDir();
  return { hub: await unixListener(join(dir, 'hub.sock')), inbox: await unixListener(join(dir, 'inbox.sock')) };
}
function failing(result: SuiteResult): string[] {
  for (const name of CASES) expect(result.cases.map((c) => c.name), `the suite has a case ${name}`).toContain(name);
  return result.cases.filter((c) => !c.ok && (CASES as readonly string[]).includes(c.name)).map((c) => c.name);
}
const shown = (result: SuiteResult): string => JSON.stringify(result.cases.filter((c) => !c.ok));
/** Runs argv through a backend's confine, as the supervisor would, and waits for it. */
async function through(backend: SandboxBackend, argv: string[], grant: Grant): Promise<void> {
  const cwd = sub(tempDir(), 'run');
  const launch = await backend.confine({ argv, cwd, env: { PATH: '/usr/bin:/bin', HOME: home() } }, grant);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.argv[0]!, launch.argv.slice(1), { cwd: launch.cwd, env: launch.env, stdio: 'ignore' });
    own(child.pid);
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 30_000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
}
/** The test's own probe, through `backend`, trying to connect to a TCP port on this machine no grant names. */
async function stranger(backend: SandboxBackend, port: number, file: string, out: string): Promise<ReturnType<typeof tried>> {
  const b = bins();
  await through(backend, [b.probe, '-o', file, 'tcp', String(port)], { read: [b.dir], write: [out] });
  return tried(file, 'tcp', String(port));
}

describe('AC4 #70.ef8d1e25 the bubblewrap backend passes the sandbox\'s suite on this Linux; the egress plant and a profile without its network filter fail its egress case', () => {
  it('AC4 the suite passes on bubblewrap, every case run, and nothing reached the hub\'s or the inbox socket', async () => {
    const where = linux().pretty;
    const { hub, inbox } = await sockets();
    expect(bubblewrap.platform, 'the backend under test is the Linux one').toBe('linux');
    expect(bubblewrap.name).toBe('bubblewrap');
    const result = await sandboxSuite(bubblewrap, { hubSocket: hub.path, inboxSocket: inbox.path });
    expect(failing(result), `cases that failed on bubblewrap on ${where}: ${shown(result)}`).toEqual([]);
    expect(result.passed, `the suite's verdict on bubblewrap on ${where}`).toBe(true);
    expect(result.backend).toBe(bubblewrap.name);
    expect(hub.connections, `on ${where}, a sandboxed process reached the hub's socket`).toBe(0);
    expect(inbox.connections, `on ${where}, a sandboxed process reached the inbox socket`).toBe(0);
  }, 120_000);

  it('AC4 (wrong program) the planted backend that allows egress is a bubblewrap one here, and still fails the suite, naming the egress case', async () => {
    const where = linux().pretty;
    const { hub, inbox } = await sockets();
    const fixtures = { hubSocket: hub.path, inboxSocket: inbox.path };
    const plant = plantedBackends(fixtures).egress;
    expect(plant.platform, 'on Linux the egress plant is the Linux backend one rule wider, not another platform\'s').toBe('linux');
    const result = await sandboxSuite(plant, fixtures);
    expect(result.passed, `the egress plant passed the suite on ${where}`).toBe(false);
    expect(failing(result), `what the egress plant failed on ${where}: ${shown(result)}`).toEqual(['egress']);
    expect(result.cases.find((c) => c.name === 'egress')!.detail, 'the failed egress case says what happened').not.toBe('');
    // It is the wrong program it says: through it, the test's own probe reaches a host no grant names, which the
    // real backend denies (a refused connection or an unreachable network is no denial: the filter must say no).
    const out = sub(tempDir(), 'out');
    const host = await tcpListener();
    expect((await stranger(plant, host.port, join(out, 'plant.json'), out)).ok, `on ${where}, through the egress plant, a host no grant names is reachable`).toBe(true);
    expect(host.connections, 'the plant\'s probe reached the listener').toBeGreaterThan(0);
    const before = host.connections;
    expectDenied(await stranger(bubblewrap, host.port, join(out, 'bubblewrap.json'), out), `on ${where}, through bubblewrap, a host no grant names`);
    expect(host.connections, 'bubblewrap\'s probe reached the listener').toBe(before);
  }, 120_000);

  it('AC4 (wrong program) a profile without its network filter fails the suite\'s egress case, naming it, and no other case', async () => {
    const where = linux().pretty;
    const { hub, inbox } = await sockets();
    const fixtures = { hubSocket: hub.path, inboxSocket: inbox.path };
    const profile = plantedBackends(fixtures)['no-network-filter'];
    expect(profile, 'plantedBackends(fixtures)[\'no-network-filter\']: bubblewrap\'s confinement with its network filter left out').toBeDefined();
    expect(profile.platform).toBe('linux');
    expect(profile.name, 'the profile is named apart from the real backend').not.toBe(bubblewrap.name);
    const result = await sandboxSuite(profile, fixtures);
    expect(result.passed, `the profile without its network filter passed the suite on ${where}`).toBe(false);
    expect(failing(result), `what the profile without its network filter failed on ${where}: ${shown(result)}`).toEqual(['egress']);
    expect(result.backend, 'the result names the profile it ran').toBe(profile.name);
    const egress = result.cases.find((c) => c.name === 'egress')!;
    expect(egress.ok).toBe(false);
    expect(egress.detail, 'the failed egress case says what happened').not.toBe('');
    // Without its network filter, every other part still holds: the suite's other eight cases passed above. And it is
    // what it says: through it, the test's own probe reaches a host no grant names.
    const out = sub(tempDir(), 'out');
    const host = await tcpListener();
    expect((await stranger(profile, host.port, join(out, 'profile.json'), out)).ok, `on ${where}, through the profile without its network filter, a host no grant names is reachable`).toBe(true);
    expect(host.connections, 'the profile\'s probe reached the listener').toBeGreaterThan(0);
  }, 120_000);
});
