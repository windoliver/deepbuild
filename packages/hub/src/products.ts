// Shared build products (#1017; design: Sessions that know about each other, Lease). A product is a folder the repo's
// own tools write and can rebuild (`target`, `node_modules`, `.venv`), as done.yaml's `environment.products` lists it:
// the files its key reads, the toolchain values that key it too, and the command that builds it. A product kind has no
// code of its own.
//
// The hub keeps one store per repo in its own folder, outside every worktree, `<root>/products/<repo>/`, with the two
// most recently used keys of each product. It builds an entry from the default branch as last fetched, in a checkout
// of its own made as #31's are (the repo's objects read in place, nothing fetched), through the supervisor and under a
// heavy-command lease (#1015), once per new key, and never from a session's worktree. A worktree receives, at each
// session's start in it, a copy-on-write clone of each entry whose key its own files make, unless a folder is already
// there; it is never linked and never copied byte for byte. The store is read-only to sessions: a guard@1 entry denies
// a write whose reach includes it, and a change made anyway is found once its call ends and recorded on it, and the
// entry rebuilt. One disk floor per machine: nothing here starts under it, and products in worktrees nobody works in
// go first to make room.
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, watch, type FSWatcher } from 'node:fs';
import { lstat, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { parse } from 'yaml';
import { DISK_FLOOR, freeBytes } from './disk.js';
import { repoOf } from './paths.js';
import { writeSynced } from './vfs.js';

/** One entry of `environment.products`. */
interface Product { name: string; path: string; key: string[]; key_values: string[]; build: string }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
/** A path inside the checkout: relative, with no `..` or empty segment. */
const inside = (p: string): boolean => !p.startsWith('/') && p.split('/').every((s) => s !== '' && s !== '..' && s !== '.');

/** A worktree nobody has worked in for this long, with no command running, gives up its products first. */
const IDLE_MS = 2 * 3_600_000;
/** The guard@1 entry that keeps the store read-only to sessions. */
const STORE_GUARD = 'no-product-store-write';
const KEPT = 2;
const gb = (bytes: number): string => `${(bytes / 1e9).toFixed(1)} GB`;

/** The products done.yaml's text lists; none when it lists none. Throws naming what is wrong with an entry. */
function productsIn(text: string, file: string): Product[] {
  const doc = parse(text) as { environment?: { products?: unknown } } | null;
  const list = doc?.environment?.products;
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw Error(`${file}: environment.products is a list of {name, path, key, key_values, build}`);
  const seen = new Set<string>();
  return list.map((p, i) => {
    const at = `${file}: environment.products[${i}]`;
    if (!isObj(p)) throw Error(`${at} is {name, path, key, key_values, build}`);
    const { name, path, key, key_values = [], build } = p;
    if (!isText(name) || !/^[A-Za-z0-9_.-]+$/.test(name) || seen.has(name)) throw Error(`${at}.name is a name of its own: letters, digits, _, . and -`);
    seen.add(name);
    if (!isText(path) || !inside(path)) throw Error(`${at}.path is a folder inside the checkout, relative to its top`);
    if (!Array.isArray(key) || !key.length || !key.every((k) => isText(k) && inside(k))) throw Error(`${at}.key lists the files its key reads, each relative to the checkout's top`);
    if (!Array.isArray(key_values) || !key_values.every(isText)) throw Error(`${at}.key_values lists the commands that print the toolchain or runtime versions its key reads`);
    if (!isText(build)) throw Error(`${at}.build is the command that builds it`);
    return { name, path, key: key as string[], key_values: key_values as string[], build };
  });
}

function sh(command: string, cwd: string, timeout = 10_000): Promise<string> {
  return new Promise((done) => {
    execFile('/bin/sh', ['-c', command], { cwd, timeout, env: process.env, maxBuffer: 1 << 20 }, (error, out, err) => done(error ? `failed: ${String(err).trim().slice(0, 200)}` : String(out).trim()));
  });
}
function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  // Git's location variables the hub may have been started with never point it elsewhere (#31).
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG_.*)$/.test(k)));
  return new Promise((done, fail) => {
    execFile('git', args, { cwd, env: { ...clean, ...env }, maxBuffer: 256 << 20, timeout: 120_000 }, (error, out, err) => (error ? fail(Error(`git ${args[0]}: ${String(err).trim() || error.message}`)) : done(String(out).trim())));
  });
}

/**
 * The product's key in a checkout: a digest of its name and path, each key file's bytes, and what each key_values
 * command prints there (`rustc --version` under the checkout's own rust-toolchain.toml, `node --version`).
 */
async function keyIn(product: Product, top: string, read: (file: string) => Buffer | undefined): Promise<string> {
  const values = await Promise.all(product.key_values.map((c) => sh(c, top)));
  const h = createHash('sha256').update(JSON.stringify([product.name, product.path, product.key_values, values]));
  for (const k of product.key) {
    h.update(`\0${k}\0`);
    const bytes = read(k);
    h.update(bytes ?? '\0missing');
  }
  return h.digest('hex').slice(0, 24);
}
const fileIn = (top: string) => (k: string): Buffer | undefined => { try { return readFileSync(join(top, k)); } catch { return undefined; } };
/** Whether `cwd` or a folder above it holds `.deepbuild/done.yaml`, the only file that lists products. */
function specAbove(cwd: string): boolean {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.deepbuild', 'done.yaml'))) return true;
    if (dirname(dir) === dir) return false;
  }
}

/**
 * Clones `src`, a folder, to `dst`, which must not exist, copy-on-write: one `clonefileat` on APFS (through perl's
 * syscall, which every Mac ships), a reflink copy on Linux. Owners, modes and timestamps stay as the store has them.
 * Where the file system can't clone, nothing is left at `dst` and the reason comes back.
 */
export function cloneTree(src: string, dst: string): Promise<{ cloned: true } | { cloned: false; why: string }> {
  return new Promise((done) => {
    const failed = (why: string) => { try { rmSync(dst, { recursive: true, force: true }); } catch { /* best effort */ } done({ cloned: false, why }); };
    if (process.platform === 'darwin') {
      // SYS_clonefileat is 462 and AT_FDCWD is -2; flags 0.
      execFile('/usr/bin/perl', ['-e', 'syscall(462, -2, $ARGV[0], -2, $ARGV[1], 0) == 0 or do { print STDERR "$!"; exit 1 }', src, dst], { timeout: 120_000 }, (error, _out, err) => {
        if (error) failed(`clonefile: ${String(err).trim() || error.message}`);
        else done({ cloned: true });
      });
    } else if (process.platform === 'linux') {
      execFile('cp', ['-a', '--reflink=always', src, dst], { timeout: 600_000 }, (error, _out, err) => (error ? failed(`reflink: ${String(err).trim() || error.message}`) : done({ cloned: true })));
    } else failed(`no copy-on-write clone on ${process.platform}`);
  });
}

/** The bytes a folder's files hold, and their count. */
async function sizeOf(dir: string): Promise<number> {
  let bytes = 0;
  const walk = async (at: string): Promise<void> => {
    let names: string[];
    try { names = await readdir(at); } catch { return; }
    await Promise.all(names.map(async (n) => {
      const st = await lstat(join(at, n)).catch(() => undefined);
      if (!st) return;
      if (st.isDirectory()) await walk(join(at, n));
      else bytes += st.size;
    }));
  };
  await walk(dir);
  return bytes;
}

/** A kept entry, as the store's index records it. */
interface Entry { repo: string; name: string; path: string; key: string; commit: string; built: number; finished: number; used: number; served: number; bytes: number }
/** A product the hub placed in a worktree. */
interface Placed { top: string; name: string; path: string; key: string; at: number }
interface Index { entries: Entry[]; placed: Placed[] }
/** What the hub knows of the sessions in a worktree: each one's last hook, whether it ended, and its open calls. */
interface Seen { last: number; ended: boolean; open: Map<string, number> }

interface ProductsOptions {
  /** The hub's own folder; the store is `<root>/products`. */
  root: string;
  now(): number;
  plant?: string | undefined;
  trusted(cwd: string): Promise<boolean>;
  /** Appends a core event, on the session when given. */
  append(kind: string, data: Obj, session?: string): Promise<void>;
  /** Runs the build command in `cwd` through the supervisor, under a heavy-command lease; resolves with its exit and output's end. */
  build(o: { cwd: string; command: string }): Promise<{ code: number | null; tail: string }>;
  /** The processes with a file open under a folder, read by the supervisor. */
  openUnder(dir: string): Promise<{ pid: number; command: string }[]>;
  /** Installs the store's guard@1 entry, with its planted call and twin, into rules.json. */
  guard(given: Obj): Promise<{ status: string; reason?: string }>;
}

export class Products {
  readonly store: string;
  private readonly indexFile: string;
  private index: Index = { entries: [], placed: [] };
  /** Default-branch commits whose entries are built or being built, by repo and product. */
  private readonly tried = new Map<string, string>();
  private readonly building = new Map<string, Promise<void>>();
  private readonly sessions = new Map<string, Seen & { top: string }>();
  /** Files under kept entries the watch saw change, with when, until a call's end claims them. */
  private changed = new Map<string, number>();
  /** Entries the hub itself is removing, whose watch events are its own. */
  private readonly removing = new Set<string>();
  private watcher: FSWatcher | undefined;
  private readonly said = new Set<string>();
  /** The repo's git common folder, by repo, for the builds. */
  private readonly repos = new Map<string, string>();
  private readonly values = new Map<string, { at: number; key: Promise<string> }>();
  private readonly starts = new Map<string, Promise<string | undefined>>();
  private opened!: () => void;
  /** Once the index is read and the guard installed: a session that starts before then waits for it. */
  private readonly ready = new Promise<void>((done) => { this.opened = done; });

  constructor(private readonly o: ProductsOptions) {
    this.store = join(o.root, 'products');
    this.indexFile = join(o.root, 'products.json');
  }

  async open(): Promise<void> {
    // What a build cut short by a stop left is no entry.
    rmSync(join(this.store, '.building'), { recursive: true, force: true });
    mkdirSync(join(this.store, '.building'), { recursive: true });
    try { this.index = JSON.parse(readFileSync(this.indexFile, 'utf8')) as Index; } catch { /* a new store */ }
    this.index.entries = this.index.entries.filter((e) => existsSync(this.entryDir(e)));
    try { await this.secure(); } finally { this.opened(); }
  }
  /** The guard entry that keeps the store read-only to sessions, and the watch that finds a change made anyway. */
  private async secure(): Promise<void> {
    if (this.o.plant === 'store-writable') return;
    const real = realpathSync(this.store);
    const globs = [...new Set([this.store, real])].flatMap((p) => [p, `${p}/*`]).join(' ');
    const added = await this.o.guard({
      v: 1,
      entries: {
        [STORE_GUARD]: {
          match: `write:${globs}`, scope: 'all_repos', mode: 'block', fail_closed: true,
          reason: 'DeepBuild\'s product store is read-only to every session: each worktree gets copy-on-write clones of its entries, and only the hub builds them, from the default branch.',
          next_step: 'Change the product in your own worktree, whose clone is yours; if a kept entry is wrong, fix its build on the default branch and the hub builds it again.',
        },
      },
      proofs: {
        [STORE_GUARD]: {
          planted: { tool_name: 'Write', tool_input: { file_path: join(this.store, 'repo', 'target@key', 'src', 'target', 'x'), content: 'x\n' } },
          twin: { tool_name: 'Write', tool_input: { file_path: join(this.o.root, 'products-notes', 'x.md'), content: 'x\n' } },
        },
      },
    });
    if (added.status !== 'installed') process.stderr.write(`deep hub: the product store's guard entry wasn't installed: ${added.reason ?? added.status}\n`);
    // A change to a kept entry made by anything but the hub: found by the watch, claimed by the call it ran in.
    try {
      this.watcher = watch(this.store, { recursive: true }, (_event, file) => {
        if (!file) return;
        const rel = String(file);
        if (rel.startsWith('.building')) return;
        const abs = join(this.store, rel);
        const entry = this.entryOf(abs);
        if (entry && !this.removing.has(this.entryDir(entry))) this.changed.set(abs, this.o.now());
      });
      this.watcher.on('error', () => undefined);
    } catch { /* no watch here: calls' ends find nothing */ }
  }
  close(): void { this.watcher?.close(); }

  private save(): void { writeSynced(this.indexFile, Buffer.from(`${JSON.stringify(this.index)}\n`)); }
  private entryDir(e: Pick<Entry, 'repo' | 'name' | 'key'>): string { return join(this.store, e.repo, `${e.name}@${e.key}`); }
  /** Where the entry's product is: its folder in the entry's own checkout. */
  private productDir(e: Pick<Entry, 'repo' | 'name' | 'key' | 'path'>): string { return join(this.entryDir(e), 'src', e.path); }
  private entryOf(abs: string): Entry | undefined { return this.index.entries.find((e) => abs === this.productDir(e) || abs.startsWith(`${this.productDir(e)}/`)); }
  private found(repo: string, name: string, key: string): Entry | undefined { return this.index.entries.find((e) => e.repo === repo && e.name === name && e.key === key); }

  /** The repo a folder is in: its id, its top folder and its git common folder; none outside a git repo. */
  private async repoAt(cwd: string): Promise<{ id: string; top: string; common: string } | undefined> {
    try {
      const [top, common] = (await git(cwd, ['rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir'])).split('\n') as [string, string];
      const id = repoOf(top);
      return id ? { id, top: realpathSync(top), common } : undefined;
    } catch { return undefined; }
  }
  private productsAt(top: string): Product[] {
    const file = join(top, '.deepbuild', 'done.yaml');
    if (!existsSync(file)) return [];
    const list = productsIn(readFileSync(file, 'utf8'), file);
    // The planted wrong program knows only Cargo's and npm's products.
    return this.o.plant === 'products-cargo-npm-only' ? list.filter((p) => p.path === 'target' || p.path === 'node_modules') : list;
  }

  // ---- A session's start: the worktree receives what its keys match.

  /** At a session's start in `cwd`: places each product whose kept key the worktree's files make, then sees to the default branch's entries. The lines its session start shows. */
  sessionStart(session: string, cwd: string, hook: string): Promise<string | undefined> {
    // One start, whether its reply asked first or its hook's record did (a spooled start has no reply).
    let started = this.starts.get(hook);
    if (!started) {
      started = this.start(session, cwd);
      this.starts.set(hook, started);
      if (this.starts.size > 1000) this.starts.delete(this.starts.keys().next().value!);
    }
    return started;
  }
  private async start(session: string, cwd: string): Promise<string | undefined> {
    if (!cwd) return undefined;
    // A folder with no done.yaml at or above it lists no products: no git process starts on the core's thread for it.
    if (!specAbove(cwd)) return undefined;
    await this.ready;
    const repo = await this.repoAt(cwd);
    if (!repo || !(await this.o.trusted(cwd))) return undefined;
    let products: Product[];
    try { products = this.productsAt(repo.top); } catch (error) { return `DeepBuild can't read this repo's products: ${error instanceof Error ? error.message : String(error)}`; }
    if (!products.length) return undefined;
    if (session) this.seen(session, repo.top).last = this.o.now();
    this.repos.set(repo.id, repo.common);
    void this.ensure(repo.id, repo.common, { session }).catch((error: unknown) => process.stderr.write(`deep hub: the product store's build: ${error instanceof Error ? error.message : String(error)}\n`));
    const lines = (await Promise.all(products.map((p) => this.place(repo.id, repo.top, p, session)))).filter(Boolean);
    return lines.length ? lines.join('\n') : undefined;
  }

  private async place(repo: string, top: string, p: Product, session: string): Promise<string | undefined> {
    const dst = join(top, p.path);
    // A product folder already in the worktree is left alone.
    if (existsSync(dst) || isLink(dst)) return undefined;
    const key = await this.worktreeKey(p, top);
    let entry = this.found(repo, p.name, key);
    // The planted wrong program clones the nearest kept key when none is exact.
    if (!entry && this.o.plant === 'nearest-key') entry = this.index.entries.filter((e) => e.repo === repo && e.name === p.name).sort((a, b) => b.used - a.used)[0];
    if (!entry) return undefined;
    if (this.o.plant !== 'places-stale') {
      // A file the worktree holds that predates the entry's build can read as fresh to a tool that judges by time,
      // whatever it holds: such a worktree builds as it does today.
      const older = await this.olderThan(top, entry.built);
      if (older) return `DeepBuild didn't place ${p.path} (${p.name}) from the default branch's warm build: this worktree's ${older} predates that build, so ${p.build.split(/\s+/)[0]} could read stale sources as fresh. It builds as it does today.`;
    }
    const free = freeBytes(this.store);
    if (free < DISK_FLOOR) return `DeepBuild didn't place ${p.path} (${p.name}): the volume has ${gb(free)} free, under the ${gb(DISK_FLOOR)} disk floor. It builds as it does today.`;
    mkdirSync(dirname(dst), { recursive: true });
    const src = this.productDir(entry);
    if (this.o.plant === 'product-symlinks') symlinkSync(src, dst);
    else if (this.o.plant === 'product-hard-links') await hardLinks(src, dst);
    else {
      const r = await cloneTree(src, dst);
      if (!r.cloned) {
        const once = `${top}\0clone`;
        if (this.said.has(once)) return undefined;
        this.said.add(once);
        return `DeepBuild places no warm build products here: this file system can't clone copy-on-write (${r.why}), so this worktree builds as it does today.`;
      }
    }
    entry.used = this.o.now();
    entry.served += 1;
    this.index.placed = [...this.index.placed.filter((x) => !(x.top === top && x.name === p.name)), { top, name: p.name, path: p.path, key, at: this.o.now() }];
    this.save();
    if (session) void this.reading(session, `DeepBuild placed ${p.path} (${p.name}) in this worktree: a copy-on-write clone of the default branch's warm build of key ${key}, which has now served ${entry.served} worktree${entry.served === 1 ? '' : 's'}; ${p.build.split(/\s+/)[0]} rebuilds only what changed here.`);
    return undefined;
  }

  /** The worktree's key for a product, read again only once a minute per folder unless its key files change. */
  private worktreeKey(p: Product, top: string): Promise<string> {
    const stamp = p.key.map((k) => { try { const s = lstatSync(join(top, k)); return `${s.ino}:${s.size}:${s.mtimeMs}`; } catch { return '-'; } }).join('|');
    const id = `${top}\0${p.name}\0${stamp}\0${JSON.stringify(p)}`;
    const seen = this.values.get(id);
    if (seen && this.o.now() - seen.at < 60_000) return seen.key;
    const key = keyIn(p, top, fileIn(top));
    this.values.set(id, { at: this.o.now(), key });
    return key;
  }

  /** A tracked file of the worktree's older than `since`, or none. */
  private async olderThan(top: string, since: number): Promise<string | undefined> {
    const files = (await git(top, ['ls-files', '-z']).catch(() => '')).split('\0').filter(Boolean);
    for (const f of files) {
      try { if (lstatSync(join(top, f)).mtimeMs < since) return f; } catch { /* gone: an edit */ }
    }
    return undefined;
  }

  // ---- A check's stack (#580): its install and a worktree's come from the same kept copy.

  /** The products the checkout's done.yaml lists among `paths`, each with the key its files make there. */
  async declared(folder: string, paths: readonly string[]): Promise<{ name: string; path: string; key: string }[]> {
    const listed = this.productsAt(folder).filter((p) => paths.includes(p.path));
    return Promise.all(listed.map(async (p) => ({ name: p.name, path: p.path, key: await keyIn(p, folder, fileIn(folder)) })));
  }
  private async repoId(worktree: string): Promise<string | undefined> { return (await this.repoAt(worktree))?.id; }
  async holds(worktree: string, name: string, key: string): Promise<boolean> {
    await this.ready;
    const repo = await this.repoId(worktree);
    const e = repo && this.found(repo, name, key);
    return !!e && existsSync(this.productDir(e));
  }
  /** Clones the entry to `dst`, never linked; why it couldn't. */
  async placeIn(worktree: string, name: string, key: string, dst: string): Promise<string | undefined> {
    const repo = await this.repoId(worktree);
    const e = repo && this.found(repo, name, key);
    if (!e) return `no entry of ${name} holds key ${key}`;
    const r = await cloneTree(this.productDir(e), dst);
    if (!r.cloned) return r.why;
    e.used = this.o.now();
    e.served += 1;
    this.save();
    return undefined;
  }
  /** Keeps a folder a check's install left, cloned, under its key: a product like any built from the default branch. */
  async keep(worktree: string, name: string, path: string, key: string, src: string): Promise<void> {
    await this.ready;
    const repo = await this.repoId(worktree);
    if (!repo || !existsSync(src)) return;
    const stage = join(this.store, '.building', `${repo}-${name}-${randomBytes(4).toString('hex')}`);
    const dst = join(stage, 'src', path);
    mkdirSync(dirname(dst), { recursive: true });
    try {
      const r = await cloneTree(src, dst);
      if (!r.cloned) return;
      const now = this.o.now();
      const entry: Entry = { repo, name, path, key, commit: '', built: now, finished: now, used: now, served: 0, bytes: await sizeOf(dst) };
      mkdirSync(join(this.store, repo), { recursive: true });
      if (this.found(repo, name, key)) { this.found(repo, name, key)!.used = now; this.save(); return; }
      renameSync(stage, this.entryDir(entry));
      this.index.entries = [...this.index.entries, entry];
      this.save();
      await this.prune(repo, name);
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }
  /** A declared cache's kept copy, by the install key it was left on; a folder of the store's, gone when the repo's entry on that key goes. */
  private cacheDir(repo: string, key: string, path: string): string { return join(this.store, repo, `caches@${key}`, path); }
  async placeCache(worktree: string, key: string, path: string, dst: string): Promise<boolean> {
    const repo = await this.repoId(worktree);
    const src = repo && this.cacheDir(repo, key, path);
    if (!src || !existsSync(src)) return false;
    rmSync(dst, { recursive: true, force: true });
    mkdirSync(dirname(dst), { recursive: true });
    return (await cloneTree(src, dst)).cloned;
  }
  async keepCache(worktree: string, key: string, path: string, src: string): Promise<void> {
    const repo = await this.repoId(worktree);
    if (!repo) return;
    const dst = this.cacheDir(repo, key, path);
    rmSync(dst, { recursive: true, force: true });
    mkdirSync(dirname(dst), { recursive: true });
    await cloneTree(src, dst);
    // At most the two most recent install keys' caches stay, as their installs do.
    const kept = this.index.entries.filter((e) => e.repo === repo).map((e) => e.key);
    for (const d of await readdir(join(this.store, repo))) {
      if (d.startsWith('caches@') && d !== `caches@${key}` && !kept.includes(d.slice('caches@'.length))) await rm(join(this.store, repo, d), { recursive: true, force: true });
    }
  }

  // ---- The default branch's entries.

  /** Builds each product's entry for the default branch as last fetched, once per new key; never fetches. */
  async ensure(repo: string, common: string, o: { force?: string; session?: string } = {}): Promise<void> {
    const commit = await this.defaultCommit(common);
    if (!commit) return;
    let text: string;
    try { text = await git(common, [`--git-dir=${common}`, 'show', `${commit}:.deepbuild/done.yaml`]); } catch { return; }
    let products: Product[];
    try { products = productsIn(text, `${commit}:.deepbuild/done.yaml`); } catch { return; }
    if (this.o.plant === 'products-cargo-npm-only') products = products.filter((p) => p.path === 'target' || p.path === 'node_modules');
    for (const p of products) {
      const id = `${repo}\0${p.name}`;
      if (o.force !== p.name && this.tried.get(id) === commit) continue;
      if (this.building.has(id)) continue;
      this.tried.set(id, commit);
      const run = this.buildEntry(repo, common, commit, p, o.session).catch(async (error: unknown) => {
        await this.reading(o.session, `The store's build of ${p.name} (${p.path}) from ${commit.slice(0, 12)} failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 4000)}`);
      }).finally(() => this.building.delete(id));
      this.building.set(id, run);
    }
  }
  private async defaultCommit(common: string): Promise<string | undefined> {
    for (const ref of ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master', 'refs/heads/main', 'refs/heads/master']) {
      try { return await git(common, [`--git-dir=${common}`, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); } catch { /* the next */ }
    }
    return undefined;
  }

  /** One entry: a checkout of the default branch's commit, its key read there, built there when no entry holds that key, then kept. */
  private async buildEntry(repo: string, common: string, commit: string, p: Product, session: string | undefined): Promise<void> {
    const stage = join(this.store, '.building', `${repo}-${p.name}-${randomBytes(4).toString('hex')}`);
    const src = join(stage, 'src');
    mkdirSync(src, { recursive: true });
    try {
      // Made as #31's checkouts are: an index of its own, the repo's objects read in place, its refs untouched.
      const index = { GIT_INDEX_FILE: join(stage, 'index') };
      await git(common, [`--git-dir=${common}`, 'read-tree', commit], index);
      await git(common, [`--git-dir=${common}`, 'checkout-index', '-a', '-f', `--prefix=${src}/`], index);
      const key = await keyIn(p, src, fileIn(src));
      const kept = this.found(repo, p.name, key);
      if (kept && existsSync(this.productDir(kept))) { kept.used = this.o.now(); this.save(); return; }
      await this.roomFor(repo, p, session);
      const built = this.o.now();
      const r = await this.o.build({ cwd: src, command: p.build });
      if (r.code !== 0 || !existsSync(join(src, p.path))) {
        await this.reading(session, `The store's build of ${p.name} (${p.path}) from ${commit.slice(0, 12)} ${r.code === 0 ? `left no ${p.path}` : `exited ${r.code}`}, so worktrees build it as they do today: ${r.tail.slice(-3000)}`);
        return;
      }
      const entry: Entry = { repo, name: p.name, path: p.path, key, commit, built, finished: this.o.now(), used: this.o.now(), served: 0, bytes: await sizeOf(join(src, p.path)) };
      mkdirSync(join(this.store, repo), { recursive: true });
      rmSync(join(stage, 'index'), { force: true });
      renameSync(stage, this.entryDir(entry));
      this.index.entries = [...this.index.entries.filter((e) => !(e.repo === repo && e.name === p.name && e.key === key)), entry];
      this.save();
      await this.prune(repo, p.name);
      const store = this.index.entries.filter((e) => e.repo === repo).reduce((n, e) => n + e.bytes, 0);
      await this.o.append('product.built', { product: p.name, path: p.path, key, commit, bytes: entry.bytes, store_bytes: store });
    } finally {
      rmSync(stage, { recursive: true, force: true });
    }
  }

  /** Keeps the two most recently used keys of a product; an older one goes once no process reads it. */
  private async prune(repo: string, name: string): Promise<void> {
    const mine = this.index.entries.filter((e) => e.repo === repo && e.name === name).sort((a, b) => b.used - a.used);
    for (const e of mine.slice(KEPT)) await this.removeEntry(e);
  }
  private async removeEntry(e: Entry): Promise<boolean> {
    if ((await this.o.openUnder(realpathSync(this.entryDir(e))).catch(() => [{ pid: 0, command: '' }])).length) return false;
    const dir = this.entryDir(e);
    this.removing.add(dir);
    try { await rm(dir, { recursive: true, force: true }); } finally { this.removing.delete(dir); }
    this.index.entries = this.index.entries.filter((x) => x !== e);
    this.save();
    return true;
  }

  // ---- The disk floor.

  /**
   * Waits until building the entry, counted at its product's last kept size, leaves free space at or over the floor:
   * products in worktrees nobody works in go first, least recently used first, each once no process has a file open
   * under it; then kept entries, least recently used first. Its line names the floor.
   */
  private async roomFor(repo: string, p: Product, session: string | undefined): Promise<void> {
    const need = Math.max(0, ...this.index.entries.filter((e) => e.repo === repo && e.name === p.name).map((e) => e.bytes));
    let told = false;
    for (;;) {
      const free = freeBytes(this.store);
      if (free - need >= DISK_FLOOR) return;
      if (!told) {
        told = true;
        await this.reading(session, `The store's build of ${p.name} (${p.path}) waits for disk: the volume has ${gb(free)} free and the build needs up to ${gb(need)}, which would take it under the ${gb(DISK_FLOOR)} disk floor. Products in worktrees nobody works in go first.`);
      }
      // The volume's count catches up with a removal a moment later.
      if (await this.reclaimOne()) { await new Promise((done) => setTimeout(done, 500)); continue; }
      await new Promise((done) => setTimeout(done, 5000));
    }
  }

  /** Removes one product to make room: the least recently used in a worktree nobody works in, else a kept entry. Whether it removed one. */
  async reclaimOne(): Promise<boolean> {
    const now = this.o.now();
    const quiet = (top: string): number | undefined => {
      const mine = [...this.sessions.values()].filter((s) => s.top === top);
      const placed = this.index.placed.filter((x) => x.top === top).reduce((t, x) => Math.max(t, x.at), 0);
      if (!mine.length) return now - placed >= IDLE_MS ? placed : undefined;
      if (mine.every((s) => s.ended)) return Math.max(...mine.map((s) => s.last));
      if (mine.every((s) => s.ended || (!s.open.size && now - s.last >= IDLE_MS))) return Math.max(...mine.map((s) => s.last));
      return undefined;
    };
    const candidates = this.index.placed
      .map((x) => ({ x, last: quiet(x.top) }))
      .filter((c): c is { x: Placed; last: number } => c.last !== undefined && existsSync(join(c.x.top, c.x.path)))
      .sort((a, b) => a.last - b.last);
    for (const { x } of candidates) {
      const dir = realpathSync(join(x.top, x.path));
      // The worktree, its sources and its edits are never touched: a product folder that holds a tracked file stays.
      if ((await git(x.top, ['ls-files', '-z', '--', x.path]).catch(() => 'unknown')) !== '') continue;
      if (this.o.plant !== 'reclaims-open-worktree') {
        const open = await this.o.openUnder(dir).catch(() => [{ pid: 0, command: 'unreadable' }]);
        if (open.length) continue;
      }
      const bytes = await sizeOf(dir);
      await rm(dir, { recursive: true, force: true });
      this.index.placed = this.index.placed.filter((y) => y !== x);
      this.save();
      await this.reading(this.lastSession(x.top), `DeepBuild removed ${x.path} (${x.name}) from ${x.top}, ${gb(bytes)}, to keep the volume over the ${gb(DISK_FLOOR)} disk floor; nobody works there, and its next build runs cold. Its sources and edits are as they were.`);
      return true;
    }
    // Store entries go last, least recently used first, never one a process reads.
    for (const e of [...this.index.entries].sort((a, b) => a.used - b.used)) {
      if (await this.removeEntry(e)) {
        return true;
      }
    }
    return false;
  }

  /** A reading on a session's row; none without a session. */
  private async reading(session: string | undefined, text: string): Promise<void> {
    if (session) await this.o.append('session.reading', { reading: text.slice(0, 8000) }, session).catch(() => undefined);
  }
  private lastSession(top: string): string | undefined {
    return [...this.sessions].filter(([, s]) => s.top === top).sort(([, a], [, b]) => b.last - a.last)[0]?.[0];
  }

  // ---- Sessions' calls: the store checked once a call ends.

  private seen(session: string, top: string): Seen & { top: string } {
    let s = this.sessions.get(session);
    if (!s) this.sessions.set(session, (s = { top, last: this.o.now(), ended: false, open: new Map() }));
    return s;
  }

  /** Every hook of a session: when it worked, which calls are open, and its end; a call's end checks the store. */
  hook(meta: { event: string; session: string; toolUse?: string | undefined }): void {
    const s = this.sessions.get(meta.session);
    if (!s) return;
    const now = this.o.now();
    s.last = now;
    if (meta.event === 'SessionEnd') { s.ended = true; s.open.clear(); return; }
    if (meta.event === 'SessionStart') s.ended = false;
    if (!meta.toolUse) return;
    if (meta.event === 'PreToolUse') s.open.set(meta.toolUse, now);
    else if (meta.event === 'PostToolUse' || meta.event === 'PostToolUseFailure') {
      const from = s.open.get(meta.toolUse) ?? now;
      s.open.delete(meta.toolUse);
      if (this.o.plant === 'store-writable') return;
      // The watch hears a write a moment after it lands.
      setTimeout(() => void this.claim(meta.session, meta.toolUse!, from, now).catch(() => undefined), 1500);
    }
  }

  /** The kept files that changed while the call ran: recorded on it, and each entry they're in built again. */
  private async claim(session: string, call: string, from: number, to: number): Promise<void> {
    // A file the watch named is the call's when its own change falls while the call ran: its status time, or, for a
    // file gone, when the watch heard of it. The rename that keeps a new entry is the hub's own, and changes no file's
    // status time.
    const files = [...this.changed].filter(([f, at]) => {
      const e = this.entryOf(f);
      try { const t = lstatSync(f).ctimeMs; return t >= from - 20 && t <= to + 50 && t > (e?.finished ?? 0); } catch { return at >= from && at <= to + 1500; }
    }).map(([f]) => f);
    for (const [f, at] of this.changed) if (at < this.o.now() - 60_000) this.changed.delete(f);
    if (!files.length) return;
    for (const f of files) this.changed.delete(f);
    const entries = new Map<Entry, string[]>();
    for (const f of files) {
      const e = this.entryOf(f);
      if (e) entries.set(e, [...(entries.get(e) ?? []), f]);
    }
    for (const [e, list] of entries) {
      const shown = list.slice(0, 20).map((f) => relative(this.store, f));
      await this.reading(session, `Call ${call} changed the product store, which is read-only to sessions: ${shown.join(', ')}${list.length > shown.length ? ` and ${list.length - shown.length} more` : ''} (${e.name}, key ${e.key}, under ${this.store}). The entry is built again from the default branch before any worktree receives it.`);
      // The entry is rebuilt before any worktree receives it again.
      this.removing.add(this.entryDir(e));
      try { await rm(this.entryDir(e), { recursive: true, force: true }); } finally { this.removing.delete(this.entryDir(e)); }
      this.index.entries = this.index.entries.filter((x) => x !== e);
      this.save();
      const common = this.repos.get(e.repo);
      if (common) await this.ensure(e.repo, common, { force: e.name, session });
    }
  }
}

const isLink = (p: string): boolean => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
/** The planted wrong program's placement: every file hard-linked into place. */
function hardLinks(src: string, dst: string): Promise<void> {
  mkdirSync(dst, { recursive: true });
  return new Promise((done, fail) => { execFile('/bin/pax', ['-rwl', '.', dst], { cwd: src, timeout: 120_000 }, (error) => (error ? fail(error) : done())); });
}
