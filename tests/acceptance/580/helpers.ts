// Test-side tools for #580's acceptance tests (README): the sample repo and its worktrees, `deep hub run` on a world of
// this suite's own, claims made by Claude Code sessions played through the real deep-hook, the record read back through
// the hub's socket, what the sample's own scripts logged, and Docker as `docker ps`, `docker inspect` and `psql` show it.
// Nothing here stands in for the hub, the gate runner, env-local, the supervisor or Docker. The #29 suite's hub helpers
// and the #965 suite's Session are imported, never copied, as #907's and #965's are.
//
// Safety: folders are under /tmp/dh580-*; HOME is a temp folder for the hub and every session; processes are stopped by
// PID only; Docker objects are removed only by the compose projects this test's own hub recorded, never by name or port.
// No model, no sign-in. Images needed: postgres:16, redis:7, busybox:1.36; a missing one is BLOCKED, naming it.

import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';
import { openRecord, ulid, type Connection } from '../../../packages/record/src/index.ts';
import { allEvents, alive, childEnv, CLI, DEEP_HOOK, DEFAULT_RULES, draftFor, NODE, own, REPO, req, SETTINGS, sleep, type Ev, type Hub, type Line, type World as World29 } from '../29/h-d.ts';
import { Clock, cleanup as cleanup965, Session, type StopSeen } from '../965/helpers.ts';

export { allEvents, sleep, Session, type Ev, type Hub, type Line, type StopSeen };

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
/** The journey on the sample app, and on the compose sample: each a drafted check at journey depth. */
export const J = '.deepbuild/checks/orders.sh';
export const CART_J = '.deepbuild/checks/cart.sh';
export const STEPS = ['services', 'install', 'migrate', 'seed'] as const;
export const IMAGES = ['postgres:16', 'redis:7', 'busybox:1.36'];
const HOUR = 3_600_000;

/** One reading of a planted program: the message a scenario throws, or null when it holds. BLOCKED is thrown on, never read as the plant's failure. */
export async function failureOf(scenario: () => unknown): Promise<string | null> {
  try {
    await scenario();
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('BLOCKED:')) throw error;
    return message;
  }
}
export const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');
/**
 * The digest of a set of files (README, Digests): `sha256:` and the SHA-256 of one line per file, `<path>\0<hex SHA-256 of
 * its bytes>\n`, sorted by path in byte order, each path relative to the folder.
 */
export function treeDigest(files: Record<string, string>): string {
  return `sha256:${sha256([...Object.keys(files)].sort((a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b)))).map((p) => `${p}\0${files[p]}\n`).join(''))}`;
}
/** Each file under the folders, by its path relative to `root`, with the hex SHA-256 of its bytes. */
export function hashed(root: string, ...paths: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (at: string): void => {
    if (statSync(at).isDirectory()) for (const name of readdirSync(at)) walk(join(at, name));
    else out[relative(root, at)] = sha256(readFileSync(at));
  };
  for (const p of paths) walk(join(root, p));
  return out;
}

// ---- Docker. Reads only; removal is by this hub's recorded projects (Bench.close).
export function docker(args: string[], timeoutMs = 60_000): { code: number | null; stdout: string; stderr: string } {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? String(r.error ?? '') };
}
/** Docker's reachability and the images the sample names. Nothing is pulled here: a missing image is BLOCKED, naming it. */
export function dockerReady(): void {
  const info = docker(['info', '--format', '{{.ServerVersion}}'], 30_000);
  if (info.code !== 0) throw Error(`BLOCKED: the Docker daemon is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] || `exit ${info.code}`}); the sample's stack needs it`);
  for (const image of IMAGES) if (docker(['image', 'inspect', image], 30_000).code !== 0) throw Error(`BLOCKED: the image ${image} isn't local; run docker pull ${image} once`);
}
/** The containers of the project's service, running or not. */
export const containers = (project: string, service?: string): string[] =>
  docker(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`, ...(service ? ['--filter', `label=com.docker.compose.service=${service}`] : [])]).stdout.split('\n').filter(Boolean);
export const volumes = (project: string): string[] => docker(['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`]).stdout.split('\n').filter(Boolean);
export const inspect = (id: string): Line => (JSON.parse(docker(['inspect', id]).stdout || '[{}]') as Line[])[0]!;
export const exists = (id: string): boolean => docker(['inspect', id]).code === 0;
export const volumeExists = (name: string): boolean => docker(['volume', 'inspect', name]).code === 0;
/** Runs SQL in the stack's `db` container with its own psql; rows as one string, or throws naming the failure. */
export function psql(db: string, database: string, sql: string): string {
  const r = docker(['exec', db, 'psql', '-U', 'postgres', '-d', database, '-Atc', sql]);
  if (r.code !== 0) throw Error(`psql in ${db} on ${database}: ${r.stderr.trim()}`);
  return r.stdout.trim();
}
export const databases = (db: string): string[] => psql(db, 'postgres', 'SELECT datname FROM pg_database').split('\n').filter(Boolean);
export const nameOf = (url: string): string => new URL(url).pathname.slice(1);

// ---- The sample repo.
export interface Options {
  /** host: `compose` holds the services and `up` starts the app. web: the compose sample, where `web` is built from the repo. */
  variant?: 'host' | 'web';
  plant?: string;
  /** The world's `stack.slot` pool (`stack: { slot: n }` in config.json). */
  slot?: number;
  /** Megabytes the seed pads the database with. */
  seedMb?: number;
  /** done.yaml's `environment.products`, and an `origin` the default branch is fetched from (AC4). */
  products?: boolean;
  /** The sample's worktrees besides its main checkout; each session's claims are named by its worktree. */
  worktrees?: string[];
  /** Questions the planted sorter answers "proceed" (DEEP_HUB_TEST_SORTER, #321). */
  proceed?: string[];
}
const QUOTED = (s: string): string => JSON.stringify(s);
function doneYaml(o: Options): string {
  const web = o.variant === 'web';
  return [
    'environment:',
    '  compose: docker-compose.yml',
    ...(web ? [] : [`  up: ${QUOTED('node src/server.mjs')}`]),
    '  ports: [web, db, redis]',
    `  ready: { http: ${QUOTED('http://127.0.0.1:${web}/health')}, within: 120 }`,
    '  install: "npm ci"',
    '  migrate: "npm run db:migrate"',
    '  seed: { run: "npm run db:seed", database: DATABASE_URL }',
    '  caches: [.next/cache]',
    ...(o.products ? ['  products:', '    - { name: node_modules, path: node_modules, key: [package-lock.json], key_values: [], build: "npm ci" }'] : []),
    '',
  ].join('\n');
}
const packageJson = (version: string): string => `${JSON.stringify({
  name: 'shop', version: '1.0.0', private: true, type: 'module',
  scripts: { postinstall: 'node scripts/step.mjs install', 'db:migrate': 'node scripts/migrate.mjs', 'db:seed': 'node scripts/seed.mjs' },
  dependencies: { 'dh-wire': `file:vendor/dh-wire-${version}.tgz` },
}, null, 2)}\n`;
const g = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
  cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dirname(cwd), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const npm = (cwd: string, ...args: string[]): string => execFileSync('npm', args, { cwd, encoding: 'utf8', env: { PATH: `${dirname(NODE)}:${process.env.PATH}`, HOME: dirname(cwd), npm_config_cache: join(dirname(cwd), 'npm-cache') }, stdio: ['ignore', 'pipe', 'pipe'] });
/** `dh-wire` at the version, as a tarball the repo keeps: its `npm ci` reads no registry. */
function packWire(tmp: string, vendor: string, version: string): void {
  const dir = join(tmp, `wire-${version}`);
  cpSync(join(FIXTURES, 'wire'), dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Line;
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...manifest, version }));
  npm(dir, 'pack', '--pack-destination', vendor, '--silent');
}
/** package-lock.json for `dh-wire` at the version, resolved offline in a folder of its own. */
function lockFor(tmp: string, repo: string, version: string): string {
  const dir = join(tmp, `lock-${version}`);
  mkdirSync(join(dir, 'vendor'), { recursive: true });
  cpSync(join(repo, 'vendor'), join(dir, 'vendor'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), packageJson(version));
  writeFileSync(join(dir, '.npmrc'), readFileSync(join(FIXTURES, 'sample/.npmrc')));
  npm(dir, 'install', '--package-lock-only', '--ignore-scripts', '--silent');
  return readFileSync(join(dir, 'package-lock.json'), 'utf8');
}

export interface World extends World29 { obs: string; lock101: string; options: Options; tasks: Map<string, number> }
const TEXT = (where: string, n: number): string => `make the cart total round each line to cents, change ${n} in ${where}`;
const made: string[] = [];
function makeWorld(o: Options): World {
  const tmp = realpathSync(mkdtempSync('/tmp/dh580-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  const obs = join(tmp, 'obs');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(obs);
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS, ...(o.slot ? { stack: { slot: o.slot } } : {}) }, null, 2)}\n`);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const repo = join(tmp, 'repo');
  cpSync(join(FIXTURES, 'sample'), repo, { recursive: true });
  mkdirSync(join(repo, '.deepbuild/checks'), { recursive: true });
  for (const [from, to] of [['checks/orders.test.mjs', '.deepbuild/checks/orders.test.mjs'], ['checks/cart.test.mjs', '.deepbuild/checks/cart.test.mjs']] as const) {
    cpSync(join(repo, from), join(repo, to));
  }
  rmSync(join(repo, 'checks'), { recursive: true });
  for (const name of ['orders', 'cart']) {
    writeFileSync(join(repo, `.deepbuild/checks/${name}.sh`), `#!/bin/sh\nnode --test .deepbuild/checks/${name}.test.mjs\n`);
    chmodSync(join(repo, `.deepbuild/checks/${name}.sh`), 0o755);
  }
  cpSync(join(repo, o.variant === 'web' ? 'docker-compose.web.yml' : 'docker-compose.host.yml'), join(repo, 'docker-compose.yml'));
  rmSync(join(repo, 'docker-compose.web.yml'));
  rmSync(join(repo, 'docker-compose.host.yml'));
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.next/\n');
  writeFileSync(join(repo, '.dockerignore'), '*\n!src\n!Dockerfile\n');
  writeFileSync(join(repo, '.npmrc'), readFileSync(join(FIXTURES, 'sample/.npmrc')));
  writeFileSync(join(repo, '.deepbuild/done.yaml'), doneYaml(o));
  writeFileSync(join(repo, 'obs.json'), JSON.stringify({ dir: obs, name: 'main', seed_mb: o.seedMb ?? 0 }));
  mkdirSync(join(repo, 'vendor'));
  packWire(tmp, join(repo, 'vendor'), '1.0.0');
  packWire(tmp, join(repo, 'vendor'), '1.0.1');
  writeFileSync(join(repo, 'package.json'), packageJson('1.0.0'));
  writeFileSync(join(repo, 'package-lock.json'), lockFor(tmp, repo, '1.0.0'));
  const lock101 = lockFor(tmp, repo, '1.0.1');
  g(repo, 'init', '-q', '-b', 'main');
  g(repo, 'add', '-A');
  g(repo, 'commit', '-qm', 'the sample app');
  const base = g(repo, 'rev-parse', 'HEAD');
  if (o.products) {
    const bare = join(tmp, 'repo.git');
    g(tmp, 'init', '-q', '--bare', '-b', 'main', bare);
    g(repo, 'remote', 'add', 'origin', bare);
    g(repo, 'push', '-q', '-u', 'origin', 'main');
    g(repo, 'fetch', '-q', 'origin');
    g(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    // Trusted as the base reads trust, or the store builds nothing (#1017).
    writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [realpathSync(repo)]: { hasTrustDialogAccepted: true } } }));
  }
  for (const name of o.worktrees ?? []) {
    const path = join(tmp, name);
    g(repo, 'worktree', 'add', '-q', '-b', name, path);
    writeFileSync(join(path, 'obs.json'), JSON.stringify({ dir: obs, name, seed_mb: o.seedMb ?? 0 }));
    g(path, 'add', '-A');
    g(path, 'commit', '-qm', `the ${name} worktree's observer`);
  }
  // A draft for each ask a session types: one requirement, at journey depth, checked by the journey.
  const check = o.variant === 'web' ? CART_J : J;
  const where = ['main', ...(o.worktrees ?? [])];
  const drafts = where.flatMap((w) => Array.from({ length: 10 }, (_, n) => draftFor(TEXT(w, n + 1), {
    requirements: [req('R1', 'a customer sees the order they placed', { check, on_base: 'passes', depth: 'journey' })], deliverables: ['src/cart.ts'],
  })));
  writeFileSync(join(tmp, 'drafts.json'), `${JSON.stringify({ drafts }, null, 2)}\n`);
  writeFileSync(join(tmp, 'work.json'), `${JSON.stringify({ readings: [] })}\n`);
  return {
    tmp, home, root, repo: realpathSync(repo), confirm: join(tmp, 'confirm'), drafts: join(tmp, 'drafts.json'), work: join(tmp, 'work.json'), base,
    obs, lock101, options: o, tasks: new Map(),
  };
}
/** Five clean runs of the journey a day ago at 300 s, so the gate runner expects that and sends it to the slow lane. */
async function seedRuns(ledger: string, check: string, ms = 300_000): Promise<void> {
  const core: Connection = { writer: 'core', actor: 'you', scope: 'you' };
  const record = await openRecord({ path: ledger, now: Date.now });
  try {
    let t = Date.now() - 24 * HOUR;
    for (let i = 0; i < 5; i++) {
      t += ms + 60_000 + Math.floor(Math.random() * 1000);
      const run = `run:${ulid(t)}`;
      await record.append(core, { v: 1, id: ulid(t), kind: 'run.started', ts: t, subject: run, data: { run, check, claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', commit: 'a'.repeat(40) } });
      await record.append(core, {
        v: 1, id: ulid(t + ms), kind: 'run.finished', ts: t + ms, subject: run,
        data: { run, outcome: 'passed', tests_run: 1, passed: 1, runs: 1, evidence: [], check, assertion: null, expected: null, actual: null, step: null, points_to: null, findings: [], environment: 'test' },
      });
    }
  } finally {
    await record.close();
  }
}

/** `deep hub run` on the world: 12 cores in the check-slot sum, so `stack.slot` alone decides who waits. A hub that doesn't start (a plant the base doesn't list) is BLOCKED. */
async function startHub(w: World): Promise<Hub> {
  const sorter = join(w.tmp, 'sorter.json');
  if (w.options.proceed) writeFileSync(sorter, JSON.stringify({ rule: 'planted-proceed-580', proceed: w.options.proceed }));
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_PLANT: w.options.plant,
    DEEP_HUB_TEST_CORES: '12', DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9', DEEP_HUB_TEST_SORTER: w.options.proceed ? sorter : undefined,
  });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) { try { resolve(JSON.parse(out.split('\n')[0]!) as Line); } catch { resolve(undefined); } }
      });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub${w.options.plant ? ` with the plant DEEP_HUB_PLANT=${w.options.plant}` : ''} did not start: ${err.slice(-800)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: undefined, plant: w.options.plant, stderr: () => err };
}

export interface AppStart { name: string; pid: number; cwd: string; database: string; web: string; version: string; linked: boolean; next_before: Record<string, string>; cart: string }
export interface Report { name: string; cwd: string; step: string; orders?: number; visits?: number; seeded?: string | null; count?: number; reached?: string; port?: number }
export const lines = <T>(path: string): T[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : []);

/** A claim on its way: the stop's reply, and readers for its run. */
export interface Pending { s: Session; since: number; stop: StopSeen; claim: string; run: string; check: string }
export interface Step { step: string; status: 'ran' | 'reused'; key: string | null; ms: number; product?: { name: string; key: string } }
export interface Served {
  run: string; stack: string; project: string; checkout: string; ports: Record<string, number>; ready_ms: number; steps: Step[];
  caches: { path: string; digest: string }[]; images: { service: string; image: string; context_digest: string; built: boolean }[]; mounts: { service: string; source: string; target: string }[];
}
export const stepOf = (s: Served, step: string): Step => {
  const found = s.steps.find((x) => x.step === step);
  if (!found) throw Error(`${s.run}'s stack.served names no step ${step}: ${JSON.stringify(s.steps)}`);
  return found;
};

/** One sample, its hub, its sessions, and everything they left, removed by what this hub recorded. */
export class Bench {
  private readonly projects = new Set<string>();
  private readonly helpers = new Set<number>();
  private readonly clock: Clock;
  private constructor(readonly w: World, readonly hub: Hub) { this.clock = new Clock(hub); }
  static async open(o: Options = {}): Promise<Bench> {
    for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build --locked -p deep-hook)', DEEP_HOOK]] as const) {
      if (!existsSync(path)) throw Error(`BLOCKED: ${what} is not built at ${path}`);
    }
    dockerReady();
    const w = makeWorld(o);
    try {
      await seedRuns(join(w.root, 'ledger.db'), o.variant === 'web' ? CART_J : J);
      return new Bench(w, await startHub(w));
    } catch (error) {
      await cleanup965();
      for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }
  /** Removes what the hub's stacks left, by their recorded projects; stops the hub; removes the folders. */
  async close(): Promise<void> {
    const events = await this.events().catch(() => [] as Ev[]);
    for (const e of events) if (e.kind === 'stack.served' && typeof e.data.project === 'string') this.projects.add(e.data.project);
    try { process.kill(this.hub.pid, 'SIGTERM'); } catch { /* gone */ }
    const deadline = Date.now() + 60_000;
    while (alive(this.hub.pid) && Date.now() < deadline) await sleep(100);
    if (alive(this.hub.pid)) try { process.kill(this.hub.pid, 'SIGKILL'); } catch { /* gone */ }
    for (const pid of this.helpers) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
    for (const p of this.projects) {
      const ids = containers(p);
      // A project key is the hub's lease, free again once its stack went: another hub on this machine may hold it now.
      if (ids.some((id) => !JSON.stringify(inspect(id)).includes(this.w.tmp))) continue;
      if (ids.length) docker(['rm', '-f', ...ids], 120_000);
      const left = volumes(p);
      if (left.length) docker(['volume', 'rm', '-f', ...left], 120_000);
      const images = docker(['images', '-q', '--filter', `label=com.docker.compose.project=${p}`]).stdout.split('\n').filter(Boolean);
      if (images.length) docker(['rmi', '-f', ...new Set(images)], 120_000);
      docker(['network', 'rm', `${p}_default`]);
    }
    await cleanup965();
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  }
  events(): Promise<Ev[]> { return allEvents(this.hub); }
  /** A session in the worktree (or the main checkout), started. */
  async session(where = 'main'): Promise<Session> {
    const repo = where === 'main' ? this.w.repo : realpathSync(join(this.w.tmp, where));
    const s = new Session({ ...this.w, repo }, this.clock);
    this.names.set(s, where);
    await s.start();
    return s;
  }
  private readonly names = new Map<Session, string>();
  whereOf(s: Session): string { return this.names.get(s)!; }
  /** A helper process this suite started and stops by PID. */
  ownHelper(pid: number): void { this.helpers.add(pid); }
  hold(where: string): void { writeFileSync(join(this.w.obs, `hold-${where}`), ''); }
  release(where: string): void { rmSync(join(this.w.obs, `hold-${where}`), { force: true }); }
  target(where: string, value: Line): void { writeFileSync(join(this.w.obs, `target-${where}.json`), JSON.stringify(value)); }
  /** You type the next change's ask, and its task's definition locks. */
  async ask(s: Session): Promise<void> {
    const where = this.whereOf(s);
    const n = (this.w.tasks.get(where) ?? 0) + 1;
    this.w.tasks.set(where, n);
    const text = TEXT(where, n);
    const since = await this.pos();
    await s.typed(text);
    await this.until(async () => {
      const e = await this.events();
      const ask = e.find((x) => x.log_pos > since && x.kind === 'user.ask' && x.session === s.id && x.data.text === text);
      const ref = Array.isArray(ask?.data.tasks) && ask!.data.tasks.length === 1 ? String(ask!.data.tasks[0]) : undefined;
      return ref !== undefined && e.some((x) => x.kind === 'definition.locked' && x.data.task_ref === ref);
    }, 180_000, `the ask "${text}" to open a task with a locked definition`);
  }
  async pos(): Promise<number> { return (await this.events()).reduce((a, e) => Math.max(a, e.log_pos), 0); }
  async until<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, ms: number, what: string): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = await probe();
      if (v !== undefined && v !== false) return v;
      if (Date.now() > deadline) throw Error(`timed out after ${ms} ms waiting for ${what}; the hub (pid ${this.hub.pid}) ${alive(this.hub.pid) ? 'runs' : 'has exited'}, its stderr ends ${JSON.stringify(this.hub.stderr().slice(-400))}`);
      await sleep(150);
    }
  }
  /** The agent's turn: an ask, its edit of src/cart.ts (and whatever `change` adds), and a stop whose reply ends the turn. */
  async claim(s: Session, o: { change?: () => Promise<void> } = {}): Promise<Pending> {
    await this.ask(s);
    const since = await this.pos();
    await s.editCart(since);
    await o.change?.();
    const stop = await s.stop('Done.');
    return this.running(s, since, stop);
  }
  /** The run of the session's journey that started after `since`. */
  async running(s: Session, since: number, stop: StopSeen): Promise<Pending> {
    const check = this.w.options.variant === 'web' ? CART_J : J;
    const found = await this.until(async () => {
      const e = await this.events();
      const claims = new Set(e.filter((x) => x.kind === 'claim.made' && x.session === s.id && x.log_pos > since).map((x) => `claim:${x.id}`));
      return e.find((x) => x.kind === 'run.started' && x.log_pos > since && x.data.check === check && claims.has(String(x.data.claim)));
    }, 120_000, `the journey's run in ${this.whereOf(s)}`);
    return { s, since, stop, claim: String(found.data.claim), run: String(found.data.run), check };
  }
  /** The run's stack.served, once the stack is ready; a run that ends with none fails, naming what the record holds. */
  async served(p: Pending, ms = 420_000): Promise<Served> {
    return this.until(async () => {
      const e = await this.events();
      const served = e.find((x) => x.kind === 'stack.served' && x.data.run === p.run);
      if (served) { this.projects.add(String(served.data.project)); return served.data as unknown as Served; }
      const done = e.find((x) => x.kind === 'run.finished' && x.data.run === p.run);
      if (done) throw Error(`${p.run} (${this.whereOf(p.s)}) ended ${String(done.data.outcome)} with no stack.served event: the stack's record is missing (findings: ${JSON.stringify(done.data.findings).slice(0, 500)})`);
      return undefined;
    }, ms, `stack.served for ${p.run}`);
  }
  async finished(p: Pending, ms = 420_000): Promise<Line> {
    const e = await this.until(async () => (await this.events()).find((x) => x.kind === 'run.finished' && x.data.run === p.run), ms, `run.finished for ${p.run}`);
    return e.data;
  }
  /** One claim to its end: its stack's record, its finish, the app it started and the journey's reports. */
  async whole(s: Session, o: { change?: () => Promise<void> } = {}): Promise<Done> {
    const p = await this.claim(s, o);
    const served = await this.served(p);
    const finished = await this.finished(p);
    return { ...p, served, finished, app: this.appOf(served), start: this.report(served, 'start'), end: this.report(served, 'end') };
  }
  appOf(served: Served): AppStart | undefined { return lines<AppStart>(join(this.w.obs, 'app.jsonl')).find((a) => a.cwd === served.checkout); }
  apps(): AppStart[] { return lines<AppStart>(join(this.w.obs, 'app.jsonl')); }
  report(served: Served, step: string): Report | undefined { return lines<Report>(join(this.w.obs, 'journey.jsonl')).find((r) => r.cwd === served.checkout && r.step === step); }
  /** The start steps that really ran, as the sample's own scripts logged them. */
  stepLog(): { step: string; name: string; cwd: string; database: string | null; at: number }[] { return lines(join(this.w.obs, 'steps.jsonl')); }
  /** The store's kept entries of a product, by folder name. */
  kept(product: string): string[] {
    const store = join(this.w.root, 'products');
    if (!existsSync(store)) return [];
    return readdirSync(store, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).flatMap((d) => readdirSync(join(store, d.name)).filter((n) => n.startsWith(`${product}@`)));
  }
}
export interface Done extends Pending { served: Served; finished: Line; app: AppStart | undefined; start: Report | undefined; end: Report | undefined }

/** The findings on a run that begin with the slot's name: the environment failed `environment@1` (README, The record). */
export const environmentFailures = (finished: Line): string[] => ((finished.findings ?? []) as string[]).filter((f) => f.includes('environment@1'));
export const passed = (d: Done): void => {
  expect(environmentFailures(d.finished), `${d.run} failed environment@1`).toEqual([]);
  expect(d.finished.outcome, `${d.run} passed (${JSON.stringify(d.finished.findings).slice(0, 600)})`).toBe('passed');
};
/** The leases on the port as the record holds them. */
export const portLease = (events: readonly Ev[], kind: 'lease.acquired' | 'lease.released', port: number): Ev[] =>
  events.filter((e) => e.kind === kind && e.data?.resource?.kind === 'port' && e.data.resource.key === String(port));

export const shownLoad = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;
export const loaded = (): boolean => loadavg()[0]! > availableParallelism();
/** Whether this is a reference Mac by model, chip and memory. No gating on mains power or a quiet machine (the owner's rule). */
export function referenceMac(): string | null {
  const read = (...args: string[]): string => execFileSync('sysctl', ['-n', ...args], { encoding: 'utf8' }).trim();
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const model = read('hw.model');
  return ['Mac15,7', 'Mac15,12'].includes(model) ? null : `not a reference Mac: ${model}`;
}
/**
 * A budget's reading. Within the limit on every run: PASS (load only slows a reading). Over it on a loaded machine, or off
 * a reference Mac, it can't be judged: INCONCLUSIVE, a skip that names the reading, never a pass. Over it on every run
 * by more than the margin on a fit machine: FAIL. Anything else: INCONCLUSIVE.
 */
export type Judged = { budget: string; result: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
export function judge(budget: string, runs: number[], limit: number): Judged {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${budget}: ${runs.map((r) => r.toFixed(0)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%, ${shownLoad()})`;
  console.log(shown);
  if (runs.length === 0) return { budget, result: 'INCONCLUSIVE', shown: `${budget}: no reading` };
  if (runs.every((r) => r <= limit)) return { budget, result: 'PASS', shown };
  const unfit = referenceMac() ?? (loaded() ? `loaded: ${shownLoad()}` : null);
  if (unfit) return { budget, result: 'INCONCLUSIVE', shown: `${shown}; ${unfit}` };
  return { budget, result: runs.every((r) => r > limit * (1 + margin)) ? 'FAIL' : 'INCONCLUSIVE', shown };
}
export function verdictOf(ctx: TestContext, results: Judged[]): void {
  const failed = results.filter((r) => r.result === 'FAIL');
  expect(failed.map((r) => r.shown), 'each budget holds').toEqual([]);
  const open = results.filter((r) => r.result === 'INCONCLUSIVE');
  if (open.length) ctx.skip(`INCONCLUSIVE ${open.map((r) => r.shown).join(' | ')}`);
}
