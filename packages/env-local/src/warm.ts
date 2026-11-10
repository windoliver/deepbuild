// A check's warm stack (#580; design: Start steps, Warm stacks). A check that needs the app starts its stack in steps:
// the services, install, migrate, seed, then the app and its health check. Each step but the app keeps its product,
// keyed by a digest of its inputs and the keys before it, so a run whose keys hold starts only what is the run's own: its
// database cloned from the seed's template, its other services on volumes copied from the template, and its app from
// its checkout. Between runs the stack keeps its images, its running database service with its templates, and its
// leases. Everything runs through host@1: the supervisor tracks each step, and the stack's own shell holds its leases.
import { createHash } from 'node:crypto';
import { constants, cpSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Grant, Host } from '@deepbuild/supervisor';
import { parse } from 'yaml';
import {
  composeRefusal, composed, daemon, dockerEnv, downStack, get, isObj, newRun, quote, readEnvironment, seedRecordAt, sleep, stackValues, step,
  type Environment, type SeedRecord, type Take,
} from './stack.js';

/** A folder an install leaves in the checkout: each is kept in the repo's one product store (#1017). */
const DEPENDENCIES = ['node_modules', '.venv'];
const MANIFEST = /^(package(-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb|Cargo\.(lock|toml)|requirements[^/]*\.txt|poetry\.lock|uv\.lock|pyproject\.toml|Gemfile(\.lock)?|go\.(mod|sum))$/;
const DOCKERFILE = /(^|\.)Dockerfile(\.|$)/i;
/** What never is a step's input: dependencies, build output, the repo's objects, and DeepBuild's own folder. */
const NO_INPUT = new Set(['.git', '.deepbuild', '.next', 'target', 'dist', 'build', ...DEPENDENCIES]);
/** How long an install or a build may run. */
const BUILD_MS = 30 * 60_000;
/** Templates and installs kept per stack, by key: the two most recently used. */
const KEPT = 2;
const POSTGRES = /^(.*\/)?postgres(:|@|$)/;

export interface Keys { services: string; install: string; migrate: string; seed: string }
/** The product store as a warm stack sees it (#1017): the hub's, one per repo. Installs and caches are never kept anywhere else. */
export interface WarmProducts {
  /** The products done.yaml lists among the dependency folders, each with the key the folder's files make. */
  declared(folder: string, paths: readonly string[]): Promise<{ name: string; path: string; key: string }[]>;
  holds(worktree: string, name: string, key: string): Promise<boolean>;
  /** Clones the entry to `dst` copy-on-write; why it couldn't, or nothing. */
  place(worktree: string, name: string, key: string, dst: string): Promise<string | undefined>;
  keep(worktree: string, name: string, path: string, key: string, src: string): Promise<void>;
  /** Clones the cache the last run on this install key left to `dst`; whether there was one. */
  placeCache(worktree: string, key: string, path: string, dst: string): Promise<boolean>;
  keepCache(worktree: string, key: string, path: string, src: string): Promise<void>;
}
export interface WarmStep { step: 'services' | 'install' | 'migrate' | 'seed' | 'clone' | 'app'; status: 'ran' | 'reused'; key: string | null; ms: number; product?: { name: string; key: string } }
/** What the core judges a run's environment by, as @deepbuild/gate's `environmentFindings` takes it. */
export interface RunFacts { install?: { key: string; placed: string }; database?: string; services: { name: string; volumes: string[] }[] }
export interface Serving {
  /** The run's `stack.served`, but for its run handle. */
  served: {
    stack: string; project?: string; checkout: string; ports: Record<string, number>; ready_ms: number; steps: WarmStep[]; caches: { path: string; digest: string }[];
    images: { service: string; image: string; context_digest: string; built: boolean }[]; mounts: { service: string; source: string; target: string }[];
  };
  /** What the check is handed: each port by name, and its database. */
  env: Record<string, string>;
  hosts: string[];
  /** The app's own process, when `up` starts one, and the ports it alone listens on. */
  app?: string;
  appPorts: number[];
  seed?: SeedRecord;
  facts: RunFacts;
  /** Each image's build context, by its absolute path, as the checkout's files digest it. */
  digests: Record<string, string>;
}
type Container = { name: string; binds: string[]; image?: { name: string; built_from: { context: string; digest: string } | null } };
interface Service { image?: string; build?: { context: string; dockerfile?: string }; environment?: Record<string, string | null>; ports?: { published?: string | number; target?: number; host_ip?: string }[]; volumes?: { type?: string; source?: string; target?: string }[]; labels?: Record<string, string> }
interface Config { name?: string; services?: Record<string, Service>; volumes?: Record<string, unknown> }
/** A service's named volumes, as `<source>` in its compose file and the Docker volume a phase runs it on. */
type Volumes = (source: string) => string;

const hex = (...parts: (string | Buffer)[]): string => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p).update('\0');
  return h.digest('hex');
};
const SHORT = 12;
const wordOf = (run: string): string => run.replace(/^run:/, '').toLowerCase().slice(-16);

/** Every file under `folder`, relative to it, skipping what `skip` names; in byte order. */
async function walk(folder: string, skip: (path: string, dir: boolean) => boolean): Promise<string[]> {
  const out: string[] = [];
  const into = async (at: string): Promise<void> => {
    for (const e of await readdir(join(folder, at), { withFileTypes: true })) {
      const path = at ? `${at}/${e.name}` : e.name;
      if (skip(path, e.isDirectory())) continue;
      if (e.isDirectory()) await into(path);
      else if (e.isFile()) out.push(path);
    }
  };
  await into('');
  // Each path's bytes are made once: encoding both sides inside the comparison made two buffers per comparison.
  return out.map((path) => ({ path, bytes: Buffer.from(path) })).sort((a, b) => Buffer.compare(a.bytes, b.bytes)).map((entry) => entry.path);
}
const filesDigest = async (folder: string, files: string[]): Promise<string> => {
  const h = createHash('sha256');
  for (const f of files) h.update(`${f}\0${createHash('sha256').update(await readFile(join(folder, f))).digest('hex')}\n`);
  return `sha256:${h.digest('hex')}`;
};
/** The digest of a folder's files: `sha256:` over one line per file, its path and the SHA-256 of its bytes, in byte order. */
const treeDigest = async (folder: string): Promise<string> => filesDigest(folder, await walk(folder, () => false));

/** `.dockerignore` as a filter: patterns in order, the last that matches a path or a folder above it decides. */
function ignored(context: string): (path: string, dir: boolean) => boolean {
  let text = '';
  try { text = readFileSync(join(context, '.dockerignore'), 'utf8'); } catch { /* none */ }
  const rules = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((line) => {
    const not = line.startsWith('!');
    const raw = (not ? line.slice(1) : line).replace(/^\.?\/+/, '').replace(/\/+$/, '');
    const body = raw.split(/(\*\*\/?|\*|\?)/).map((part) => (part === '*' ? '[^/]*' : part === '?' ? '[^/]' : part === '**' ? '.*' : part === '**/' ? '(.*/)?' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('');
    return { not, raw, re: new RegExp(`^${body}(/|$)`) };
  });
  const out = (path: string): boolean => rules.reduce((is, r) => (r.re.test(path) ? !r.not : is), false);
  // A folder is walked when a pattern lets something back in below it.
  return (path, dir) => (path === '.git' || path.endsWith('/.git')) || (out(path) && (!dir || !rules.some((r) => r.not && r.raw.startsWith(`${path}/`))));
}

/** Whether the folder's done.yaml has an environment block. */
export function environmentOf(folder: string): boolean {
  try { return isObj((parse(readFileSync(join(folder, '.deepbuild', 'done.yaml'), 'utf8')) as { environment?: unknown } | null)?.environment); } catch { return false; }
}

/**
 * Each start step's key in the folder: a digest of the paths it declares, the commands and variables it passes, the
 * names and sources of the credentials it loads, and the keys of the steps before it. A step declares its paths by
 * what they are: the compose file and every Dockerfile, the lockfiles and package manifests, what is named for
 * migrations and what for the seed. The platform records no reads of a plain command, so what a step read and named no
 * way in isn't a key's input.
 */
export async function keysOf(folder: string): Promise<Keys> {
  const env = readEnvironment(folder);
  const files = await walk(folder, (path) => NO_INPUT.has(basename(path)));
  const of = (match: (f: string) => boolean): Promise<string> => filesDigest(folder, files.filter(match));
  const credentials = JSON.stringify(env.credentials.map((c) => [c.env, c.source]));
  const services = hex('services', env.compose ?? '', env.ports.join(','), credentials, await of((f) => f === env.compose || DOCKERFILE.test(basename(f))));
  const install = hex('install', services, env.install ?? '', await of((f) => MANIFEST.test(basename(f))));
  const migrate = hex('migrate', install, env.migrate ?? '', await of((f) => /migrat/i.test(f)));
  const seed = hex('seed', migrate, env.seed?.run ?? '', env.seed?.database ?? '', await of((f) => /seed/i.test(f)));
  return { services, install, migrate, seed };
}

interface WarmOptions {
  host: Host;
  /** The hub's folder for its stacks, and the Docker CLI it found. */
  compose: { dir: string; docker?: string | undefined };
  products: WarmProducts;
  /** Leases each per-session key the environment names. */
  take: Take;
  scrub: (values: string[]) => void;
  plant?: string | undefined;
}

export class WarmStack {
  /** The stack's own run: the shell that holds its leases, and the token its services carry. */
  readonly id = newRun();
  /** Its services' key: a change to it tears the whole stack down. */
  servicesKey: string | undefined;
  project: string | undefined;
  ports: Record<string, number> = {};
  private opened = false;
  /** The hub's folder for this stack, which no run writes: the files compose runs. */
  private readonly dir: string;
  /** A folder of its own a run may write: a file database and the seed's record. */
  private readonly data: string;
  private db: { service: string; container: string; user: string; port: number; url: string; base: string } | undefined;
  private readonly migrated: string[] = [];
  private readonly seeded: { key: string; name: string; record: Omit<SeedRecord, 'template' | 'cloned_at'> }[] = [];
  private readonly serving = new Map<string, { folder: string; worktree: string; install: string; caches: string[]; compose?: string; others: string[]; volumes: string[]; clone?: string }>();
  private installed: { key: string; names: { name: string; path: string; key: string }[] } | undefined;
  private images: string[] = [];
  /** The keys of the last run's steps, which say what the next run will have to run. */
  last: Keys | undefined;
  /** The planted wrong programs' kept run: its database, and the file its services run from. */
  private held: { clone?: string; started?: boolean; volume?: Record<string, string> } = {};

  constructor(private readonly o: WarmOptions) {
    mkdirSync(join(o.compose.dir, 'warm'), { recursive: true });
    this.dir = realpathSync(mkdtempSync(join(o.compose.dir, 'warm', 'stack-')));
    this.data = realpathSync(mkdtempSync(join(tmpdir(), 'deep-warm-')));
  }

  /** Each per-session key, leased once: the stack holds it across its runs. */
  private readonly held_keys = new Map<string, string>();
  private readonly keyed: Take = async (kind, keys) => {
    const id = `${kind}\0${keys.join('\0')}`;
    const have = this.held_keys.get(id);
    if (have) return { key: have };
    const got = await this.o.take(kind, keys);
    if ('key' in got) this.held_keys.set(id, got.key);
    return got;
  };
  private get docker(): string { return this.o.compose.docker ?? ''; }
  /** One shell script with the Docker CLI as $0, through the host, on the daemon's socket alone; its arguments after. */
  private async dock(script: string, args: string[] = [], ms?: number, env: Record<string, string> = {}, cwd = this.dir): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const reached = daemon(this.docker);
    const grant: Grant = { run_as_you: true, sockets: 'socket' in reached ? reached.socket : [], hosts: Object.values(this.ports).map((p) => `127.0.0.1:${p}`) };
    return step(this.o.host, ['/bin/sh', '-c', script, this.docker, ...args], cwd, { ...dockerEnv(this.docker, this.o.compose.dir), ...env }, { grant, inherit: false, ...(ms ? { ms } : {}) });
  }
  private compose(file: string, rest: string): string { return `"$0" compose -p ${quote(this.project!)} -f ${quote(file)} ${rest}`; }

  /** Starts the stack's shell on its leases. */
  async open(folder: string): Promise<string | undefined> {
    const env = readEnvironment(folder);
    if (env.compose !== undefined) {
      if (!this.docker) return 'the hub found no Docker CLI with its compose plugin when it started, so no compose stack can run';
      const reached = daemon(this.docker);
      if ('why' in reached) return `${reached.why}, so no compose stack can run`;
    }
    const leases = [...env.ports.map((name) => ({ kind: 'port', env: name })), ...(env.compose !== undefined ? [{ kind: 'compose', env: 'DEEP_COMPOSE_PROJECT' }] : [])];
    const started = await this.o.host.start({ run: this.id, argv: ['/bin/sh', '-c', 'while :; do sleep 3600; done', this.id], cwd: this.dir, grant: { run_as_you: true }, ...(leases.length ? { leases } : {}) });
    if (started.status === 'BLOCKED') return `no ${started.kind} is free to lease`;
    this.project = started.leases.find((l) => l.kind === 'compose')?.key;
    const ports = started.leases.filter((l) => l.kind === 'port');
    this.ports = Object.fromEntries(env.ports.map((name, i) => [name, Number(ports[i]!.key)]));
    // Its removal is the compose kind's, once the shell has gone.
    composed.set(this.id, { work: this.data, judged: this.dir });
    return undefined;
  }

  /** The compose file as this run's checkout resolves it, on the stack's ports and project; why it may not run, or nothing. */
  private async resolve(env: Environment, folder: string): Promise<Config | string> {
    const ports = Object.fromEntries(Object.entries(this.ports).map(([k, v]) => [k, String(v)]));
    const ran = await this.dock('"$0" compose -p "$1" -f "$2" config --format json', [this.project!, env.compose!], undefined, ports, folder);
    if (ran.code !== 0) return `docker compose config refused the file: ${ran.stderr.trim().split('\n').slice(-1)[0] ?? ''}`;
    let config: Config;
    try { config = JSON.parse(ran.stdout) as Config; } catch { return 'docker compose config gave no JSON'; }
    const why = composeRefusal(config, folder, Object.values(this.ports).map(String), this.project!, true);
    if (why) return `the compose file can't run here: ${why}; its containers would run outside the sandbox`;
    for (const s of Object.values(config.services ?? {})) for (const p of s.ports ?? []) p.host_ip ??= '127.0.0.1';
    config.name = this.project!;
    return config;
  }

  /** The file a phase runs: the resolved config, each of `service`'s named volumes on the volume `on` names. */
  private filed(config: Config, name: string, on: Record<string, Volumes> = {}, images: Record<string, { image: string; labels: Record<string, string> }> = {}): string {
    const c = structuredClone(config);
    const volumes = (c.volumes ??= {});
    for (const [service, to] of Object.entries(on)) {
      for (const v of c.services![service]?.volumes ?? []) {
        if (v.type !== 'volume' || !v.source) continue;
        const real = to(v.source);
        volumes[real] = { name: real, external: true };
        v.source = real;
      }
    }
    for (const [service, { image, labels }] of Object.entries(images)) {
      const s = c.services![service]!;
      s.image = image;
      s.build = { ...s.build!, labels } as NonNullable<Service['build']>;
    }
    const file = join(this.dir, `${name}.json`);
    writeFileSync(file, JSON.stringify(c));
    return file;
  }
  private namedVolumes = (config: Config, service: string): string[] => (config.services?.[service]?.volumes ?? []).flatMap((v) => (v.type === 'volume' && v.source ? [v.source] : []));
  private volumeName(tag: string, source: string): string { return `${this.project}_${tag}_${source}`; }
  private async makeVolumes(names: string[]): Promise<string | undefined> {
    if (!names.length) return undefined;
    const label = `com.docker.compose.project=${this.project}`;
    const ran = await this.dock('l=$1; shift; for v; do "$0" volume create --label "$l" "$v" >/dev/null || exit 1; done', [label, ...names]);
    return ran.code === 0 ? undefined : `its volumes couldn't be made: ${ran.stderr.trim().slice(-300)}`;
  }

  /** Starts the services anew from the file; `wait`, through their own health checks. */
  private async up(file: string, services: string[], wait = true): Promise<string | undefined> {
    if (!services.length) return undefined;
    const ran = await this.dock(this.compose(file, `up -d ${wait ? '--wait ' : ''}-t 3 --no-deps --no-build --pull never --force-recreate ${services.map(quote).join(' ')}`), [], BUILD_MS);
    return ran.code === 0 ? undefined : `docker compose up ${services.join(' ')} exited ${String(ran.code)}: ${ran.stderr.trim().split('\n').slice(-1)[0] ?? ''}`;
  }
  /** Waits for the database on its own TCP port: Postgres's first start answers on its socket before it is ready. */
  private async dbReady(file: string): Promise<string | undefined> {
    const d = this.db!;
    const ran = await this.dock([
      `id=$(${this.compose(file, `ps -q ${quote(d.service)}`)}) || exit 1`, 'echo "$id"',
      `i=0; until "$0" exec "$id" pg_isready -q -h 127.0.0.1 -U ${quote(d.user)}; do i=$((i+1)); [ $i -lt 600 ] || exit 1; sleep 0.1; done`,
    ].join('\n'));
    if (ran.code !== 0) return `the database service ${d.service} never answered on its port`;
    d.container = ran.stdout.trim().split('\n')[0]!;
    return undefined;
  }
  /** One statement in the database service, with a template's last connection given time to close. */
  private async sql(statement: string): Promise<string | undefined> {
    const d = this.db!;
    const ran = await this.dock(`i=0; until "$0" exec ${quote(d.container)} psql -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -U ${quote(d.user)} -d postgres -c ${quote(statement)}; do i=$((i+1)); [ $i -lt 30 ] || exit 1; sleep 0.1; done`);
    return ran.code === 0 ? undefined : `the database service refused ${statement}: ${ran.stderr.trim().split('\n').slice(-1)[0] ?? ''}`;
  }
  private fileDb(name: string): string { return join(this.data, name, 'database'); }
  /** A database of `name`, from `from` when given: Postgres's own clone, or a copy-on-write clone of a file database. */
  private async create(name: string, from: string | undefined): Promise<string | undefined> {
    if (this.db) return this.sql(`CREATE DATABASE "${name}" TEMPLATE "${from ?? this.db.base}"`);
    mkdirSync(dirname(this.fileDb(name)), { recursive: true });
    if (from) copyFileSync(this.fileDb(from), this.fileDb(name), constants.COPYFILE_FICLONE);
    return undefined;
  }
  private async drop(name: string): Promise<string | undefined> {
    if (this.db) return this.sql(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    rmSync(dirname(this.fileDb(name)), { recursive: true, force: true });
    return undefined;
  }
  private value(name: string): string { return this.db ? `${this.db.url}/${name}` : this.fileDb(name); }

  /** The install step: the kept product for its key, cloned; or the command, run in the checkout, and its folders kept. */
  private async install(env: Environment, r: { folder: string; worktree: string; fresh?: boolean; base?: boolean }, key: string, pass: Record<string, string>, grant: Grant): Promise<{ step: WarmStep; placed: string } | { cause: string }> {
    const started = Date.now();
    const done = (status: WarmStep['status'], reported: string, product: { name: string; key: string } | undefined, placed = reported) => ({ step: { step: 'install' as const, status, key: reported, ms: Date.now() - started, ...(product ? { product } : {}) }, placed });
    // What #31's checkout cloned from the live worktree goes: a check's dependencies never come from there.
    for (const dep of DEPENDENCIES) rmSync(join(r.folder, dep), { recursive: true, force: true });
    const declared = await this.o.products.declared(r.folder, DEPENDENCIES);
    const wanted = declared.length ? declared : DEPENDENCIES.map((path) => ({ name: path, path, key }));
    const place = async (name: string, path: string, at: string): Promise<string | undefined> => {
      const why = await this.o.products.place(r.worktree, name, at, join(r.folder, path));
      if (!why && this.o.plant === 'env-second-install-store') cpSync(join(r.folder, path), join(this.o.compose.dir, 'installs', at, path), { recursive: true, verbatimSymlinks: true });
      return why;
    };
    const held = (await Promise.all(wanted.map(async (p) => (await this.o.products.holds(r.worktree, p.name, p.key) ? p : undefined)))).filter((p) => p !== undefined);
    // A base run's dependencies are the head run's (#31).
    const head = r.base ? this.installed : undefined;
    if (head) {
      for (const n of head.names) { const why = await place(n.name, n.path, n.key); if (why) return { cause: `the kept ${n.name} couldn't be cloned: ${why}` }; }
      return done('reused', head.key, head.names[0] && { name: head.names[0].name, key: head.names[0].key });
    }
    // The planted wrong program: a changed key, the last install reused, and its word that it ran.
    if (this.o.plant === 'env-reuses-stale-install' && this.installed && this.installed.key !== key) {
      for (const n of this.installed.names) await place(n.name, n.path, n.key);
      const n = this.installed.names[0];
      return done('ran', key, n && { name: n.name, key }, this.installed.key);
    }
    if (held.length && !r.fresh) {
      for (const p of held) { const why = await place(p.name, p.path, p.key); if (why) return { cause: `the kept ${p.name} couldn't be cloned: ${why}` }; }
      this.installed = { key, names: held };
      return done('reused', key, { name: held[0]!.name, key: held[0]!.key });
    }
    const ran = await step(this.o.host, ['/bin/sh', '-c', env.install!], r.folder, pass, { grant, ms: BUILD_MS });
    if (ran.code !== 0) return { cause: `the install step (${env.install!}) exited ${String(ran.code)}` };
    const made = wanted.filter((p) => existsSync(join(r.folder, p.path)));
    for (const p of made) await this.o.products.keep(r.worktree, p.name, p.path, p.key, join(r.folder, p.path));
    this.installed = { key, names: made };
    return done('ran', key, made[0] && { name: made[0].name, key: made[0].key });
  }

  /** The migrate and seed steps, each skipped while its key has a kept product; the template's name and record. */
  private async template(env: Environment, config: Config | undefined, others: string[], keys: Keys, folder: string, pass: Record<string, string>, grant: Grant, steps: WarmStep[]): Promise<{ name: string; record: Omit<SeedRecord, 'template' | 'cloned_at'> } | string> {
    const seed = env.seed!;
    const timing = (name: 'migrate' | 'seed', status: WarmStep['status'], key: string, at: number) => steps.push({ step: name, status, key, ms: Date.now() - at });
    const named = (prefix: string, key: string) => `deep_${prefix}_${key.slice(0, SHORT)}`;
    let at = Date.now();
    const migrated = named('m', keys.migrate);
    const has = this.migrated.includes(migrated);
    if (!has) {
      const why = await this.create(migrated, undefined);
      if (why) return why;
      if (env.migrate) {
        const ran = await step(this.o.host, ['/bin/sh', '-c', env.migrate], folder, { ...pass, [seed.database]: this.value(migrated) }, { grant, ms: BUILD_MS });
        if (ran.code !== 0) return `the migrate step (${env.migrate}) exited ${String(ran.code)}`;
      }
      this.migrated.unshift(migrated);
      for (const old of this.migrated.splice(KEPT)) await this.drop(old);
    }
    timing('migrate', has ? 'reused' : 'ran', keys.migrate, at);
    at = Date.now();
    const kept = this.seeded.find((s) => s.key === keys.seed);
    if (kept) {
      this.seeded.splice(this.seeded.indexOf(kept), 1);
      this.seeded.unshift(kept);
      timing('seed', 'reused', keys.seed, at);
      return kept;
    }
    const name = named('t', keys.seed);
    const tag = `t${keys.seed.slice(0, SHORT)}`;
    const why = await this.create(name, migrated);
    if (why) return why;
    // Its other services run on the template's own volumes, stopped once it ends, so what they hold is what it left.
    const file = config ? this.filed(config, `seed-${tag}`, Object.fromEntries(others.map((s) => [s, (v: string) => this.volumeName(tag, v)]))) : '';
    if (config) {
      const made = await this.makeVolumes(others.flatMap((s) => this.namedVolumes(config, s).map((v) => this.volumeName(tag, v))));
      if (made) return made;
      const up = await this.up(file, others);
      if (up) return up;
    }
    const at2 = join(this.data, `seed-record-${tag}.json`);
    const what = `the seed step (${seed.run})`;
    const ran = await step(this.o.host, ['/bin/sh', '-c', seed.run], folder, { ...pass, [seed.database]: this.value(name), DEEP_SEED_RECORD: at2 }, { grant, ms: BUILD_MS });
    if (ran.code !== 0) return `${what} exited ${String(ran.code)}, so no database was seeded`;
    if (!this.db && !existsSync(this.fileDb(name))) return `${what} left no database file at $${seed.database}`;
    const record = seedRecordAt(at2, what);
    if ('cause' in record) return record.cause;
    if (config && others.length) await this.dock(this.compose(file, `rm -sf ${others.map(quote).join(' ')}`));
    const entry = { key: keys.seed, name, record };
    this.seeded.unshift(entry);
    for (const old of this.seeded.splice(KEPT)) {
      await this.drop(old.name);
      if (config) {
        const gone = others.flatMap((s) => this.namedVolumes(config, s).map((v) => this.volumeName(`t${old.key.slice(0, SHORT)}`, v)));
        if (gone.length) await this.dock('for v; do "$0" volume rm -f "$v" >/dev/null; done', gone);
      }
    }
    timing('seed', 'ran', keys.seed, at);
    return entry;
  }

  /** An image of each service built from the repo, kept by its build context's digest; a new context builds through Docker's own layer cache. */
  private async built(config: Config, services: string[]): Promise<{ images: Serving['served']['images']; tags: Record<string, { image: string; labels: Record<string, string> }>; digests: Record<string, string> } | string> {
    const images: Serving['served']['images'] = [];
    const tags: Record<string, { image: string; labels: Record<string, string> }> = {};
    const digests: Record<string, string> = {};
    const context = (s: string) => realpathSync(config.services![s]!.build!.context);
    for (const s of services) {
      const dir = context(s);
      const digest = await filesDigest(dir, await walk(dir, ignored(dir)));
      digests[dir] = digest;
      tags[s] = { image: `${this.project}-${s}:${digest.slice('sha256:'.length, 'sha256:'.length + SHORT)}`, labels: { 'deepbuild.context': dir, 'deepbuild.digest': digest, 'com.docker.compose.project': this.project! } };
    }
    const planted = this.o.plant === 'env-reuses-web-image' && this.images.length ? this.images[0] : undefined;
    if (planted) for (const s of services) tags[s]!.image = planted;
    const file = this.filed(config, 'build', {}, tags);
    for (const s of services) {
      const have = (await this.dock('"$0" image inspect "$1" >/dev/null 2>&1', [tags[s]!.image])).code === 0;
      if (!have) {
        // Buildx keeps its state beside the Docker config, which is the hub's and no run writes.
        const ran = await this.dock(this.compose(file, `build ${quote(s)}`), [], BUILD_MS, { BUILDX_CONFIG: join(this.data, 'buildx') });
        if (ran.code !== 0) return `docker compose build ${s} exited ${String(ran.code)}: ${ran.stderr.trim().split('\n').slice(-1)[0] ?? ''}`;
        this.images.unshift(tags[s]!.image);
      }
      images.push({ service: s, image: tags[s]!.image, context_digest: digests[context(s)]!, built: !have });
    }
    for (const old of this.images.splice(KEPT * Math.max(1, services.length))) await this.dock('"$0" rmi -f "$1" >/dev/null', [old]);
    return { images, tags, digests };
  }

  /** The stack as Docker shows it now, never its own word: each container's mounts of the repo and the build of its image. */
  async containers(): Promise<{ containers: Container[]; mounts: Serving['served']['mounts'] }> {
    if (!this.project) return { containers: [], mounts: [] };
    const ran = await this.dock('ids=$("$0" ps -q --filter "label=com.docker.compose.project=$1"); [ -z "$ids" ] || "$0" inspect $ids', [this.project]);
    const rows = (ran.stdout.trim() ? JSON.parse(ran.stdout) : []) as { Config: { Image: string; Labels: Record<string, string> }; Mounts: { Type: string; Source: string; Destination: string }[] }[];
    const mounts: Serving['served']['mounts'] = [];
    const containers = rows.map((c): Container => {
      const service = c.Config.Labels['com.docker.compose.service'] ?? '(no service)';
      const binds = c.Mounts.filter((m) => m.Type === 'bind');
      for (const m of binds) mounts.push({ service, source: m.Source, target: m.Destination });
      const context = c.Config.Labels['deepbuild.context'];
      const digest = c.Config.Labels['deepbuild.digest'];
      return { name: service, binds: binds.map((m) => m.Source), ...(context && digest ? { image: { name: c.Config.Image, built_from: { context, digest } } } : {}) };
    });
    return { containers, mounts };
  }

  /** Starts the run on the stack: each step whose key has no kept product, then what is the run's own; or why it can't. */
  async serve(r: { run: string; folder: string; worktree: string; fresh?: boolean; base?: boolean; began: number }): Promise<Serving | { cause: string }> {
    const env = readEnvironment(r.folder);
    const keys = await keysOf(r.folder);
    const steps: WarmStep[] = [];
    const values = await stackValues(this.o.host, env, { folder: r.folder, take: this.keyed, scrub: this.o.scrub });
    if ('cause' in values) return values;
    const ports = Object.fromEntries(Object.entries(this.ports).map(([k, v]) => [k, String(v)]));
    const hosts = Object.values(this.ports).map((p) => `127.0.0.1:${p}`);
    const pass = { ...values.extra, ...ports };
    const grant: Grant = { run_as_you: true, hosts };
    const word = wordOf(r.run);
    let config: Config | undefined;
    if (env.compose !== undefined) {
      const resolved = await this.resolve(env, r.folder);
      if (typeof resolved === 'string') return { cause: resolved };
      config = resolved;
    }
    const all = Object.keys(config?.services ?? {});
    const toBuild = all.filter((s) => config!.services![s]!.build);
    const dbService = env.seed ? all.find((s) => !config!.services![s]!.build && POSTGRES.test(config!.services![s]!.image ?? '')) : undefined;
    const others = all.filter((s) => s !== dbService && !toBuild.includes(s));

    // The services.
    let at = Date.now();
    const base = this.filed(config ?? {}, 'services');
    const first = !this.opened;
    if (dbService) {
      const s = config!.services![dbService]!;
      const published = (s.ports ?? []).find((p) => p.target === 5432)?.published;
      if (published === undefined) return { cause: `the database service ${dbService} publishes no port a run could reach it on` };
      const user = s.environment?.POSTGRES_USER ?? 'postgres';
      const password = s.environment?.POSTGRES_PASSWORD;
      this.db = { service: dbService, container: this.db?.container ?? '', user, port: Number(published), url: `postgres://${user}${password ? `:${encodeURIComponent(password)}` : ''}@127.0.0.1:${published}`, base: s.environment?.POSTGRES_DB ?? 'postgres' };
    }
    // A service bind-mounting the repo restarts for each run, with its mount in the run's checkout and its volumes kept.
    if (dbService && (first || (this.o.plant !== 'env-keeps-db-mount' && config!.services![dbService]!.volumes?.some((v) => v.type === 'bind')))) {
      const why = await this.up(base, [dbService], false);
      if (why) return { cause: why };
    }
    if (dbService) {
      const why = await this.dbReady(base);
      if (why) return { cause: why };
    }
    this.opened = true;
    this.servicesKey = keys.services;
    this.last = keys;
    steps.push({ step: 'services', status: first ? 'ran' : 'reused', key: keys.services, ms: Date.now() - at });

    // Install.
    let installKey = keys.install;
    let placed: string | undefined;
    if (env.install) {
      const installed = await this.install(env, r, keys.install, pass, grant);
      if ('cause' in installed) return installed;
      steps.push(installed.step);
      installKey = installed.step.key!;
      placed = installed.placed;
    } else steps.push({ step: 'install', status: 'reused', key: keys.install, ms: 0 });

    // Migrate, seed, and what is the run's own: its clone, and its other services on copies of the template's volumes.
    const own = { folder: r.folder, worktree: r.worktree, install: installKey, caches: env.caches, others: [] as string[], volumes: [] as string[] } as { folder: string; worktree: string; install: string; caches: string[]; compose?: string; others: string[]; volumes: string[]; clone?: string };
    this.serving.set(r.run, own);
    const facts: RunFacts = { services: [], ...(placed ? { install: { key: keys.install, placed } } : {}) };
    const database: Record<string, string> = {};
    let seed: SeedRecord | undefined;
    let tag = '';
    if (env.seed) {
      const template = await this.template(env, config, others, keys, r.folder, pass, grant, steps);
      if (typeof template === 'string') return { cause: template };
      tag = `t${keys.seed.slice(0, SHORT)}`;
      at = Date.now();
      const keep = this.o.plant === 'env-keeps-database' && this.held.clone;
      const clone = keep || `deep_r_${word}`;
      if (!keep) {
        const why = await this.create(clone, template.name);
        if (why) return { cause: why };
      }
      own.clone = clone;
      this.held.clone = clone;
      facts.database = clone;
      database[env.seed.database] = this.value(clone);
      seed = { ...template.record, template: keys.seed, cloned_at: Date.now() };
      steps.push({ step: 'clone', status: 'ran', key: null, ms: Date.now() - at });
    } else steps.push({ step: 'migrate', status: 'reused', key: keys.migrate, ms: 0 }, { step: 'seed', status: 'reused', key: keys.seed, ms: 0 });

    at = Date.now();
    const keepRedis = this.o.plant === 'env-keeps-redis' && this.held.started;
    const runTag = `r${word}`;
    let file = '';
    if (config) {
      const volumeOf = keepRedis ? (v: string) => this.held.volume![v]! : (v: string) => this.volumeName(runTag, v);
      file = this.filed(config, `run-${word}`, Object.fromEntries(others.map((s) => [s, volumeOf])));
      own.compose = file;
      const pairs = others.flatMap((s) => this.namedVolumes(config!, s).map((v) => ({ s, v, to: volumeOf(v), from: tag ? this.volumeName(tag, v) : undefined })));
      facts.services = others.map((s) => ({ name: s, volumes: pairs.filter((p) => p.s === s).map((p) => p.to) }));
      if (!keepRedis) {
        own.volumes = pairs.map((p) => p.to);
        own.others = others;
        const made = await this.makeVolumes(own.volumes);
        if (made) return { cause: made };
        for (const p of pairs) {
          if (!p.from) continue;
          const image = config.services![p.s]!.image!;
          const copied = await this.dock('"$0" run --rm --network none --label "com.docker.compose.project=$1" --entrypoint sh -v "$2:/from:ro" -v "$3:/to" "$4" -c "cp -a /from/. /to/"', [this.project!, p.from, p.to, image]);
          if (copied.code !== 0) return { cause: `the template's volume ${p.v} couldn't be copied: ${copied.stderr.trim().slice(-300)}` };
        }
        const up = await this.up(file, others);
        if (up) return { cause: up };
        if (this.o.plant === 'env-keeps-redis') { this.held.started = true; this.held.volume = Object.fromEntries(pairs.map((p) => [p.v, p.to])); own.others = []; own.volumes = []; }
      }
    }

    // The cache folders, as the last run on this install key left them.
    const caches: Serving['served']['caches'] = [];
    for (const path of env.caches) {
      // The planted wrong program clones the folder above: build output with the cache.
      const held = this.o.plant === 'env-clones-next-whole' ? dirname(path) : path;
      if (await this.o.products.placeCache(r.worktree, installKey, held, join(r.folder, held))) caches.push({ path, digest: await treeDigest(join(r.folder, path)) });
    }

    // The app: an image built from the checkout, and the run's own process from it.
    const images: Serving['served']['images'] = [];
    const digests: Record<string, string> = {};
    if (config && toBuild.length) {
      const b = await this.built(config, toBuild);
      if (typeof b === 'string') return { cause: b };
      images.push(...b.images);
      Object.assign(digests, b.digests);
      own.compose = file = this.filed(config, `run-${word}`, Object.fromEntries(others.map((s) => [s, keepRedis ? (v: string) => this.held.volume![v]! : (v: string) => this.volumeName(runTag, v)])), b.tags);
      const up = await this.up(file, toBuild);
      own.others = [...own.others, ...toBuild];
      if (up) return { cause: up };
    }
    let app: string | undefined;
    const published = new Set(Object.values(config?.services ?? {}).flatMap((s) => (s.ports ?? []).map((p) => Number(p.published))));
    const appPorts = Object.values(this.ports).filter((p) => !published.has(p));
    if (env.up !== undefined) {
      app = newRun();
      const started = await this.o.host.start({
        run: app, argv: ['/bin/sh', '-c', env.up, app], cwd: r.folder, env: { ...pass, ...database },
        grant: { run_as_you: true, hosts, ...(appPorts.length ? { listen: appPorts.map((p) => `127.0.0.1:${p}`) } : {}) },
        ...(values.credentials.length ? { credentials: values.credentials } : {}),
      });
      if (started.status === 'BLOCKED') return { cause: `no ${started.kind} is free to lease` };
    }
    const url = env.ready.http.replace(/\$\{(\w+)\}/g, (all, name: string) => (this.ports[name] !== undefined ? String(this.ports[name]) : all));
    let ended: string | undefined;
    if (app) void this.o.host.wait(app).then((exit) => { ended = exit.signal ?? `code ${exit.code}`; }, () => undefined);
    const deadline = Date.now() + env.ready.within * 1000;
    for (let answer = await get(url); answer.status !== 200; answer = await get(url)) {
      if (ended !== undefined || Date.now() > deadline) {
        if (app) await downStack(this.o.host, app);
        return { cause: ended !== undefined ? `the app's command ended (${ended}) before ${url} answered 200` : `${url} didn't answer 200 within ${env.ready.within} s` };
      }
      await sleep(50);
    }
    steps.push({ step: 'app', status: 'ran', key: null, ms: Date.now() - at });
    const ready_ms = Date.now() - r.began;
    const { mounts } = await this.containers();
    return {
      served: { stack: this.id, ...(this.project ? { project: this.project } : {}), checkout: realpathSync(r.folder), ports: this.ports, ready_ms, steps, caches, images, mounts },
      env: { ...pass, ...database }, hosts, ...(app ? { app } : {}), appPorts, ...(seed ? { seed } : {}), facts, digests,
    };
  }

  /** The run's end, after its app has stopped: its caches kept, and only what is the run's own removed. Why it couldn't be, or nothing. */
  async end(run: string): Promise<string | undefined> {
    const own = this.serving.get(run);
    if (!own) return undefined;
    this.serving.delete(run);
    for (const path of own.caches) {
      const held = this.o.plant === 'env-clones-next-whole' ? dirname(path) : path;
      if (existsSync(join(own.folder, held))) await this.o.products.keepCache(own.worktree, own.install, held, join(own.folder, held));
    }
    let why: string | undefined;
    if (own.compose && own.others.length) {
      const removed = await this.dock(`${this.compose(own.compose, `stop -t 1 ${own.others.map(quote).join(' ')}`)} && ${this.compose(own.compose, `rm -f ${own.others.map(quote).join(' ')}`)}`);
      if (removed.code !== 0) why = `its services couldn't be removed: ${removed.stderr.trim().slice(-300)}`;
    }
    if (own.volumes.length) {
      const removed = await this.dock('for v; do "$0" volume rm -f "$v" >/dev/null || exit 1; done', own.volumes);
      if (removed.code !== 0) why ??= `its copied volumes couldn't be removed: ${removed.stderr.trim().slice(-300)}`;
    }
    if (own.clone && this.o.plant !== 'env-keeps-database') why = (await this.drop(own.clone)) ?? why;
    return why;
  }
}
