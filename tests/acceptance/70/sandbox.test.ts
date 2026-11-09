// AC4 #70.ef8d1e25: the bubblewrap backend passes the platform sandbox's suite (#236) on both distributions, and the
// planted backend that allows egress still fails it there; a profile without its network filter fails the egress
// case, naming it.
//
// This reuses #236's suite and #70's merged backend through the supervisor's public entry; it rewrites neither. It
// runs once per distribution (README: both distributions). What differs between them is the kernel, AppArmor or
// SELinux, and how each ships bubblewrap, so the suite's reading on one says nothing of the other.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HELPER, bubblewrap, plantedBackends, sandboxSuite, type SandboxBackend, type SuiteFixtures } from '../../../packages/supervisor/src/index.ts';
import { AC4, distribution, requireBubblewrap } from './helpers.ts';

const CASES = ['egress', 'write-outside', 'read-outside', 'hub-socket', 'inbox-socket', 'camera', 'microphone', 'audio-output', 'screen-capture'];

const dirs: string[] = [];
const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function listener(path: string): Promise<{ path: string; connections: () => number }> {
  let n = 0;
  return new Promise((resolve, reject) => {
    const server = net.createServer((sock) => { n++; sock.on('error', () => undefined).resume(); });
    servers.push(server);
    server.once('error', reject);
    server.listen(path, () => resolve({ path, connections: () => n }));
  });
}
/** The suite's two fixtures, each counting what reached it. */
async function fixtures(): Promise<SuiteFixtures & { reached(): number }> {
  const dir = realpathSync(mkdtempSync('/tmp/dh70-'));
  dirs.push(dir);
  const hub = await listener(join(dir, 'hub.sock'));
  const inbox = await listener(join(dir, 'inbox.sock'));
  return { hubSocket: hub.path, inboxSocket: inbox.path, reached: () => hub.connections() + inbox.connections() };
}

/**
 * bubblewrap's own launch, with the helper that holds the seccomp filter taken out: on Linux the network filter lives
 * only there, since bwrap here shares the machine's network namespace. The namespaces stay, and nothing filters a
 * socket. Files lose their Landlock too, since the same process puts it on; the case under test is egress.
 */
const noNetworkFilter: SandboxBackend = {
  name: 'planted-no-network-filter',
  platform: 'linux',
  async confine(launch, grant, run) {
    const real = await bubblewrap.confine(launch, grant, run);
    const at = real.argv.lastIndexOf('--');
    if (real.argv[at + 1] !== HELPER || real.argv[at + 2] !== 'confine') throw Error(`BLOCKED: bubblewrap's launch no longer ends in the helper's confine, so the profile without its filter can't be made: ${real.argv.slice(-4).join(' ')}`);
    return { ...real, argv: [...real.argv.slice(0, at + 1), ...launch.argv] };
  },
};

describe(`${AC4} The bubblewrap backend passes the platform sandbox's suite on both distributions, and planted backends fail it there`, () => {
  it(`${AC4} on this distribution, bubblewrap passes every case of the suite and nothing reaches the hub's or the inbox socket`, async () => {
    const on = distribution();
    requireBubblewrap();
    const fx = await fixtures();
    const result = await sandboxSuite(bubblewrap, fx);
    expect(result.cases.map((c) => c.name), `${AC4} on ${on} every case of the suite runs`).toEqual(CASES);
    expect(result.cases.filter((c) => !c.ok), `${AC4} on ${on} the cases that failed on bubblewrap`).toEqual([]);
    expect(result.passed).toBe(true);
    expect(fx.reached(), `${AC4} on ${on} a sandboxed process reached the hub's or the inbox socket`).toBe(0);
  }, 120_000);

  it(`${AC4} (wrong program) on this distribution, the planted backend that allows egress fails the suite, naming the egress case and no other`, async () => {
    const on = distribution();
    requireBubblewrap();
    const fx = await fixtures();
    const result = await sandboxSuite(plantedBackends(fx).egress, fx);
    expect(result.passed, `${AC4} on ${on} the planted egress backend must fail the suite`).toBe(false);
    expect(result.cases.filter((c) => !c.ok).map((c) => c.name), `${AC4} on ${on} it fails exactly the egress case`).toEqual(['egress']);
  }, 120_000);

  it(`${AC4} (wrong program) on this distribution, a profile without its network filter fails the suite, naming the egress case, with the connection it let through`, async () => {
    const on = distribution();
    requireBubblewrap();
    const fx = await fixtures();
    const result = await sandboxSuite(noNetworkFilter, fx);
    expect(result.passed, `${AC4} on ${on} a profile without its network filter must fail the suite`).toBe(false);
    const egress = result.cases.find((c) => c.name === 'egress');
    expect(egress?.ok, `${AC4} on ${on} the suite must name the egress case: ${JSON.stringify(result.cases)}`).toBe(false);
    expect(egress?.detail, `${AC4} on ${on} the egress case fails because the connection it never granted went through, not because nothing ran`).toMatch(/\(not granted\): allowed/);
  }, 120_000);
});
