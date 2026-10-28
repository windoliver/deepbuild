// #44's lease kinds past what its acceptance tests reach: the table keeps a kind for the hub's life and has no
// undeclare, so a package loaded again keeps its own kinds, and a manifest with one bad kind declares none of them.
// Each runs a real package through a real host, record, supervisor and lease table.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openLeases, type LeaseTable } from '@deepbuild/leases';
import { openRecord } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { openExtensionHost, openTrust, packageDigest, type ExtensionHost } from '../src/index.js';

const dirs: string[] = [];
const closing: { close(): Promise<void> }[] = [];
afterAll(async () => {
  for (const c of closing.reverse()) await c.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const temp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'deep-ext-lease-')));
  dirs.push(d);
  return d;
};

const RIG = { name: 'device.rig', match: 'exact', cap: 10, cooldown: 0, cost: 0 };
const CODE = "export default function (deep: any): void {\n  deep.registerCheck('ext.x.run', () => ({ outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [], mask: null }));\n}\n";

function pkgOf(version: string, leases: unknown[]): string {
  const folder = temp();
  writeFileSync(join(folder, 'index.ts'), CODE);
  const manifest = { id: 'test/x', version, digest: '', checks: ['ext.x.run'], leases };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return folder;
}
async function world(): Promise<{ h: ExtensionHost; table: LeaseTable }> {
  const dir = temp();
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  closing.push(record, supervisor);
  const table = await openLeases({ record, now: Date.now });
  mkdirSync(join(dir, 'home'));
  const h = await openExtensionHost({ record, supervisor, trust: await openTrust({ record, now: Date.now }), home: join(dir, 'home'), release: [], now: Date.now, leases: table });
  closing.push(h);
  await h.ready();
  return { h, table };
}
async function load(h: ExtensionHost, from: string): Promise<string | null> {
  const p = await h.install({ from, builtBy: null });
  expect((await h.check(p)).passed).toBe(true);
  const l = await h.load(p);
  return l.status === 'refused' ? l.reason : null;
}

describe('#44 a manifest\'s lease kinds in the table', () => {
  it('a package installed and loaded again keeps the kinds it declared, on the same terms; on other terms it is refused', async () => {
    const { h, table } = await world();
    expect(await load(h, pkgOf('1.0.0', [RIG]))).toBeNull();
    expect(await load(h, pkgOf('1.0.1', [RIG]))).toBeNull();
    expect((await table.kinds()).filter((k) => k.name === 'device.rig')).toEqual([{ ...RIG, plugin: 'test/x' }]);
    expect(await load(h, pkgOf('1.0.2', [{ ...RIG, cap: 20 }]))).toMatch(/device\.rig differs/);
    expect((await table.kinds()).filter((k) => k.name === 'device.rig')).toEqual([{ ...RIG, plugin: 'test/x' }]);
  }, 60_000);

  it('a manifest with one kind outside lease.kind@1 is refused naming it, and none of its kinds is declared', async () => {
    const { h, table } = await world();
    expect(await load(h, pkgOf('1.0.0', [RIG, { ...RIG, name: 'device.odd', match: 'regex' }]))).toMatch(/device\.odd/);
    expect((await table.kinds()).map((k) => k.name)).not.toContain('device.rig');
  }, 60_000);

  it('a manifest naming one kind twice is refused naming it, and the kind is not declared', async () => {
    const { h, table } = await world();
    expect(await load(h, pkgOf('1.0.0', [RIG, { ...RIG, cap: 20 }]))).toMatch(/device\.rig twice/);
    expect((await table.kinds()).map((k) => k.name)).not.toContain('device.rig');
  }, 60_000);
});
