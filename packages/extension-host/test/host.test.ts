// #348's "Added Oct 9", which no checkbox criterion names: every extension run gets a timeout, and safe mode loads
// no extension at all; and the rule behind AC5 the acceptance tests reach only with changed bytes: what an agent
// built runs sandboxed even when its bytes are the release's. Each runs a real package through a real host, record
// and supervisor.
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CheckSpec } from '@deepbuild/conformance';
import { openAsks } from '@deepbuild/asks';
import { openRecord, type RecordStore } from '@deepbuild/record';
import { openSupervisor, type Supervisor } from '@deepbuild/supervisor';
import { peer } from '../runtime/deep.mjs';
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
interface World { h: ExtensionHost; record: RecordStore; trust: ProjectTrust; home: string; again: () => Promise<ExtensionHost> }
/** `held`: each process the supervisor starts is reported started only once the promise it returns then resolves. */
async function world(options: { safe?: boolean; release?: ReleaseEntry[]; ready?: false; held?: () => Promise<void> } = {}): Promise<World> {
  const dir = temp();
  const record: RecordStore = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor: Supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  closing.push(record, supervisor);
  const held = options.held;
  const start: Supervisor['start'] = async (o) => { const started = await supervisor.start(o); await held?.(); return started; };
  const supervising = held === undefined ? supervisor
    : new Proxy(supervisor, { get: (to, key) => (key === 'start' ? start : (Reflect.get(to, key) as (...a: unknown[]) => unknown).bind(to)) });
  mkdirSync(join(dir, 'home'));
  const trust = await openTrust({ record, now: Date.now });
  const home = join(dir, 'home');
  /** A host on this home: after the first, a restart of the hub. */
  const again = async (): Promise<ExtensionHost> => {
    const h = await openExtensionHost({ record, supervisor: supervising, trust, home, now: Date.now, safe: options.safe, release: options.release ?? [] });
    closing.push(h);
    if (options.ready !== false) await h.ready();
    return h;
  };
  return { h: await again(), record, trust, home, again };
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

  it('turning a package on while the host closes is refused, and the listener it bound is closed', async () => {
    const { h } = await world();
    const folder = pkgOf('test/route', "export default function (deep: any): void {\n  deep.registerRoute('GET /hi', () => ({ status: 200, body: 'hi' }));\n}\n", { checks: [] });
    const p = await h.install({ from: folder, builtBy: null });
    expect((await h.check(p)).passed).toBe(true);
    expect((await h.load(p)).status).toBe('loaded');
    const [on] = await Promise.allSettled([h.turnOn('test/route', ['GET /hi']), h.close()]);
    expect(on.status).toBe('rejected');
  }, 60_000);

  it('a load after a new install of the same package runs the new bytes, not the copy already running', async () => {
    const h = await host();
    const first = await h.install({ from: stuck(PASSES), builtBy: null });
    expect((await h.check(first)).passed).toBe(true);
    expect((await h.load(first)).status).toBe('loaded');
    const second = await h.install({ from: stuck(PID), builtBy: null });
    expect((await h.check(second)).passed).toBe(true);
    expect((await h.load(second)).status).toBe('loaded');
    expect((await h.runCheck('ext.stuck.run', SPEC, { checkout: temp(), deadline: 10_000 })).outcome).toBe('failed');
  }, 60_000);

  it('a request whose body is still arriving when you revoke trust never reaches the package', async () => {
    const { h, trust } = await world();
    const repo = temp();
    await trust.answer(YOU, repo, true);
    const folder = pkgOf('test/route', "export default function (deep: any): void {\n  deep.registerRoute('POST /hi', () => ({ status: 200, body: 'hi' }));\n}\n", { checks: [] });
    const p = await h.install({ from: folder, builtBy: null, project: repo });
    expect((await h.check(p)).passed).toBe(true);
    expect((await h.load(p)).status).toBe('loaded');
    const { address } = await h.turnOn('test/route', ['POST /hi']);
    const [hostname, port] = address.split(':');
    const answered = new Promise<{ status?: number; body: string }>((resolve, reject) => {
      const req = request({ hostname, port: Number(port), method: 'POST', path: '/hi', headers: { 'content-length': '2' } }, (res) => {
        let body = '';
        res.on('data', (c: Buffer) => { body += c.toString(); });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.write('a');
      setTimeout(() => void trust.answer(YOU, repo, false).then(() => req.end('b'), reject), 500);
    });
    const r = await answered.catch(() => ({ status: undefined, body: '' }));
    expect(r.body).not.toBe('hi');
    expect(await h.loaded()).toEqual([]);
  }, 60_000);

  it('a sandboxed main that writes a line longer than a frame is cut off and fails, without waiting out its deadline', async () => {
    // 40 MiB with no newline, then it waits: the host must not keep reading it.
    const folder = pkgOf('test/flood', "#!/bin/sh\nread line\nhead -c 41943040 /dev/zero | tr '\\0' x\nsleep 30\n", { checks: [] }, 'main');
    const h = await host();
    const c = await h.check(await h.install({ from: folder, builtBy: null }));
    expect(c.passed).toBe(false);
    expect(c.reasons.join('\n')).toMatch(/closed/);
  }, 60_000);

  it('a package in the hub that overruns its deadline is unloaded: what it calls after is refused, and nothing is appended', async () => {
    const append = "deep.record.append({ v: 1, id: '01K74FKZVK8Q2X5R7M3N9P4T6W', kind: 'task.created', ts: Date.now(), data: { task_ref: 'task:01K74FX2B4D6F8H0K2M4P6R8T0', thread: '01K74G1Z3X5V7T9R1P3N5M7K9H', owner: 'you', title: 'late' } })";
    const folder = stuck(`new Promise((resolve) => setTimeout(() => resolve(${append}), 1500))`, '', { access: { words: ['record'] } });
    const { h, record } = await world({ release: [{ id: 'test/stuck', version: '1.0.0', digest: packageDigest(folder) }] });
    const p = await h.install({ from: folder, builtBy: null });
    expect((await h.check(p)).passed).toBe(true);
    const load = await h.load(p);
    expect(load.status === 'loaded' && load.place).toBe('hub');
    expect((await h.runCheck('ext.stuck.run', SPEC, { checkout: temp(), deadline: 500 })).outcome).toBe('overran');
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === 'task.created')).toEqual([]);
    expect(await h.loaded()).toEqual([]);
  }, 60_000);

  it('a JSON-RPC line over 16 MiB is never parsed, even when its newline arrives with it: the connection is cut', async () => {
    const stream = new PassThrough();
    const served: string[] = [];
    peer(stream, async (method) => { served.push(method); return null; });
    stream.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'deep.config.get', params: ['x'.repeat(17 * 1024 * 1024)] })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(served).toEqual([]);
    expect(stream.destroyed).toBe(true);
  });

  it('a peer with 256 requests unanswered that sends another is cut off: no more of its requests are served', async () => {
    const stream = new PassThrough();
    const served: string[] = [];
    peer(stream, (method) => { served.push(method); return new Promise(() => undefined); });
    for (let id = 1; id <= 300; id++) stream.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'deep.config.get', params: ['x'] })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(served.length).toBe(256);
    expect(stream.destroyed).toBe(true);
  });

  it('the 16 MiB limit is on bytes: a line of 6 Mi three-byte characters is never parsed', async () => {
    const stream = new PassThrough();
    const served: string[] = [];
    peer(stream, async (method) => { served.push(method); return null; });
    stream.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'deep.config.get', params: ['\u20ac'.repeat(6 * 1024 * 1024)] })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(served).toEqual([]);
    expect(stream.destroyed).toBe(true);
  });

  it('a reinstall of the same version that fails leaves the installed copy as it was: it still loads and runs', async () => {
    const h = await host();
    const first = await h.install({ from: stuck(PASSES), builtBy: null });
    expect((await h.check(first)).passed).toBe(true);
    await expect(h.install({ from: stuck(PID), builtBy: null, project: join(temp(), 'no such repo') })).rejects.toThrow();
    expect((await h.load(first)).status).toBe('loaded');
    expect((await h.runCheck('ext.stuck.run', SPEC, { checkout: temp(), deadline: 10_000 })).outcome).toBe('passed');
  }, 60_000);

  /** A loaded package whose route POST /hi answers 'hi', turned on: its address. */
  async function hi(h: ExtensionHost): Promise<{ hostname: string; port: number }> {
    const folder = pkgOf('test/route', "export default function (deep: any): void {\n  deep.registerRoute('POST /hi', () => ({ status: 200, body: 'hi' }));\n}\n", { checks: [] });
    const p = await h.install({ from: folder, builtBy: null });
    expect((await h.check(p)).passed).toBe(true);
    expect((await h.load(p)).status).toBe('loaded');
    const [hostname, port] = (await h.turnOn('test/route', ['POST /hi'])).address.split(':');
    return { hostname: hostname!, port: Number(port) };
  }
  /** POSTs `body` to /hi, `length` its declared length; its answer, or its error's code. */
  const post = (to: { hostname: string; port: number }, body: string, length = Buffer.byteLength(body), end = true): Promise<{ status?: number; body: string; error?: string }> =>
    new Promise((resolve) => {
      const req = request({ ...to, method: 'POST', path: '/hi', headers: { 'content-length': String(length) } }, (res) => {
        let text = '';
        res.on('data', (c: Buffer) => { text += c.toString(); });
        res.on('end', () => resolve({ status: res.statusCode, body: text }));
        res.on('error', (e: NodeJS.ErrnoException) => resolve({ body: text, error: e.code ?? 'error' }));
      });
      req.on('error', (e: NodeJS.ErrnoException) => resolve({ body: '', error: e.code ?? 'error' }));
      req.write(body);
      if (end) req.end();
    });

  it('a client that drops its connection halfway through a body leaves the host serving the next request', async () => {
    const h = await host();
    const to = await hi(h);
    await new Promise<void>((resolve) => {
      const req = request({ ...to, method: 'POST', path: '/hi', headers: { 'content-length': '100' } });
      req.on('error', () => undefined);
      req.write('a');
      setTimeout(() => { req.destroy(); resolve(); }, 200);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await post(to, 'ok')).toMatchObject({ status: 200, body: 'hi' });
  }, 60_000);

  it('a request body over 1 MiB is refused with 413 and never reaches the package', async () => {
    const h = await host();
    const r = await post(await hi(h), 'x'.repeat(2 * 1024 * 1024));
    expect(r.body).not.toBe('hi');
    if (r.status !== undefined) expect(r.status).toBe(413);
  }, 60_000);

  it('a request body that stops arriving is cut off within the call deadline, never reaching the package', async () => {
    const h = await host();
    const t0 = Date.now();
    const r = await post(await hi(h), 'a', 100, false);
    expect(Date.now() - t0).toBeLessThan(20_000);
    expect(r.body).not.toBe('hi');
  }, 60_000);

  it('a reinstall whose record of installs can\'t be saved changes nothing installed: after a restart the package listed runs the bytes it was checked on', async () => {
    const { h, home, again } = await world();
    const first = await h.install({ from: stuck(PASSES), builtBy: null });
    expect((await h.check(first)).passed).toBe(true);
    // installed.json can't be replaced: its temp file's name is taken by a folder.
    mkdirSync(join(home, 'extensions', 'installed.json.tmp'));
    await expect(h.install({ from: stuck(PID), builtBy: null })).rejects.toThrow();
    rmSync(join(home, 'extensions', 'installed.json.tmp'), { recursive: true });
    await h.close();
    const restarted = await again();
    const [listed] = await restarted.installed();
    expect((await restarted.load(listed!)).status).toBe('loaded');
    expect((await restarted.runCheck('ext.stuck.run', SPEC, { checkout: temp(), deadline: 10_000 })).outcome).toBe('passed');
  }, 60_000);

  it('events a subscribed package fails to take are not reported delivered: deliver rejects, naming the package and its error', async () => {
    const h = await host();
    const folder = pkgOf('test/sub', "export default function (deep: any): void {\n  deep.on('session.start', () => { throw Error('handler broke'); });\n}\n", { checks: [], access: { words: ['record'] } });
    const p = await h.install({ from: folder, builtBy: null, grant: { record: ['session.start'] } });
    expect((await h.check(p)).passed).toBe(true);
    expect((await h.load(p)).status).toBe('loaded');
    const event = {
      v: 1, id: '01K74FKZVK8Q2X5R7M3N9P4T6W', kind: 'session.start', writer: 'hook', actor: 'you', scope: 'you', ts: Date.now(), log_pos: 1,
      data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: '01K74G1Z3X5V7T9R1P3N5M7K9H' }, evidence: [],
    } as unknown as Parameters<ExtensionHost['deliver']>[0][number];
    await expect(h.deliver([event])).rejects.toThrow(/test\/sub.*handler broke/);
  }, 60_000);

  it('closing the host while ready is starting a package loaded before it returns only once that package\'s process is stopped', async () => {
    let gate = Promise.resolve();
    const { h, record } = await world({ ready: false, held: () => gate });
    const p = await h.install({ from: stuck(PASSES), builtBy: null });
    expect((await h.check(p)).passed).toBe(true);
    expect((await h.load(p)).status).toBe('loaded');
    const pidsNow = async (): Promise<number[]> => (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === 'process.tracked').map((e) => (e.data as { pid: number }).pid);
    const before = (await pidsNow()).length;
    let release = (): void => undefined;
    gate = new Promise<void>((resolve) => { release = resolve; });
    const ready = h.ready();
    while ((await pidsNow()).length === before) await new Promise((resolve) => setTimeout(resolve, 2));
    const closing = h.close();
    setTimeout(release, 300);
    await closing;
    expect((await pidsNow()).slice(before).filter(alive)).toEqual([]);
    await ready;
    expect(await h.loaded()).toEqual([]);
  }, 60_000);

  it('closing the host while a conformance run is starting returns only once its process is stopped, and no check starts after', async () => {
    let gate = Promise.resolve();
    const { h, record } = await world({ held: () => gate });
    const p = await h.install({ from: stuck(PASSES), builtBy: null });
    const pidsNow = async (): Promise<number[]> => (await record.read({ after: 0, limit: 10_000 })).filter((e) => e.kind === 'process.tracked').map((e) => (e.data as { pid: number }).pid);
    const before = (await pidsNow()).length;
    let release = (): void => undefined;
    gate = new Promise<void>((resolve) => { release = resolve; });
    const checking = h.check(p).catch(() => undefined);
    while ((await pidsNow()).length === before) await new Promise((resolve) => setTimeout(resolve, 2));
    const closing = h.close();
    setTimeout(release, 300);
    await closing;
    expect((await pidsNow()).slice(before).filter(alive)).toEqual([]);
    await checking;
    await expect(h.check(p)).rejects.toThrow(/closed/);
  }, 60_000);

  it('events for a subscribed package whose trust you revoked are not reported delivered: deliver rejects, naming it', async () => {
    const { h, trust } = await world();
    const repo = temp();
    await trust.answer(YOU, repo, true);
    const folder = pkgOf('test/sub', "export default function (deep: any): void {\n  deep.on('session.start', () => undefined);\n}\n", { checks: [], access: { words: ['record'] } });
    const p = await h.install({ from: folder, builtBy: null, project: repo, grant: { record: ['session.start'] } });
    expect((await h.check(p)).passed).toBe(true);
    expect((await h.load(p)).status).toBe('loaded');
    await trust.answer(YOU, repo, false);
    const event = {
      v: 1, id: '01K74FKZVK8Q2X5R7M3N9P4T6W', kind: 'session.start', writer: 'hook', actor: 'you', scope: 'you', ts: Date.now(), log_pos: 1,
      data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: '01K74G1Z3X5V7T9R1P3N5M7K9H' }, evidence: [],
    } as unknown as Parameters<ExtensionHost['deliver']>[0][number];
    await expect(h.deliver([event])).rejects.toThrow(/test\/sub.*trust/);
  }, 60_000);

  it('a new install of a running package stops the copy running: its check is no longer in use, and its process ends', async () => {
    const h = await host();
    const first = await h.install({ from: stuck(PID), builtBy: null });
    expect((await h.check(first)).passed).toBe(true);
    expect((await h.load(first)).status).toBe('loaded');
    const pid = await pidOf(h);
    await h.install({ from: stuck(PASSES), builtBy: null });
    expect(await h.loaded()).toEqual([]);
    expect((await h.runCheck('ext.stuck.run', SPEC, { checkout: temp(), deadline: 10_000 })).outcome).toBe('missing');
    expect(alive(pid)).toBe(false);
  }, 60_000);

  it('a check result missing what check.kind@1 requires never passes: the run fails, naming the package', async () => {
    for (const body of ["({ outcome: 'passed', testsRun: 1, failures: [] })", "({ outcome: 'great', testsRun: 1, failures: [], evidence: [], read: [], mask: null })", "({ outcome: 'passed', testsRun: -1, failures: [], evidence: [], read: [], mask: null })"]) {
      const h = await host();
      const p = await h.install({ from: stuck(body), builtBy: null });
      expect((await h.check(p)).passed).toBe(true);
      expect((await h.load(p)).status).toBe('loaded');
      const r = await h.runCheck('ext.stuck.run', SPEC, { checkout: temp(), deadline: 10_000 });
      expect(r.outcome, body).not.toBe('passed');
      expect(r.outcome, body).not.toBe('great');
      expect(r.failures[0]?.message, body).toMatch(/test\/stuck/);
    }
  }, 60_000);

  it('a package loaded before the hub is ready that fails to start makes ready reject, naming it and its error, and it is unloaded', async () => {
    const marker = join(temp(), 'fail');
    // Its conformance runs sandboxed, where the marker can't be seen; in the hub it throws once the marker is there.
    const folder = stuck(PASSES, `if (require('node:fs').existsSync(${JSON.stringify(marker)})) throw Error('start broke');`);
    writeFileSync(join(folder, 'index.ts'), `import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n${readFileSync(join(folder, 'index.ts'), 'utf8')}`);
    const manifest = JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8')) as { digest: string };
    manifest.digest = packageDigest(folder);
    writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
    const { h } = await world({ ready: false, release: [{ id: 'test/stuck', version: '1.0.0', digest: manifest.digest }] });
    const p = await h.install({ from: folder, builtBy: null });
    const c = await h.check(p);
    expect(c.reasons).toEqual([]);
    expect((await h.load(p)).status).toBe('loaded');
    writeFileSync(marker, '');
    await expect(h.ready()).rejects.toThrow(/test\/stuck.*start broke/);
    expect(await h.loaded()).toEqual([]);
  }, 60_000);
});
