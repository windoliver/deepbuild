// #2315: the hub's stack runtime is the environment@1 provider the extension host loaded, not env-local hardcoded.
// A real host, record, lease table, supervisor and Stacks: a kitted replacement installed and loaded takes deep env
// up and down; disabled, its running handle stops once and the next up is refused naming it, with env-local's own
// up command never run.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import type { JsonValue } from '@deepbuild/contracts';
import { openAsks } from '@deepbuild/asks';
import { answers, downStack, environmentOf, keysOf, leaseKinds, newRun, portKind, upStack } from '@deepbuild/env-local';
import { openExtensionHost, openTrust, packageDigest } from '@deepbuild/extension-host';
import { openLeases } from '@deepbuild/leases';
import { openRecord } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';
import { selectEnvironment } from '../src/environment-select.js';
import { Stacks } from '../src/stacks.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * A release package whose environment@1 fill is the kit's own reference fill, each up and down written to `log` and
 * each started pid to `log.pids`. A checkout holding \`hang\` gets an up that never settles; with \`log.fail-down\`
 * present, down fails and leaves the server running.
 */
function replacement(dir: string, log: string): { folder: string; entry: { id: string; version: string; digest: string } } {
  const folder = join(dir, 'pkg');
  mkdirSync(folder);
  writeFileSync(join(folder, 'index.ts'), `import { appendFileSync, existsSync } from 'node:fs';
let fill: any;
const reference = async () => (fill ??= (await import(${JSON.stringify(join(REPO, 'packages/conformance/dist/index.js'))})).slotKits().find((k: any) => k.slot === 'environment@1').clean()[0]);
export default function (deep: any): void {
  deep.registerEnvironment('swapped', {
    slot: 'environment@1', revision: 1,
    up: async (spec: any, lease: any, checkout: string) => {
      appendFileSync(${JSON.stringify(log)}, 'up ' + lease.token + '\\n');
      if (existsSync(checkout + '/hang')) return new Promise(() => undefined);
      const handle = await (await reference()).up(spec, lease, checkout);
      appendFileSync(${JSON.stringify(log + '.pids')}, handle.pid + '\\n');
      return handle;
    },
    down: async (handle: any) => {
      if (existsSync(${JSON.stringify(log + '.fail-down')})) { appendFileSync(${JSON.stringify(log)}, 'down-failed ' + handle.id + '\\n'); throw Error('down failed'); }
      appendFileSync(${JSON.stringify(log)}, 'down ' + handle.id + '\\n');
      return (await reference()).down(handle);
    },
  });
}
`);
  const manifest: Record<string, unknown> = { id: 'test/swapped-env', version: '1.0.0', digest: `d1:${'0'.repeat(64)}`, environments: ['swapped'], requires: { preview: ['deep.registerEnvironment'] } };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return { folder, entry: { id: 'test/swapped-env', version: '1.0.0', digest: String(manifest.digest) } };
}

async function world() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2315-')));
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const leases = await openLeases({ record, now: Date.now });
  const ports = portKind();
  for (const kind of leaseKinds) await leases.declare('env-local', kind, kind.name === ports.kind ? ports.free : undefined);
  const supervisor = await openSupervisor({ record, asks, leases, now: Date.now, resources: [ports], settings: { asks: { unblock: { deadline_ms: 60_000 } } } });
  const trust = await openTrust({ record, now: Date.now });
  const log = join(dir, 'provider.log');
  const pkg = replacement(dir, log);
  const host = await openExtensionHost({ record, supervisor, trust, home: join(dir, 'home'), release: [pkg.entry], now: Date.now, leases });
  await host.ready();
  const installed = await host.install({ from: pkg.folder, builtBy: null });
  expect(installed.kits, 'the replacement passed environment@1 at install').toContainEqual({ slot: 'environment@1', fill: 'swapped', verdict: 'PASS' });
  expect((await host.check(installed)).passed, 'its conformance passed').toBe(true);
  const load = await host.load(installed);
  expect(load, JSON.stringify(load)).toMatchObject({ status: 'loaded' });
  // The kit's own calls at install aren't the hub's.
  rmSync(log, { force: true });
  const shipped = { newRun, up: (u: Parameters<typeof upStack>[1]) => upStack(supervisor, u), down: (run: string) => downStack(supervisor, run), healthy: answers, wanted: environmentOf, keys: keysOf, warm: () => { throw Error('no warm stack in this test'); } };
  const stacks = new Stacks({
    raw: (sql, params) => record.raw(sql, params), now: Date.now, plant: undefined, held: [], scrub: () => undefined,
    appendCore: async (kind, data, extra) => { await record.append({ writer: 'core', actor: 'you', scope: 'you' }, { v: 1, id: newRun().slice(4), kind, ts: Date.now(), data: data as JsonValue, ...extra }); },
    supervisor: () => supervisor, leases: () => leases, stopping: () => false, session: () => undefined, pending: () => false, idle: () => true, plantedAsk: async () => undefined,
    environment: selectEnvironment(shipped, { extensions: () => host, ports: ports.keys }),
  });
  // A worktree: env-local's up command leaves a marker, so a start through env-local shows.
  const tree = (name: string, within = 10): string => {
    const at = join(dir, name);
    mkdirSync(join(at, '.deepbuild'), { recursive: true });
    writeFileSync(join(at, 'server.mjs'), "import { writeFileSync } from 'node:fs'; import http from 'node:http'; writeFileSync('env-local-ran', ''); http.createServer((_, r) => r.end('ok')).listen(Number(process.env.web), '127.0.0.1');\n");
    writeFileSync(join(at, '.deepbuild/done.yaml'), `environment:\n  up: ${JSON.stringify(`'${process.execPath}' server.mjs`)}\n  ports: [web]\n  ready: {http: "http://127.0.0.1:\${web}/health", within: ${within}}\n`);
    return at;
  };
  const worktree = tree('worktree');
  const calls = (): string[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => l.split(' ')[0]!) : []);
  // A server whose down was made to fail is stopped here, by the pid its up returned.
  const close = async () => {
    for (const pid of existsSync(`${log}.pids`) ? readFileSync(`${log}.pids`, 'utf8').trim().split('\n').map(Number) : []) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    // A down made to fail fails again at the host's close; its servers were stopped above.
    await stacks.close(); await host.close().catch(() => undefined); await supervisor.close(); await record.close(); rmSync(dir, { recursive: true, force: true }); };
  return { host, leases, stacks, worktree, tree, calls, failDown: () => writeFileSync(`${log}.fail-down`, ''), envLocalRan: () => existsSync(join(worktree, 'env-local-ran')), close };
}
const AT = { path: '/worktree', remedy: 'deep env up' };

it('a loaded replacement environment@1 provider takes env up and down; disabled, its handle stops once and the next up is refused naming it', async () => {
  const w = await world();
  try {
    const up = await w.stacks.up(w.worktree);
    expect(up, JSON.stringify(up)).toMatchObject({ status: 'ready' });
    expect(w.calls()).toEqual(['up']);
    expect(await w.stacks.up(w.worktree), 'a healthy stack of the replacement is reused').toMatchObject({ status: 'ready', run: up.run });
    expect(w.calls()).toEqual(['up']);
    expect((await w.stacks.down(w.worktree, AT)).left).toEqual([]);
    expect(w.calls()).toEqual(['up', 'down']);

    const second = await w.stacks.up(w.worktree);
    expect(second, JSON.stringify(second)).toMatchObject({ status: 'ready' });
    await w.host.disable('test/swapped-env');
    expect(w.calls(), 'disabling stops the running handle').toEqual(['up', 'down', 'up', 'down']);
    const refused = await w.stacks.up(w.worktree);
    expect(refused).toMatchObject({ status: 'BLOCKED' });
    expect(String(refused.cause)).toContain('swapped');
    expect(String(refused.cause)).toContain('test/swapped-env');
    expect(w.calls(), 'no second down reaches the provider').toEqual(['up', 'down', 'up', 'down']);
    expect(w.envLocalRan(), 'env-local never started the stack').toBe(false);
  } finally { await w.close(); }
}, 120_000);

it('two stacks of the replacement, up at once, lease two ports and stop each on its own', async () => {
  const w = await world();
  try {
    const other = w.tree('other');
    const [a, b] = await Promise.all([w.stacks.up(w.worktree), w.stacks.up(other)]);
    expect(a, JSON.stringify(a)).toMatchObject({ status: 'ready' });
    expect(b, JSON.stringify(b)).toMatchObject({ status: 'ready' });
    expect((a.ports as { web: number }).web).not.toBe((b.ports as { web: number }).web);
    expect((await w.stacks.down(other, AT)).left).toEqual([]);
    expect(await w.stacks.up(w.worktree), 'the other stack still answers').toMatchObject({ status: 'ready', run: a.run });
    expect(w.calls()).toEqual(['up', 'up', 'down']);
    expect((await w.stacks.down(w.worktree, AT)).left).toEqual([]);
  } finally { await w.close(); }
}, 120_000);

it('a stack of a load that is gone is never reused, even while its server still answers', async () => {
  const w = await world();
  try {
    expect(await w.stacks.up(w.worktree)).toMatchObject({ status: 'ready' });
    w.failDown();
    await w.host.disable('test/swapped-env').catch(() => undefined);
    expect(w.calls()).toEqual(['up', 'down-failed']);
    const again = await w.stacks.up(w.worktree);
    expect(again, JSON.stringify(again)).toMatchObject({ status: 'BLOCKED' });
    expect(String(again.cause)).toContain('test/swapped-env');
  } finally { await w.close(); }
}, 120_000);

it('a failed down keeps its port leased: the next stack gets another', async () => {
  const w = await world();
  try {
    const a = await w.stacks.up(w.worktree);
    expect(a).toMatchObject({ status: 'ready' });
    w.failDown();
    await expect(w.stacks.down(w.worktree, AT)).rejects.toThrow();
    const b = await w.stacks.up(w.tree('other'));
    expect(b, JSON.stringify(b)).toMatchObject({ status: 'ready' });
    expect((b.ports as { web: number }).web).not.toBe((a.ports as { web: number }).web);
    const held = (await w.leases.leases()).map((v) => `${v.lease.resource.kind}:${v.lease.resource.key}`);
    expect(held, 'the failed stack still holds its port lease').toContain(`port:${(a.ports as { web: number }).web}`);
  } finally { await w.close(); }
}, 120_000);

it('an up the provider never finishes ends BLOCKED once the environment\'s ready.within has passed', async () => {
  const w = await world();
  try {
    const stuck = w.tree('stuck', 2);
    writeFileSync(join(stuck, 'hang'), '');
    const began = Date.now();
    const up = await w.stacks.up(stuck);
    expect(up, JSON.stringify(up)).toMatchObject({ status: 'BLOCKED' });
    expect(Date.now() - began).toBeLessThan(30_000);
  } finally { await w.close(); }
}, 120_000);
