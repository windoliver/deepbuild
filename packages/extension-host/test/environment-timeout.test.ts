// A timed-out start unpublishes its load, but its eventual handle must still be cleaned by that load.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
it('unloads a timed-out provider and cleans its late handle after the caller already received the timeout', async () => {
  const dir = temp(), started = join(dir, 'started.json'), release = join(dir, 'release'), stopped = join(dir, 'stopped.json');
  const conformance = fileURLToPath(new URL('../../conformance/dist/index.js', import.meta.url));
  const folder = pkgOf('test/timed-environment', `
    import { existsSync, writeFileSync } from 'node:fs';
    let reference;
    const fill = () => reference ??= import(${JSON.stringify(conformance)}).then(({ cleanFills, slotKits }) =>
      cleanFills(slotKits().find(k => k.slot === 'environment@1'))[0]);
    export default function(deep) {
      deep.registerEnvironment('timed', {
        slot: 'environment@1', revision: 1,
        async up(spec, lease, checkout) {
          const handle = await (await fill()).up(spec, lease, checkout);
          if (spec.token === 'timed-runtime') {
            writeFileSync(${JSON.stringify(started)}, JSON.stringify(handle));
            while (!existsSync(${JSON.stringify(release)})) await new Promise(done => setTimeout(done, 10));
          }
          return handle;
        },
        async down(handle) { await (await fill()).down(handle); writeFileSync(${JSON.stringify(stopped)}, JSON.stringify(handle)); }
      });
    }`, { environments: ['timed'] });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 60000 } } } });
  closing.push(record, supervisor);
  const home = join(dir, 'host'); mkdirSync(home);
  const host = await openExtensionHost({ record, asks, supervisor, trust: await openTrust({ record, now: Date.now }), home,
    release: [{ id: 'test/timed-environment', version: '1.0.0', digest: packageDigest(folder) }], now: Date.now });
  closing.push(host);
  await host.ready();
  const pkg = await host.install({ from: folder, builtBy: null });
  expect((await host.check(pkg)).passed).toBe(true);
  expect((await host.load(pkg)).status).toBe('loaded');
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const address = reserve.address(); if (!address || typeof address === 'string') throw Error('no port');
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const runtime = await host.environment('timed');
  const until = async (path: string) => {
    const end = Date.now() + 10_000;
    while (!existsSync(path) && Date.now() < end) await new Promise(done => setTimeout(done, 10));
    expect(existsSync(path), path.endsWith('started.json') ? 'the environment started' : 'the environment stopped').toBe(true);
  };
  const pending = runtime.up({ health: '/health', token: 'timed-runtime', warmup: 0 }, { port: address.port, token: `run-timed-${address.port}` }, temp(), 1000)
    .then(value => ({ value }), error => ({ error }));
  try {
    await until(started);
    const result = await pending;
    expect(result).toHaveProperty('error');
    await expect(host.environment('timed')).rejects.toThrow(/no loaded.*environment/);
    writeFileSync(release, 'go');
    await until(stopped);
    expect(JSON.parse(readFileSync(stopped, 'utf8'))).toEqual(JSON.parse(readFileSync(started, 'utf8')));
    await expect(fetch(`http://127.0.0.1:${address.port}/health`)).rejects.toThrow();
  } finally {
    writeFileSync(release, 'go'); await pending;
    if (existsSync(started)) { const handle = JSON.parse(readFileSync(started, 'utf8')); try { process.kill(handle.pid, 'SIGTERM'); } catch {} }
  }
}, 120_000);
