// #31 AC12 #31.0c42ed7c: on a base with nothing to start, the surface a drafted check declares is built in the temporary base
// checkout from one fixed form per kind, and its hash is recorded. Real listening services through the real supervisor
// on leased ports, a real command and a real module, read as a check would reach them.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeclaredSurface, BaseCheckout, StandIn } from '../../../packages/gate/src/index.ts';
import { changed, makeRepo, mustFail, NODE, openWorld, repoState, SEEDED, type World } from './helpers.ts';

async function withWorld(body: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld();
  try { await body(w); } finally { await w.close(); }
}
const SHA = /^[0-9a-f]{64}$/;
const empty = (): string => makeRepo();
const url = (s: StandIn, path: string): string => `http://127.0.0.1:${String(s.port)}${path}`;
const only = (c: BaseCheckout, check: string): StandIn => {
  const found = c.standIns.filter((s: StandIn) => s.check === check);
  expect(found.length, `one stand-in for ${check}: ${JSON.stringify(c.standIns)}`).toBe(1);
  return found[0]!;
};
const reach = async (href: string, init?: RequestInit): Promise<{ status: number; type: string | null; body: string } | null> => {
  try {
    const res = await fetch(href, { ...init, signal: AbortSignal.timeout(10_000) });
    return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
  } catch {
    return null;
  }
};
const HEALTH: DeclaredSurface = { check: 'health', kind: 'service', routes: ['/health'], format: 'json' };
const HOME: DeclaredSurface = { check: 'home', kind: 'page', routes: ['/'] };
const ACME: DeclaredSurface = { check: 'acme', kind: 'command', name: 'acme export' };
const SVG: DeclaredSurface = { check: 'svg', kind: 'module', path: 'src/export.ts', exports: ['exportSvg'] };
const base = (service: Awaited<ReturnType<World['service']>>, repo: string, surfaces: DeclaredSurface[]): Promise<BaseCheckout> =>
  service.baseCheckout({ worktree: repo, onto: 'main', claim: 'HEAD', own: [], surfaces, runs: ['run:one'] });

describe('AC12 #31.0c42ed7c in an empty repo, a drafted check\'s declared surface gets a stand-in', () => {
  it('AC12 a JSON route: a service on a leased port, started through the supervisor, answers GET /health and POST /orders with 200 and {}', async () => {
    await withWorld(async (w) => {
      const repo = empty();
      const service = await w.service();
      const c = await base(service, repo, [HEALTH]);
      const s = only(c, 'health');
      expect(s.kind).toBe('service');
      expect(s.hash).toMatch(SHA);
      const held = await w.leases.leases();
      expect(held.filter((v) => v.lease.resource.kind === 'port').map((v) => v.lease.resource.key), 'its port is leased').toContain(String(s.port));
      expect((await w.sup.status(s.run!)).state, 'started through the supervisor').toBe('running');
      const get = await reach(url(s, '/health'));
      expect(get?.status).toBe(200);
      expect(JSON.parse(get!.body)).toEqual({});
      const post = await reach(url(s, '/orders'), { method: 'POST', body: '{"id":1}' });
      expect(post?.status).toBe(200);
      expect(JSON.parse(post!.body)).toEqual({});
      await service.ended(c, 'run:one');
      expect(await reach(url(s, '/health')), 'gone with the checkout').toBeNull();
      expect(existsSync(c.dir)).toBe(false);
    });
  }, 120_000);

  it('AC12 a page: a service that answers with an empty HTML document', async () => {
    await withWorld(async (w) => {
      const repo = empty();
      const service = await w.service();
      const c = await base(service, repo, [HOME]);
      const s = only(c, 'home');
      expect(s.hash).toMatch(SHA);
      const page = await reach(url(s, '/'));
      expect(page?.status).toBe(200);
      expect(page?.type).toMatch(/text\/html/);
      expect(page?.body).toMatch(/<html/i);
      expect(page!.body.replace(/<!doctype[^>]*>/i, '').replace(/<[^>]*>/g, '').trim(), 'nothing in it').toBe('');
      await service.ended(c, 'run:one');
      expect(await reach(url(s, '/')), 'gone with the checkout').toBeNull();
    });
  }, 120_000);

  it('AC12 the command `acme export`: a command that exits 0 with no output, only in the base checkout', async () => {
    await withWorld(async (w) => {
      const repo = empty();
      const before = repoState(repo);
      const service = await w.service();
      const c = await base(service, repo, [ACME]);
      const s = only(c, 'acme');
      expect(s.hash).toMatch(SHA);
      expect(s.bin!.startsWith(`${c.dir}/`), `in the checkout: ${String(s.bin)}`).toBe(true);
      const ran = spawnSync(s.bin!, ['export'], { cwd: c.dir, encoding: 'utf8' });
      expect(ran.status).toBe(0);
      expect(ran.stdout).toBe('');
      expect(ran.stderr).toBe('');
      expect(changed(before, repoState(repo)), 'nothing of it in your repo').toEqual([]);
      await service.ended(c, 'run:one');
      expect(existsSync(s.bin!), 'gone with the checkout').toBe(false);
    });
  }, 120_000);

  it('AC12 src/export.ts with the export exportSvg: a module there whose exportSvg() returns undefined, only in the base checkout', async () => {
    await withWorld(async (w) => {
      const repo = empty();
      const before = repoState(repo);
      const service = await w.service();
      const c = await base(service, repo, [SVG]);
      const s = only(c, 'svg');
      expect(s.hash).toMatch(SHA);
      const file = join(c.dir, 'src/export.ts');
      expect(existsSync(file)).toBe(true);
      const load = `const m = await import(${JSON.stringify(file)}); process.stdout.write(JSON.stringify({ type: typeof m.exportSvg, returned: String(m.exportSvg()) }));`;
      const ran = spawnSync(NODE, ['--input-type=module', '-e', load], { encoding: 'utf8' });
      expect(ran.status, ran.stderr).toBe(0);
      expect(JSON.parse(ran.stdout)).toEqual({ type: 'function', returned: 'undefined' });
      expect(existsSync(join(repo, 'src/export.ts')), 'not in your worktree').toBe(false);
      expect(changed(before, repoState(repo))).toEqual([]);
      await service.ended(c, 'run:one');
      expect(existsSync(file), 'gone with the checkout').toBe(false);
    });
  }, 120_000);

  it('AC12 each form is one fixed form: two builds of a command or a module record one hash, and two forms two hashes', async () => {
    await withWorld(async (w) => {
      const service = await w.service();
      const one = await base(service, empty(), [ACME, SVG]);
      const two = await base(service, empty(), [ACME, SVG]);
      expect(only(two, 'acme').hash).toBe(only(one, 'acme').hash);
      expect(only(two, 'svg').hash).toBe(only(one, 'svg').hash);
      expect(only(one, 'acme').hash).not.toBe(only(one, 'svg').hash);
    });
  }, 120_000);

  it('AC12 a surface with no fixed form gets none', async () => {
    await withWorld(async (w) => {
      const service = await w.service();
      const c = await base(service, empty(), [{ check: 'screen', kind: 'device-screen' }]);
      expect(c.standIns.map((s: StandIn) => s.check)).toEqual([]);
    });
  }, 120_000);
});

describe('AC12 #31.0c42ed7c in a repo whose app already starts, a check for a new route gets no stand-in', () => {
  const starts = (): string => makeRepo({ ...SEEDED, 'package.json': `${JSON.stringify({ name: 'shop', private: true, scripts: { start: 'node server.js' } })}\n`, 'server.js': 'process.exit(0);\n' });
  const NEW_ROUTE: DeclaredSurface = { check: 'new-route', kind: 'service', routes: ['/new'], format: 'json' };

  it('AC12 the check goes through the part\'s own entry point on the real base', async () => {
    await withWorld(async (w) => {
      const service = await w.service();
      const c = await base(service, starts(), [NEW_ROUTE]);
      expect(c.standIns.map((s: StandIn) => s.check), 'no stand-in').toEqual([]);
    });
  }, 120_000);

  it('AC12 (wrong program) a service that builds one there fails this test, naming the check', async () => {
    await withWorld(async (w) => {
      const service = await w.service({ plant: 'stands-in-always' });
      const c = await base(service, starts(), [NEW_ROUTE]);
      const built = c.standIns.map((s: StandIn) => s.check);
      await mustFail('stands-in-always', () => expect(built, 'no stand-in').toEqual([]), ['new-route']);
    });
  }, 120_000);
});
