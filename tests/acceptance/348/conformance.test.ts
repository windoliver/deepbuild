// AC1: an extension that fails conformance doesn't load, and the reason is shown. AC7: an installed extension whose
// files changed since its checks ran doesn't load until they pass again, and shows "changed since checked".
//
// Conformance is the host's `check` (README, Readings: conformance): the manifest contract, the package's code
// registering in the platform sandbox without throwing, and every check kind it registers being one its manifest
// declares. Its result is kept for the package's digest; `load` refuses a package with no passing result for the
// digest its files have now. Each refused fixture is installed from a folder, written by no agent.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExtensionHost, Installed, Load } from '../../../packages/extension-host/src/index.ts';
import { openHost, openWorld, pkg, report, stamp, type World } from './helpers.ts';

// One host for AC1, opened by its first test (not in a beforeAll, so at the base each test fails, never skips).
let shared: ExtensionHost | undefined;
async function sharedHost(): Promise<ExtensionHost> {
  if (!shared) {
    shared = await openHost(await openWorld());
    await shared.ready();
  }
  return shared;
}
afterAll(async () => { await shared?.close(); });

/** The criterion's assertion: the package didn't load, nothing of it is registered, and the reason names `named`. */
async function refusedNaming(h: ExtensionHost, p: Installed, load: Load, named: RegExp): Promise<void> {
  expect(load.status, `${p.id} loaded though it failed conformance: ${JSON.stringify(load)}`).toBe('refused');
  expect(load.status === 'refused' ? load.reason : '', `the reason shown for ${p.id}`).toMatch(named);
  expect((await h.loaded()).map((l) => l.id), `${p.id} is not among the loaded extensions`).not.toContain(p.id);
  expect((await h.checks()).filter((c) => c.extension === p.id), `nothing ${p.id} registered is in use`).toEqual([]);
}

describe('AC1 #348.ef505d0a an extension that fails conformance doesn\'t load, and the reason is shown', () => {
  it('AC1 a package whose manifest asks for an access word outside access@1 (`network`) fails conformance naming the word, and doesn\'t load', async () => {
    const host = await sharedHost();
    const p = await host.install({ from: await pkg('bad-manifest'), builtBy: null });
    const c = await host.check(p);
    expect(c.passed, JSON.stringify(c)).toBe(false);
    expect(c.reasons.join('\n')).toMatch(/network/);
    await refusedNaming(host, p, await host.load(p), /network/);
  }, 60_000);

  it('AC1 a package that registers a check kind its manifest doesn\'t declare fails conformance naming the kind, and doesn\'t load', async () => {
    const host = await sharedHost();
    const p = await host.install({ from: await pkg('undeclared-check'), builtBy: null });
    const c = await host.check(p);
    expect(c.passed, JSON.stringify(c)).toBe(false);
    expect(c.reasons.join('\n')).toMatch(/ext\.undeclared\.lint/);
    await refusedNaming(host, p, await host.load(p), /ext\.undeclared\.lint/);
  }, 60_000);

  it('AC1 a package whose code throws while it registers fails conformance with the error it threw, and doesn\'t load', async () => {
    const host = await sharedHost();
    const p = await host.install({ from: await pkg('throws-at-load'), builtBy: null });
    const c = await host.check(p);
    expect(c.passed, JSON.stringify(c)).toBe(false);
    expect(c.reasons.join('\n')).toMatch(/dh348-throws-at-load/);
    await refusedNaming(host, p, await host.load(p), /dh348-throws-at-load/);
  }, 60_000);

  it('AC1 nothing loads before its conformance has run: a sound package never checked is refused; once checked it loads and its check kind is in use', async () => {
    const host = await sharedHost();
    const p = await host.install({ from: await pkg('probe'), builtBy: null });
    const before = await host.load(p);
    expect(before.status, `an unchecked package loaded: ${JSON.stringify(before)}`).toBe('refused');
    const c = await host.check(p);
    expect(c.passed, `the sound package fails conformance: ${c.reasons.join('; ')}`).toBe(true);
    expect(c.digest).toBe(p.digest);
    const after = await host.load(p);
    expect(after.status, JSON.stringify(after)).toBe('loaded');
    expect(await host.checks()).toContainEqual({ kind: 'ext.probe.report', extension: 'test/probe' });
    expect(typeof (await report(host, 'ext.probe.report')).pid).toBe('number');
  }, 60_000);
});

describe('AC7 #348.583abb3f an installed extension whose files changed since its checks ran doesn\'t load until they pass again, and shows "changed since checked"', () => {
  /** Installs and checks the probe, loads it on a first host, then closes that host (a hub restart). */
  async function checkedThenRestarted(w: World): Promise<Installed> {
    const first = await openHost(w);
    await first.ready();
    const p = await first.install({ from: await pkg('probe'), builtBy: null });
    expect((await first.check(p)).passed).toBe(true);
    expect((await first.load(p)).status).toBe('loaded');
    await first.close();
    return p;
  }
  /** A change to the installed files, with the manifest's digest rewritten to match, as an update would leave it. */
  async function change(p: Installed, body?: string): Promise<void> {
    const index = join(p.folder, 'index.ts');
    if (body === undefined) appendFileSync(index, '\n// changed after its checks ran\n');
    else writeFileSync(index, body);
    await stamp(p.folder);
  }

  it('AC7 after a file of the installed package changes, the next load is refused showing "changed since checked"; once its checks pass again it loads', async () => {
    const w = await openWorld();
    const p = await checkedThenRestarted(w);
    await change(p);
    const h = await openHost(w);
    await h.ready();
    const mine = (await h.installed()).find((i) => i.id === 'test/probe');
    expect(mine, 'the restarted host still lists the installed package').toBeDefined();
    const refused = await h.load(mine!);
    expect(refused.status, `the changed package loaded: ${JSON.stringify(refused)}`).toBe('refused');
    expect(refused.status === 'refused' ? refused.reason : '').toContain('changed since checked');
    expect((await h.checks()).filter((c) => c.extension === 'test/probe')).toEqual([]);
    const again = await h.check(mine!);
    expect(again.passed, again.reasons.join('; ')).toBe(true);
    expect(again.digest, 'the new check ran on the changed files').not.toBe(p.digest);
    expect((await h.load(mine!)).status).toBe('loaded');
    expect(await h.checks()).toContainEqual({ kind: 'ext.probe.report', extension: 'test/probe' });
  }, 120_000);

  it('AC7 a change that breaks the package shows "changed since checked", fails its checks again, and still doesn\'t load', async () => {
    const w = await openWorld();
    const p = await checkedThenRestarted(w);
    const broken = `${readFileSync(join(p.folder, 'index.ts'), 'utf8')}\nthrow new Error('dh348-broken-by-change');\n`;
    await change(p, broken);
    const h = await openHost(w);
    await h.ready();
    const mine = (await h.installed()).find((i) => i.id === 'test/probe')!;
    const refused = await h.load(mine);
    expect(refused.status === 'refused' ? refused.reason : JSON.stringify(refused)).toContain('changed since checked');
    const again = await h.check(mine);
    expect(again.passed).toBe(false);
    expect(again.reasons.join('\n')).toMatch(/dh348-broken-by-change/);
    const still = await h.load(mine);
    expect(still.status, JSON.stringify(still)).toBe('refused');
    expect((await h.loaded()).map((l) => l.id)).not.toContain('test/probe');
  }, 120_000);
});
