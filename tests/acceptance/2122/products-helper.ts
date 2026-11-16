// Real product wiring; only the operating system's free-space reading is controlled.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, vi } from 'vitest';
import { openAsks } from '@deepbuild/asks';
import { openLeases, SLOW_SLOT } from '@deepbuild/leases';
import type { JsonValue } from '@deepbuild/contracts';
import { openRecord, openTrust, ulid } from '@deepbuild/record';
import { openSupervisor, openUnder } from '@deepbuild/supervisor';
import { HeavyQueue } from '@deepbuild/hub/lease';
import { Products } from '../../../packages/hub/src/products.js';
import { addGuards } from '../../../packages/hub/src/guards.js';
import { repoOf } from '../../../packages/hub/src/paths.js';
import { doneYaml } from '../1017/helpers.ts';
import { git, sleep } from '../18/mapping/helpers.ts';

const disk = vi.hoisted(() => ({ free: 100e9 }));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, statfsSync: (path: string) => {
    const s = fs.statfsSync(path);
    return { ...s, bavail: Math.floor(disk.free / s.bsize) };
  } };
});

export async function productWorld() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ac2122-products-')));
  const root = join(dir, 'hub');
  const repo = join(dir, 'shop');
  mkdirSync(root); mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  let time = Date.now() - 10_000;
  const now = () => time;
  disk.free = 100e9;
  const product = { name: 'bundle', path: 'out', key: ['bundle.lock'], key_values: [], build: 'mkdir -p out; printf fresh > out/value' };
  writeFileSync(join(repo, '.deepbuild', 'done.yaml'), doneYaml([product]));
  writeFileSync(join(repo, 'bundle.lock'), 'bundle 1\n');
  writeFileSync(join(repo, '.gitignore'), 'out/\n');
  git(dir, repo, 'init', '-q', '-b', 'main');
  git(dir, repo, 'add', '-A'); git(dir, repo, 'commit', '-q', '-m', 'Fixture');
  const commit = git(dir, repo, 'rev-parse', 'HEAD');
  const common = join(repo, '.git');
  const id = repoOf(repo)!;
  const record = await openRecord({ path: join(root, 'record.db'), now });
  const trust = await openTrust({ record, now });
  await trust.answer({ writer: 'app', actor: 'you', scope: 'you' }, repo, true);
  const append = async (kind: string, v: number, data: Record<string, unknown>, subject?: string, session?: string) => {
    const event = ulid(now());
    await record.append({ writer: 'core', actor: 'you', scope: 'you', ...(session ? { session } : {}) }, {
      id: event, ts: now(), v, kind, data: data as JsonValue, ...(subject ? { subject } : {}),
    });
    return event;
  };
  const table = await openLeases({ record, now, cores: 8 });
  const heavy = new HeavyQueue({ table, now, slow: SLOW_SLOT, append, worktreeOf: () => undefined, agentOf: () => undefined, pressure: () => 'normal' });
  const asks = await openAsks({ record, now, deliver: () => { throw Error('unexpected ask delivery in product fixture'); } });
  const host = await openSupervisor({ record, asks, now, settings: { asks: { unblock: { deadline_ms: 60_000 } } } });
  const opened: Products[] = [];
  const open = async () => {
    const products = new Products({
      root, now, trusted: (cwd) => trust.trusted(cwd), openUnder,
      append: async (kind, data, session) => { await append(kind, 1, data, undefined, session); },
      guard: (given) => addGuards(root, given, { deepHook: fileURLToPath(new URL('../../../target/debug/deep-hook', import.meta.url)), classes: {} }),
      build: async ({ cwd, command }) => {
        const lease = await heavy.wait({ cwd, command, jobs: 'none' }, { pid: process.pid, start: '' }, async () => undefined);
        expect(lease.status, 'fixture build has a real cpu.slot').toBe('granted');
        const run = `run:${ulid(now())}`;
        let tail = '';
        const output = (chunk: Buffer) => { tail = (tail + chunk.toString()).slice(-8000); };
        try {
          const started = await host.start({ run, cwd, argv: ['/bin/sh', '-c', command], grant: { run_as_you: true }, output: { stdout: output, stderr: output } });
          expect(started.status, 'the real supervisor starts the product command').toBe('started');
          const exit = await host.wait(run);
          return { code: exit.code, tail };
        } finally {
          await host.cleanup(run);
          await heavy.release({ ticket: lease.ticket, secret: lease.secret });
        }
      },
    });
    opened.push(products);
    await products.open();
    return products;
  };
  const events = () => record.read({ after: 0, limit: 10_000 });
  const build = async (products: Products) => {
    const before = (await events()).at(-1)?.log_pos ?? 0;
    await products.ensure(id, common, { session: 'product-session' });
    for (const until = Date.now() + 30_000; Date.now() < until;) {
      const terminal = (await events()).filter((e) => e.log_pos > before && (e.kind === 'product.built' || (e.kind === 'session.reading' && /failed:|exited |left no /.test(JSON.stringify(e.data)))));
      if (terminal.length) return terminal;
      await sleep(20);
    }
    throw Error('product build produced neither product.built nor a failure reading');
  };
  return {
    dir, root, repo, commit, record, open, build, events,
    advance: (ms: number) => { time += ms; },
    lowDisk: () => { disk.free = 1e9; expect(statfsSync(root).bavail * statfsSync(root).bsize).toBeLessThan(30e9); },
    index: () => existsSync(join(root, 'products.json')) ? JSON.parse(readFileSync(join(root, 'products.json'), 'utf8')) : { entries: [], placed: [] },
    worktree: async () => {
      const top = join(dir, 'worktree');
      git(dir, repo, 'worktree', 'add', '-q', '-b', 'working', top);
      await trust.answer({ writer: 'app', actor: 'you', scope: 'you' }, top, true);
      return top;
    },
    close: async () => { for (const p of opened) p.close(); await host.close(); await record.close(); rmSync(dir, { recursive: true, force: true }); },
  };
}
