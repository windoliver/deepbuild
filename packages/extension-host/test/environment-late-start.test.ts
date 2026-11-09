// An environment finishing its start while disabled belongs to the old load: stop it before disable completes.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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
it('disabling drains a late start and downs its exact handle once before rejecting the stale result', async () => {
  const dir = temp(), started = join(dir, 'started.json'), release = join(dir, 'release'), stops = join(dir, 'stops.jsonl');
  writeFileSync(stops, '');
  const conformance = fileURLToPath(new URL('../../conformance/dist/index.js', import.meta.url));
  const folder = pkgOf('test/late-environment', `
    import { existsSync, writeFileSync, appendFileSync } from 'node:fs';
    // Registration also runs in the sandbox: load the kit only when the trusted host invokes up/down.
    let reference;
    const fill = () => reference ??= import(${JSON.stringify(conformance)}).then(({ cleanFills, slotKits }) =>
      cleanFills(slotKits().find(k => k.slot === 'environment@1'))[0]);
    export default function(deep) {
      deep.registerEnvironment('late', {
        slot: 'environment@1', revision: 1,
        async up(spec, lease, checkout) {
          const handle = await (await fill()).up(spec, lease, checkout);
          if (spec.token === 'late-runtime') {
            writeFileSync(${JSON.stringify(started)}, JSON.stringify(handle));
            while (!existsSync(${JSON.stringify(release)})) await new Promise(done => setTimeout(done, 10));
          }
          return handle;
        },
        async down(handle) { await (await fill()).down(handle); appendFileSync(${JSON.stringify(stops)}, JSON.stringify(handle) + '\\n'); }
      });
    }`, { environments: ['late'] });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 60000 } } } });
  closing.push(record, supervisor);
  const home = join(dir, 'host'); mkdirSync(home);
  const host = await openExtensionHost({ record, asks, supervisor, trust: await openTrust({ record, now: Date.now }), home,
    release: [{ id: 'test/late-environment', version: '1.0.0', digest: packageDigest(folder) }], now: Date.now });
  closing.push(host);
  await host.ready();
  const pkg = await host.install({ from: folder, builtBy: null });
  expect(pkg.kits).toContainEqual({ slot: 'environment@1', fill: 'late', verdict: 'PASS' });
  expect((await host.check(pkg)).passed).toBe(true);
  expect((await host.load(pkg)).status).toBe('loaded');
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const address = reserve.address(); if (!address || typeof address === 'string') throw Error('no port');
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const runtime = await host.environment('late');
  const pending = runtime.up({ health: '/health', token: 'late-runtime', warmup: 0 }, { port: address.port, token: `run-late-${address.port}` }, temp(), 10_000)
    .then(value => ({ value }), error => ({ error }));
  try {
    const until = Date.now() + 10_000;
    while (!existsSync(started) && Date.now() < until) await new Promise(done => setTimeout(done, 10));
    expect(existsSync(started), 'the real environment started').toBe(true);
    const handle = JSON.parse(readFileSync(started, 'utf8'));
    const before = readFileSync(stops, 'utf8').split('\n').filter(Boolean).length;
    const disabled = host.disable('test/late-environment');
    writeFileSync(release, 'go');
    await disabled;
    const result = await pending;
    expect(result).toHaveProperty('error');
    const ended = readFileSync(stops, 'utf8').split('\n').filter(Boolean).slice(before).map(line => JSON.parse(line));
    expect(ended).toEqual([handle]);
    await expect(fetch(`http://127.0.0.1:${address.port}/health`)).rejects.toThrow();
  } finally {
    writeFileSync(release, 'go'); await pending;
    // Only the PID started by this test's reference environment is eligible for emergency cleanup.
    if (existsSync(started)) { const handle = JSON.parse(readFileSync(started, 'utf8')); try { process.kill(handle.pid, 'SIGTERM'); } catch {} }
  }
}, 120_000);
