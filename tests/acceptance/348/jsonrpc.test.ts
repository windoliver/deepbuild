// AC4: a JSON-RPC extension written in another language registers a check. The package is Python 3 (fixtures/
// pycheck/main), speaking JSON-RPC 2.0 as JSON lines on stdio (README, The surface under test: the JSON-RPC wire).
// It isn't inside DeepBuild's signed release, so it runs out of process in the platform sandbox. The check it
// registers is in use: the host lists it, and running it reaches the Python runner, whose answer names the
// Python version and the command the test passed, which nothing but that process could know.
import { randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { needPython3, openHost, openWorld, pkg, tempDir, tracked, type World } from './helpers.ts';

// One world and host, opened by the first test that needs them (not in a beforeAll, so at the base each test
// fails, never skips).
let world: World;
let host: ExtensionHost | undefined;
async function shared(): Promise<ExtensionHost> {
  if (!host) {
    world = await openWorld();
    host = await openHost(world);
    await host.ready();
  }
  return host;
}
afterAll(async () => { await host?.close(); });

describe('AC4 #348.1f4cd69b a JSON-RPC extension written in another language registers a check', () => {
  it('AC4 the Python package passes conformance, loads out of process in the sandbox, and its check kind ext.pycheck.lint is in use', async () => {
    const host = await shared();
    needPython3();
    const p = await host.install({ from: await pkg('pycheck'), builtBy: null });
    const c = await host.check(p);
    expect(c.passed, c.reasons.join('; ')).toBe(true);
    const load = await host.load(p);
    expect(load.status, JSON.stringify(load)).toBe('loaded');
    if (load.status !== 'loaded') return;
    expect(load.place).toBe('sandbox');
    expect((await tracked(world, load.run)).length, 'the supervisor started and tracked its process (host@1)').toBeGreaterThan(0);
    expect(await host.checks()).toContainEqual({ kind: 'ext.pycheck.lint', extension: 'test/pycheck' });
  }, 60_000);

  it('AC4 running ext.pycheck.lint through the host reaches the Python runner: its result names Python 3 and the command passed', async () => {
    const host = await shared();
    needPython3();
    if (!(await host.checks()).some((c) => c.kind === 'ext.pycheck.lint')) {
      const p = await host.install({ from: await pkg('pycheck'), builtBy: null });
      await host.check(p);
      await host.load(p);
    }
    const nonce = `lint-${randomBytes(6).toString('hex')}`;
    const r = await host.runCheck('ext.pycheck.lint', { kind: 'ext.pycheck.lint', runner: nonce, inputs: [], depth: 'unit', oracle: 'code', contract: null }, { checkout: tempDir('checkout'), deadline: 30_000 });
    expect(r.outcome).toBe('failed');
    expect(r.testsRun).toBe(3);
    expect(r.failures[0]?.message ?? '').toMatch(new RegExp(`^python 3\\.\\d+ saw ${nonce}$`));
  }, 60_000);
});
