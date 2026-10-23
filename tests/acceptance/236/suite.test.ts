// #236 AC5 and AC9: the sandbox seam's own suite. It passes on Seatbelt and fails on each planted backend,
// naming that backend's case and no other. Each plant is also checked to be the wrong program it says it is,
// by a probe of the test's own run through its `confine`, so a suite that recognized plants by name, or a plant
// that misbehaves only for the suite's own fixtures, can't pass these tests (README, AC5 and AC9).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bins, cleanup, closeListeners, DEVICES, devicesIn, expectDenied, home, own, sub, tcpListener, tempDir, tried, unixListener, type Listener,
} from './helpers.ts';
import { plantedBackends, sandboxSuite, seatbelt, type Grant, type SandboxBackend, type SuiteResult } from '../../../packages/supervisor/src/index.ts';

afterEach(async () => { await closeListeners(); await cleanup(); }, 30_000);

/** The cases the seam's suite must hold, by name (README, The sandbox seam). */
const CASES = ['egress', 'write-outside', 'read-outside', 'hub-socket', 'inbox-socket', 'camera', 'microphone', 'audio-output', 'screen-capture'] as const;

async function sockets(): Promise<{ hub: Listener; inbox: Listener }> {
  const dir = tempDir();
  return { hub: await unixListener(join(dir, 'hub.sock')), inbox: await unixListener(join(dir, 'inbox.sock')) };
}
function failing(result: SuiteResult): string[] {
  for (const name of CASES) expect(result.cases.map((c) => c.name), `the suite has a case ${name}`).toContain(name);
  return result.cases.filter((c) => !c.ok && (CASES as readonly string[]).includes(c.name)).map((c) => c.name);
}
/** Runs argv through a backend's confine, as the supervisor would, and waits for it. */
async function through(backend: SandboxBackend, argv: string[], grant: Grant): Promise<void> {
  const cwd = sub(tempDir(), 'run');
  const launch = await backend.confine({ argv, cwd, env: { PATH: '/usr/bin:/bin', HOME: home() } }, grant);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.argv[0]!, launch.argv.slice(1), { cwd: launch.cwd, env: launch.env, stdio: 'ignore' });
    own(child.pid);
    child.on('error', reject);
    child.on('exit', () => resolve());
  });
}

describe('AC5 #236.6f5af6b7 the seam\'s suite passes on Seatbelt and fails on a planted backend that allows egress', () => {
  it('AC5 the suite passes on Seatbelt, every case run, and nothing reached the hub\'s or the inbox socket', async () => {
    const { hub, inbox } = await sockets();
    const result = await sandboxSuite(seatbelt, { hubSocket: hub.path, inboxSocket: inbox.path });
    expect(failing(result), `cases that failed on Seatbelt: ${JSON.stringify(result.cases.filter((c) => !c.ok))}`).toEqual([]);
    expect(result.passed).toBe(true);
    expect(seatbelt.platform).toBe('darwin');
    expect(hub.connections, 'a sandboxed process reached the hub\'s socket').toBe(0);
    expect(inbox.connections, 'a sandboxed process reached the inbox socket').toBe(0);
  }, 120_000);

  it('AC5 (wrong program) the planted backend that lets a sandboxed process connect to a host its grant doesn\'t name fails the suite, naming the egress case', async () => {
    const { hub, inbox } = await sockets();
    const fixtures = { hubSocket: hub.path, inboxSocket: inbox.path };
    const plant = plantedBackends(fixtures).egress;
    const result = await sandboxSuite(plant, fixtures);
    expect(result.passed).toBe(false);
    expect(failing(result)).toEqual(['egress']);
    // It is the wrong program it says: through it, the test's own probe reaches a host no grant names.
    const b = bins();
    const out = sub(tempDir(), 'out');
    const host = await tcpListener();
    await through(plant, [b.probe, '-o', join(out, 'plant.json'), 'tcp', String(host.port)], { read: [b.dir], write: [out] });
    expect(tried(join(out, 'plant.json'), 'tcp', String(host.port)).ok, 'through the egress plant, a host no grant names is reachable').toBe(true);
    await through(seatbelt, [b.probe, '-o', join(out, 'seatbelt.json'), 'tcp', String(host.port)], { read: [b.dir], write: [out] });
    expectDenied(tried(join(out, 'seatbelt.json'), 'tcp', String(host.port)), 'through Seatbelt, a host no grant names');
  }, 120_000);
});

describe('AC9 #236.4e304926 the suite fails three more planted backends, each naming its case', () => {
  it.each(['write-outside', 'hub-socket', 'camera'] as const)('AC9 (wrong program) the planted backend %s fails the suite, naming its case and no other', async (name) => {
    const { hub, inbox } = await sockets();
    const fixtures = { hubSocket: hub.path, inboxSocket: inbox.path };
    const plant = plantedBackends(fixtures)[name];
    const result = await sandboxSuite(plant, fixtures);
    expect(result.passed).toBe(false);
    expect(failing(result)).toEqual([name]);

    // The plant does what it is named for, to a probe of the test's own, where Seatbelt doesn't.
    const b = bins();
    const out = sub(tempDir(), 'out');
    const grant = { read: [b.dir], write: [out] };
    if (name === 'write-outside') {
      const outside = join(sub(tempDir(), 'elsewhere'), 'w.txt');
      await through(plant, [b.probe, '-o', join(out, 'plant.json'), 'write', outside], grant);
      expect(tried(join(out, 'plant.json'), 'write', outside).ok, 'through the plant, a write outside the declared paths').toBe(true);
      await through(seatbelt, [b.probe, '-o', join(out, 'seatbelt.json'), 'write', outside], grant);
      expectDenied(tried(join(out, 'seatbelt.json'), 'write', outside), 'through Seatbelt, a write outside the declared paths');
    } else if (name === 'hub-socket') {
      const before = hub.connections;
      await through(plant, [b.probe, '-o', join(out, 'plant.json'), 'unix', hub.path], grant);
      expect(tried(join(out, 'plant.json'), 'unix', hub.path).ok, 'through the plant, the hub\'s socket').toBe(true);
      expect(hub.connections).toBeGreaterThan(before);
      await through(seatbelt, [b.probe, '-o', join(out, 'seatbelt.json'), 'unix', hub.path], grant);
      expectDenied(tried(join(out, 'seatbelt.json'), 'unix', hub.path), 'through Seatbelt, the hub\'s socket');
    } else {
      await through(plant, [b.probe, '-o', join(out, 'probe.json'), 'spawn', b.devices, join(out, 'plant.json')], grant);
      const seen = devicesIn(join(out, 'plant.json'));
      expect(seen.map((d) => d.device)).toEqual([...DEVICES]);
      for (const d of seen) expect(d.sandbox, `through the camera plant, a child's ${d.device}`).toBe(d.device === 'camera' ? 'allow' : 'deny');
      await through(seatbelt, [b.probe, '-o', join(out, 'probe2.json'), 'spawn', b.devices, join(out, 'seatbelt.json')], grant);
      for (const d of devicesIn(join(out, 'seatbelt.json'))) expect(d.sandbox, `through Seatbelt, a child's ${d.device}`).toBe('deny');
    }
  }, 120_000);
});
