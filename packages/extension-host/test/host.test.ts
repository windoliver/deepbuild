// #348's "Added Oct 9", which no checkbox criterion names: every extension run gets a timeout, and safe mode loads
// no extension at all; and the rule behind AC5 the acceptance tests reach only with changed bytes: what an agent
// built runs sandboxed even when its bytes are the release's. Each runs a real package through a real host, record
// and supervisor.
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CheckSpec } from '@deepbuild/conformance';
import { openAsks } from '@deepbuild/asks';
import { openRecord, type RecordStore } from '@deepbuild/record';
import { openSupervisor, type Supervisor } from '@deepbuild/supervisor';
import { openExtensionHost, openTrust, packageDigest, type ExtensionHost, type ProjectTrust, type ReleaseEntry } from '../src/index.js';

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

/** A package of `code`, its manifest's id and fields given, its digest stamped. */
function pkgOf(id: string, code: string, fields: Record<string, unknown> = {}, file = 'index.ts'): string {
  const folder = temp();
  writeFileSync(join(folder, file), code, { mode: file === 'main' ? 0o755 : 0o644 });
  const manifest = { id, version: '1.0.0', digest: '', ...fields };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return folder;
}
/** A package whose check kind ext.stuck.run answers `body`'s value, and which runs `also` as it loads. */
const stuck = (body: string, also = '', fields: Record<string, unknown> = {}): string =>
  pkgOf('test/stuck', `export default function (deep: any): void {\n  deep.registerCheck('ext.stuck.run', () => ${body});\n  ${also}\n}\n`, { checks: ['ext.stuck.run'], ...fields });
/** The PIDs the supervisor tracked for a run. */
async function tracked(record: RecordStore, run: string | null): Promise<number[]> {
  return (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === 'process.tracked' && (e.data as { run?: string }).run === run).map((e) => (e.data as { pid: number }).pid);
}
interface World { h: ExtensionHost; record: RecordStore; trust: ProjectTrust }
async function world(options: { safe?: boolean; release?: ReleaseEntry[]; ready?: false } = {}): Promise<World> {
  const dir = temp();
  const record: RecordStore = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor: Supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  closing.push(record, supervisor);
  mkdirSync(join(dir, 'home'));
  const trust = await openTrust({ record, now: Date.now });
  const h = await openExtensionHost({ record, supervisor, trust, home: join(dir, 'home'), now: Date.now, safe: options.safe, release: options.release ?? [] });
  closing.push(h);
  if (options.ready !== false) await h.ready();
  return { h, record, trust };
}
const host = async (options: { safe?: boolean; release?: ReleaseEntry[] } = {}): Promise<ExtensionHost> => (await world(options)).h;
const SPEC: CheckSpec = { kind: 'ext.stuck.run', runner: 'run', inputs: [], depth: 'unit', oracle: 'code', contract: null };

const PASSES = "({ outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [], mask: null })";
/** Its one failure's message is the PID of the process it runs in. */
const PID = "({ outcome: 'failed', testsRun: 1, failures: [{ test: 'pid', file: 'index.ts', line: 1, stack: null, assertion: false, message: String(process.pid) }], evidence: [], read: [], mask: null })";
const YOU = { writer: 'app', actor: 'you', scope: 'you' };
/** A main's body after its first line: it answers the host's load (request 1) with an error when it could read `canary`. */
const SHELL_MAIN = (canary: string): string => `read line\nif cat '${canary}' >/dev/null 2>&1; then echo '{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"read the canary"}}'; else echo '{"jsonrpc":"2.0","id":1,"result":null}'; fi\nread line\n`;
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function pidOf(h: ExtensionHost): Promise<number> {
  return Number((await h.runCheck('ext.stuck.run', SPEC, { checkout: temp(), deadline: 10_000 })).failures[0]?.message);
}

describe('#348 Added Oct 9', () => {
  it('a check run that never ends is stopped at its deadline: overran, naming the package and the deadline, and its process ends', async () => {
    const { h, record } = await world();
    const p = await h.install({ from: stuck('new Promise(() => undefined)'), builtBy: null });
    expect((await h.check(p)).passed).toBe(true);
    const load = await h.load(p);
    expect(load.status).toBe('loaded');
    const pids = await tracked(record, load.status === 'loaded' ? load.run : null);
    expect(pids.length).toBeGreaterThan(0);
    const t0 = Date.now();
    const r = await h.runCheck('ext.stuck.run', SPEC, { checkout: temp(), deadline: 500 });
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(r.outcome).toBe('overran');
    expect(r.failures[0]?.message).toMatch(/test\/stuck.*500 ms/);
    expect(await h.loaded()).toEqual([]);
    expect(pids.filter(alive)).toEqual([]);
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

describe('#348 review regressions', () => {
  it('a main whose first line is #!/bin/sh gets no read grant beyond its folder: it can\'t read a file outside it', async () => {
    const canary = join(temp(), 'secret.txt');
    writeFileSync(canary, 'canary\n');
    // It answers the host's load (request 1) with an error when it could read the canary.
    const folder = pkgOf('test/shell', `#!/bin/sh\n${SHELL_MAIN(canary)}`, { checks: [] }, 'main');
    const h = await host();
    const c = await h.check(await h.install({ from: folder, builtBy: null }));
    expect(c.reasons).toEqual([]);
    expect(c.passed).toBe(true);
  }, 60_000);

  it('revoking a project\'s trust stops its running extension: its check is gone, it is no longer loaded, and its process ends', async () => {
    const { h, trust } = await world();
    const repo = temp();
    await trust.answer(YOU, repo, true);
    const p = await h.install({ from: stuck(PID), builtBy: null, project: repo });
    expect((await h.check(p)).passed).toBe(true);
    expect((await h.load(p)).status).toBe('loaded');
    const pid = await pidOf(h);
    expect(alive(pid)).toBe(true);
    await trust.answer(YOU, repo, false);
    expect((await h.runCheck('ext.stuck.run', SPEC, { checkout: temp(), deadline: 10_000 })).outcome).toBe('missing');
    expect(await h.loaded()).toEqual([]);
    const load = await h.load(p);
    expect(load.status === 'refused' && load.reason).toMatch(/trust/);
    expect(alive(pid)).toBe(false);
  }, 60_000);

  it('two loads of one project\'s package at once start one process, and close stops it', async () => {
    const { h, record, trust } = await world();
    const repo = temp();
    await trust.answer(YOU, repo, true);
    const p = await h.install({ from: stuck(PID), builtBy: null, project: repo });
    expect((await h.check(p)).passed).toBe(true);
    const [a, b] = await Promise.all([h.load(p), h.load(p)]);
    expect(a.status === 'loaded' && a.run).toBeTruthy();
    expect(b).toEqual(a);
    const runs = new Set((await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === 'process.starting').map((e) => (e.data as { run: string }).run));
    expect(runs.size, 'the conformance run and one load').toBe(2);
    const pid = await pidOf(h);
    await h.close();
    expect(alive(pid)).toBe(false);
  }, 60_000);

  it('a main naming an executable that is no interpreter on the hub\'s PATH gets no read grant for its tree', async () => {
    const tree = temp();
    mkdirSync(join(tree, 'bin'));
    // A copy of Node under another name, outside every install the hub runs (a copied system program won't run).
    copyFileSync(realpathSync(process.execPath), join(tree, 'bin', 'tool'));
    chmodSync(join(tree, 'bin', 'tool'), 0o755);
    const canary = join(tree, 'secret.txt');
    writeFileSync(canary, 'canary\n');
    const reply = `let read = false; try { require('fs').readFileSync(${JSON.stringify(canary)}); read = true; } catch {}
process.stdin.once('data', () => process.stdout.write(JSON.stringify(read ? { jsonrpc: '2.0', id: 1, error: { code: 1, message: 'read the canary' } } : { jsonrpc: '2.0', id: 1, result: null }) + '\\n'));`;
    const folder = pkgOf('test/tool', `#!${join(tree, 'bin', 'tool')}\n${reply}\n`, { checks: [] }, 'main');
    const h = await host();
    const c = await h.check(await h.install({ from: folder, builtBy: null }));
    expect(c.reasons.join('\n')).not.toMatch(/read the canary/);
  }, 60_000);

  it('a running project extension that calls the API after you revoke its trust is refused and stopped, with nothing appended', async () => {
    const { h, record, trust } = await world();
    const repo = temp();
    await trust.answer(YOU, repo, true);
    const late = "setTimeout(() => void deep.record.append({ v: 1, id: '01K74FKZVK8Q2X5R7M3N9P4T6W', kind: 'task.created', ts: Date.now(), data: { task_ref: 'task:01K74FX2B4D6F8H0K2M4P6R8T0', thread: '01K74G1Z3X5V7T9R1P3N5M7K9H', owner: 'you', title: 'late' } }), 1500);";
    const p = await h.install({ from: stuck(PASSES, late, { access: { words: ['record'] } }), builtBy: null, project: repo });
    expect((await h.check(p)).passed).toBe(true);
    const load = await h.load(p);
    expect(load.status).toBe('loaded');
    const pids = await tracked(record, load.status === 'loaded' ? load.run : null);
    await trust.answer(YOU, repo, false);
    await new Promise((resolve) => setTimeout(resolve, 4000));
    expect((await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === 'task.created')).toEqual([]);
    expect(await h.loaded()).toEqual([]);
    expect(pids.filter(alive)).toEqual([]);
  }, 60_000);

  it('the bytes that run are the bytes its load checked: files swapped in its install folder before the hub is ready never run', async () => {
    for (const place of ['sandbox', 'hub'] as const) {
      const folder = stuck(PASSES);
      const { h } = await world({ ready: false, release: place === 'hub' ? [{ id: 'test/stuck', version: '1.0.0', digest: packageDigest(folder) }] : [] });
      const p = await h.install({ from: folder, builtBy: null });
      expect((await h.check(p)).passed).toBe(true);
      const load = await h.load(p);
      expect(load.status === 'loaded' && load.place).toBe(place);
      writeFileSync(join(p.folder, 'index.ts'), `export default function (deep: any): void {\n  deep.registerCheck('ext.stuck.run', () => ${PID});\n}\n`);
      await h.ready();
      expect((await h.runCheck('ext.stuck.run', SPEC, { checkout: temp(), deadline: 10_000 })).outcome, place).toBe('passed');
    }
  }, 60_000);

  it('closing the host while a load is starting its process stops that process, and the load is refused', async () => {
    const { h, record } = await world();
    const p = await h.install({ from: stuck(PASSES), builtBy: null });
    expect((await h.check(p)).passed).toBe(true);
    const pidsNow = async (): Promise<number[]> => (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === 'process.tracked').map((e) => (e.data as { pid: number }).pid);
    const before = (await pidsNow()).length;
    const load = h.load(p);
    while ((await pidsNow()).length === before) await new Promise((resolve) => setTimeout(resolve, 2));
    await h.close();
    expect((await load).status).toBe('refused');
    expect(await h.loaded()).toEqual([]);
    expect((await pidsNow()).slice(before).filter(alive)).toEqual([]);
  }, 60_000);

  it('turning on a project extension whose trust you revoked is refused, and it is stopped', async () => {
    const { h, trust } = await world();
    const repo = temp();
    await trust.answer(YOU, repo, true);
    const folder = pkgOf('test/route', "export default function (deep: any): void {\n  deep.registerRoute('GET /hi', () => ({ status: 200, body: 'hi' }));\n}\n", { checks: [] });
    const p = await h.install({ from: folder, builtBy: null, project: repo });
    expect((await h.check(p)).passed).toBe(true);
    expect((await h.load(p)).status).toBe('loaded');
    await trust.answer(YOU, repo, false);
    await expect(h.turnOn('test/route', ['GET /hi'])).rejects.toThrow(/trust/);
    expect(await h.loaded()).toEqual([]);
  }, 60_000);
});
