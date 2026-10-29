// #44's lease kinds past what its acceptance tests reach: the table keeps a kind for the hub's life and has no
// undeclare, so a package loaded again keeps its own kinds, and a manifest with one bad kind declares none of them.
// Each runs a real package through a real host, record, supervisor and lease table.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openLeases, type LeaseTable } from '@deepbuild/leases';
import { openRecord, type RecordStore } from '@deepbuild/record';
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

/** Leases rig-1 of device.rig for itself as it loads; at its conformance run, where nothing reaches the record, the lease is refused. */
const LEASES = "export default async function (deep: any): Promise<void> {\n  deep.registerCheck('ext.x.run', () => null);\n  await deep.lease({ kind: 'device.rig', key: 'rig-1' }, 'exclusive').catch(() => undefined);\n}\n";

function pkgOf(version: string, leases: unknown[], code = CODE): string {
  const folder = temp();
  writeFileSync(join(folder, 'index.ts'), code);
  const manifest = { id: 'test/x', version, digest: '', checks: ['ext.x.run'], leases };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return folder;
}
/**
 * `left` names runs whose cleanup reads unfinished: a process that outlives SIGKILL can't be made here, so the real
 * cleanup runs and stops everything, and its result alone is read as a process left running.
 */
async function world(left = new Set<string>()): Promise<{ h: ExtensionHost; table: LeaseTable; record: RecordStore }> {
  const dir = temp();
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  closing.push(record, supervisor);
  const cleanup = supervisor.cleanup.bind(supervisor);
  supervisor.cleanup = async (run) => {
    const done = await cleanup(run);
    return left.has(run) ? { ...done, outcome: 'unfinished', left: ['pid:0'] } : done;
  };
  const table = await openLeases({ record, now: Date.now });
  mkdirSync(join(dir, 'home'));
  const h = await openExtensionHost({ record, supervisor, trust: await openTrust({ record, now: Date.now }), home: join(dir, 'home'), release: [], now: Date.now, leases: table });
  closing.push(h);
  await h.ready();
  return { h, table, record };
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

  it('a package\'s leases end when it unloads, once its process is proven gone, citing the events that prove it; the key is free again', async () => {
    const { h, table, record } = await world();
    expect(await load(h, pkgOf('1.0.0', [RIG], LEASES))).toBeNull();
    expect((await table.leases()).map((v) => v.lease.holder)).toEqual(['ext:test/x']);
    const run = (await h.loaded())[0]!.run;
    await h.disable('test/x');
    expect(await table.leases(), 'nothing is held once it is unloaded').toEqual([]);
    const events = await record.read({ after: 0, limit: 10_000 });
    const released = events.filter((e) => e.kind === 'lease.released');
    expect(released.map((e) => (e.data as { holder: string }).holder)).toEqual(['ext:test/x']);
    const ended = events.filter((e) => e.kind === 'process.ended' && (e.data as { run?: string }).run === run).map((e) => e.id);
    expect(ended.length, 'its process was proven gone').toBeGreaterThan(0);
    expect((released[0]!.data as { proof: string[] }).proof, 'the release cites the process.ended events of its run').toEqual(ended);
    expect((await table.lease({ holder: 'session:s1' }, { host: 'local', kind: 'device.rig', key: 'rig-1' }, 'exclusive')).status).toBe('granted');
  }, 60_000);

  it("a run that left a process running keeps its leases, the package's next run is refused them, and its clean unload ends only its own", async () => {
    const left = new Set<string>();
    const { h, table } = await world(left);
    expect(await load(h, pkgOf('1.0.0', [RIG], LEASES))).toBeNull();
    const [first] = (await table.leases()).map((v) => v.lease.id);
    left.add((await h.loaded())[0]!.run!);
    await h.disable('test/x');
    expect((await table.leases()).map((v) => v.lease.id), 'a run not proven gone keeps its lease').toEqual([first]);
    const both = LEASES.replace("await deep.lease", "await deep.lease({ kind: 'device.rig', key: 'rig-2' }, 'exclusive').catch(() => undefined);\n  await deep.lease");
    expect(await load(h, pkgOf('1.0.1', [RIG], both))).toBeNull();
    expect((await table.leases()).map((v) => v.lease.resource.key), "the next run is refused rig-1, which the first run's process may still use").toEqual(['rig-1', 'rig-2']);
    await h.disable('test/x');
    expect((await table.leases()).map((v) => v.lease.id), "the clean run's unload ends its own lease, not the first run's").toEqual([first]);
  }, 60_000);

  it('a lease granted after its package began to unload ends too', async () => {
    const { h, table } = await world();
    const lease = table.lease.bind(table);
    let asked!: () => void;
    let open!: () => void;
    const [isAsked, gate] = [new Promise<void>((r) => { asked = r; }), new Promise<void>((r) => { open = r; })];
    let granted: Promise<unknown> = Promise.resolve();
    table.lease = (...args) => {
      asked();
      const result = gate.then(() => lease(...args));
      granted = result;
      return result;
    };
    expect(await load(h, pkgOf('1.0.0', [RIG], LEASES.replace('await deep.lease', 'void deep.lease')))).toBeNull();
    await isAsked;
    await h.disable('test/x');
    open();
    await granted;
    for (const until = Date.now() + 5000; Date.now() < until && (await table.leases()).length; await new Promise((r) => setTimeout(r, 50)));
    expect(await table.leases(), 'nothing is held once it is unloaded').toEqual([]);
  }, 60_000);

  it('a manifest naming one kind twice is refused naming it, and the kind is not declared', async () => {
    const { h, table } = await world();
    expect(await load(h, pkgOf('1.0.0', [RIG, { ...RIG, cap: 20 }]))).toMatch(/device\.rig twice/);
    expect((await table.kinds()).map((k) => k.name)).not.toContain('device.rig');
  }, 60_000);
});
