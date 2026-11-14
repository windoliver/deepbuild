// Runtime selection must exercise the same installed environment that passed its kit, and unload must stop it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openRecord, openTrust } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { openExtensionHost, packageDigest } from '@deepbuild/extension-host';
import { cleanup, closing, pkgOf, temp } from './package.js';

afterAll(cleanup);
it('starts and stops its kitted provider, and disabling it cleans up the active handle', async () => {
  const dir = temp();
  const seen = join(dir, 'stops.jsonl');
  writeFileSync(seen, '');
  const conformance = fileURLToPath(new URL('../../conformance/dist/index.js', import.meta.url));
  const code = `import { appendFileSync } from 'node:fs';
// The kit loads at the first up, in the hub: the sandbox that checks the package can't read it.
let reference;
const fill = () => reference ??= import(${JSON.stringify(conformance)}).then(({ cleanFills, slotKits }) =>
  cleanFills(slotKits().find(k => k.slot === 'environment@1'))[0]);
export default function(deep) {
  deep.registerEnvironment('local', {
    slot: 'environment@1', revision: 1,
    up: async (spec, lease, checkout) => (await fill()).up(spec, lease, checkout),
    down: async handle => { appendFileSync(${JSON.stringify(seen)}, JSON.stringify(handle) + '\\n'); return (await fill()).down(handle); }
  });
}`;
  const folder = pkgOf('test/runtime-env', code, { environments: ['local'] });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 60000 } } } });
  closing.push(record, supervisor);
  const home = join(dir, 'host'); mkdirSync(home);
  const host = await openExtensionHost({ record, asks, supervisor, trust: await openTrust({ record, now: Date.now }), home,
    release: [{ id: 'test/runtime-env', version: '1.0.0', digest: packageDigest(folder) }], now: Date.now });
  closing.push(host);
  await host.ready();
  const pkg = await host.install({ from: folder, builtBy: null });
  expect(pkg.kits).toContainEqual({ slot: 'environment@1', fill: 'local', verdict: 'PASS' });
  expect((await host.check(pkg)).passed).toBe(true);
  expect((await host.load(pkg)).status).toBe('loaded');
  const checkout = temp();
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const address = reserve.address(); if (!address || typeof address === 'string') throw Error('no leased port');
  const port = address.port; await new Promise<void>((done, fail) => reserve.close(error => error ? fail(error) : done()));
  const runtime = await host.environment('local');
  const spec = { health: '/health', token: 'runtime-proof', warmup: 0 };
  const lease = { port, token: `run-runtime-${port}` };
  const running = await runtime.up(spec, lease, checkout, 10_000);
  try {
    expect(runtime.extension).toBe('test/runtime-env');
    expect(running.handle.port).toBe(port);
    const result = await fetch(`http://127.0.0.1:${port}/health`);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ token: spec.token });
    const before = readFileSync(seen, 'utf8').split('\n').filter(Boolean).length;
    await host.disable('test/runtime-env');
    const stopped = readFileSync(seen, 'utf8').split('\n').filter(Boolean).slice(before).map(line => JSON.parse(line));
    expect(stopped).toEqual([running.handle]);
    await expect(host.environment('local')).rejects.toThrow(/no loaded.*environment/);
    await expect(runtime.up(spec, lease, checkout, 10_000)).rejects.toThrow(/no loaded.*environment/);
    await running.down();
    expect(readFileSync(seen, 'utf8').split('\n').filter(Boolean).length).toBe(before + 1);
  } finally {
    // The test owns the process returned by its own reference fill; cleanup uses that exact handle only.
    await running.down().catch(() => undefined);
    try { process.kill(running.handle.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}, 120_000);
