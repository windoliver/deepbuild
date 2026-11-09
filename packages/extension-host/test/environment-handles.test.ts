// A live environment belongs to its load, not to a caller that might forget to close it.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
it('downs active handles once on disable, and caller cleanup remains idempotent after removal', async () => {
  const dir = temp(), stops = join(dir, 'stops.jsonl');
  writeFileSync(stops, '');
  const conformance = fileURLToPath(new URL('../../conformance/dist/index.js', import.meta.url));
  const folder = pkgOf('test/owned-environment', `
    import { appendFileSync } from 'node:fs';
    let reference;
    const fill = () => reference ??= import(${JSON.stringify(conformance)}).then(({ cleanFills, slotKits }) =>
      cleanFills(slotKits().find(k => k.slot === 'environment@1'))[0]);
    export default function(deep) {
      deep.registerEnvironment('owned', {
        slot: 'environment@1', revision: 1,
        async up(spec, lease, checkout) { return (await fill()).up(spec, lease, checkout); },
        async down(handle) { await (await fill()).down(handle); appendFileSync(${JSON.stringify(stops)}, JSON.stringify(handle) + '\\n'); }
      });
    }`, { environments: ['owned'] });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 60000 } } } });
  closing.push(record, supervisor);
  const home = join(dir, 'host'); mkdirSync(home);
  const host = await openExtensionHost({ record, asks, supervisor, trust: await openTrust({ record, now: Date.now }), home,
    release: [{ id: 'test/owned-environment', version: '1.0.0', digest: packageDigest(folder) }], now: Date.now });
  closing.push(host);
  await host.ready();
  const pkg = await host.install({ from: folder, builtBy: null });
  expect(pkg.kits).toContainEqual({ slot: 'environment@1', fill: 'owned', verdict: 'PASS' });
  expect((await host.check(pkg)).passed).toBe(true);
  expect((await host.load(pkg)).status).toBe('loaded');
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const address = reserve.address(); if (!address || typeof address === 'string') throw Error('no port');
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const runtime = await host.environment('owned');
  const spec = { health: '/health', token: 'owned-runtime', warmup: 0 };
  const lease = { port: address.port, token: `run-owned-${address.port}` };
  const running = await runtime.up(spec, lease, temp(), 10_000);
  try {
    expect((await fetch(`http://127.0.0.1:${address.port}/health`)).status).toBe(200);
    const before = readFileSync(stops, 'utf8').split('\n').filter(Boolean).length;
    await host.disable('test/owned-environment');
    const ended = () => readFileSync(stops, 'utf8').split('\n').filter(Boolean).slice(before).map(line => JSON.parse(line));
    expect(ended()).toEqual([running.handle]);
    await Promise.all([running.down(), running.down()]);
    expect(ended()).toEqual([running.handle]);
    await expect(fetch(`http://127.0.0.1:${address.port}/health`)).rejects.toThrow();
    await expect(runtime.up(spec, lease, temp(), 10_000)).rejects.toThrow(/no loaded.*environment/);
  } finally {
    await running.down().catch(() => undefined);
    try { process.kill(running.handle.pid, 'SIGTERM'); } catch { /* test-owned server already gone */ }
  }
}, 120_000);
