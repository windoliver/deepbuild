// #348's "Added Oct 9", which no checkbox criterion names: every extension run gets a timeout, and safe mode loads
// no extension at all; and the rule behind AC5 the acceptance tests reach only with changed bytes: what an agent
// built runs sandboxed even when its bytes are the release's. Each runs a real package through a real host, record
// and supervisor.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CheckSpec } from '@deepbuild/conformance';
import { openAsks } from '@deepbuild/asks';
import { openRecord, type RecordStore } from '@deepbuild/record';
import { openSupervisor, type Supervisor } from '@deepbuild/supervisor';
import { openExtensionHost, openTrust, packageDigest, type ExtensionHost, type ReleaseEntry } from '../src/index.js';

const dirs: string[] = [];
const closing: { close(): Promise<void> }[] = [];
afterAll(async () => {
  for (const c of closing.reverse()) await c.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const temp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'deep-ext-test-')));
  dirs.push(d);
  return d;
};

/** A package whose check kind ext.stuck.run answers `body`'s value. */
function stuck(body: string): string {
  const folder = temp();
  writeFileSync(join(folder, 'index.ts'), `export default function (deep: any): void {\n  deep.registerCheck('ext.stuck.run', () => ${body});\n}\n`);
  const manifest = { id: 'test/stuck', version: '1.0.0', digest: '', checks: ['ext.stuck.run'] };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return folder;
}
async function host(options: { safe?: boolean; release?: ReleaseEntry[] } = {}): Promise<ExtensionHost> {
  const dir = temp();
  const record: RecordStore = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor: Supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  closing.push(record, supervisor);
  mkdirSync(join(dir, 'home'));
  const h = await openExtensionHost({ record, supervisor, trust: await openTrust({ record, now: Date.now }), home: join(dir, 'home'), now: Date.now, ...options, release: options.release ?? [] });
  closing.push(h);
  await h.ready();
  return h;
}
const SPEC: CheckSpec = { kind: 'ext.stuck.run', runner: 'run', inputs: [], depth: 'unit', oracle: 'code', contract: null };

const PASSES = "({ outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [], mask: null })";

describe('#348 Added Oct 9', () => {
  it('a check run that never ends is stopped at its deadline: overran, naming the package and the deadline', async () => {
    const h = await host();
    const p = await h.install({ from: stuck('new Promise(() => undefined)'), builtBy: null });
    expect((await h.check(p)).passed).toBe(true);
    expect((await h.load(p)).status).toBe('loaded');
    const t0 = Date.now();
    const r = await h.runCheck('ext.stuck.run', SPEC, { checkout: temp(), deadline: 500 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r.outcome).toBe('overran');
    expect(r.failures[0]?.message).toMatch(/test\/stuck.*500 ms/);
  }, 60_000);

  it('safe mode loads no extension: a package that passed conformance is refused, naming safe mode, and nothing of it is in use', async () => {
    const h = await host({ safe: true });
    const p = await h.install({ from: stuck(PASSES), builtBy: null });
    expect((await h.check(p)).passed).toBe(true);
    const load = await h.load(p);
    expect(load.status === 'refused' && load.reason).toMatch(/safe mode/);
    expect(await h.loaded()).toEqual([]);
    expect(await h.checks()).toEqual([]);
  }, 60_000);
});

describe('#348 where a package loads', () => {
  it('a package an agent built loads in the sandbox even when its bytes are a release package\'s; the same bytes written by no agent load in the hub', async () => {
    const folder = stuck(PASSES);
    const release = [{ id: 'test/stuck', version: '1.0.0', digest: packageDigest(folder) }];
    for (const [builtBy, place] of [['session:01K74FKZVK8Q2X5R7M3N9P4T6W', 'sandbox'], [null, 'hub']] as const) {
      const h = await host({ release });
      const p = await h.install({ from: folder, builtBy });
      expect((await h.check(p)).passed).toBe(true);
      const load = await h.load(p);
      expect(load.status === 'loaded' && load.place, `built by ${builtBy}`).toBe(place);
    }
  }, 60_000);
});
