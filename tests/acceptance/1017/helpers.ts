// Shared test-side tools for #1017's acceptance tests (README): the criterion tags; a test volume (a sparse APFS disk
// image the test makes, mounts and detaches, so free space is read off a volume nothing else writes to); a world on it
// (a temp home whose `.deepbuild` is the hub's root and so holds the product store, the hub as a process, a bin folder
// with a `claude` stub); sample repos with an `origin` the default branch is fetched from; the store as the tests see
// it; and the judges. Nothing here stands in for the hub, deep-hook, the supervisor or the store: every placement,
// build, denial and removal comes from them. The #18 mapping suite's helpers (deep-hook's build, scripted Claude Code
// sessions, the socket, `events.read`) are imported, never copied.
//
// Safety: every mount point is under /tmp/dh1017-* (a Unix socket under it must fit in 104 bytes) and every disk image
// under $TMPDIR/dh1017-img-*; a test volume is detached and its image removed after each file. No network, no model,
// no real `claude`. Cargo, rustup, uv and npm read the user's own caches (CARGO_HOME, RUSTUP_HOME, UV_CACHE_DIR), offline.
// A process a test starts is stopped by its PID, never by name or port.

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterAll, expect } from 'vitest';
import { allEvents, alive, cleanEnv, CLI, Conn, deepHook, failureOf, git, NODE, parseObject, REPO, Session, sleep, type Ev, type HookCall, type Hub, type Line } from '../18/mapping/helpers.ts';

export { allEvents, failureOf, git, NODE, REPO, Session, sleep, type Ev, type HookCall, type Hub, type Line };

// ---- Criterion tags: `#1017.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #1017.c28516b5';
export const AC2 = 'AC2 #1017.e992d16d';
export const AC3 = 'AC3 #1017.85ef10d9';
export const AC4 = 'AC4 #1017.6173fa31';
export const AC5 = 'AC5 #1017.653f197c';
export const AC6 = 'AC6 #1017.c7fa0b5b';
export const AC7 = 'AC7 #1017.abb8d808';
export const AC8 = 'AC8 #1017.15579648';

/** A GB as macOS reports disk sizes: 10^9 bytes (README, Names this suite picks). */
export const GB = 1e9;
/** The disk floor the issue proposes, per machine. */
export const FLOOR = 30 * GB;
/** The guard entry the environment ships for the store (README, Names this suite picks). */
export const GUARD = 'no-product-store-write';
/** How long a test waits for the hub to build a store entry: a cold build on a loaded machine. */
export const BUILD_WAIT_MS = 20 * 60_000;

const REAL_HOME = homedir();
const which = (cmd: string): string | undefined => {
  const r = spawnSync('/usr/bin/which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : undefined;
};
const TOOL_DIRS = [...new Set(['cargo', 'uv', 'python3'].map(which).filter((p): p is string => !!p).map(dirname))];

// ---- Folders, processes and volumes of this suite's own.
const made: string[] = [];
const children = new Set<ChildProcess>();
const volumes: Volume[] = [];
/** Every process this file started stopped by its PID, every test volume detached, every folder removed. */
export async function cleanup(): Promise<void> {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) try { child.kill('SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...children].some((c) => c.exitCode === null && c.signalCode === null) && Date.now() < deadline) await sleep(50);
  for (const child of children) if (child.exitCode === null && child.signalCode === null) try { child.kill('SIGKILL'); } catch { /* gone */ }
  children.clear();
  for (const v of volumes.splice(0)) v.detach();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
afterAll(cleanup, 120_000);

/** A child this file started and stops by its PID. */
export function own(child: ChildProcess): ChildProcess {
  children.add(child);
  return child;
}

// ---- The test volume.
/**
 * A sparse APFS disk image of `gb` GB, mounted at /tmp/dh1017-*\/v. Sparse, so the host disk holds only what is
 * written; free space on it moves only with what this test's hub, sessions and builds write.
 */
export class Volume {
  readonly mount: string;
  readonly image: string;
  readonly container: string;
  private holds: string[] = [];
  private attached = false;
  constructor(readonly gb: number) {
    const holder = realpathSync(mkdtempSync('/tmp/dh1017-'));
    made.push(holder);
    const images = mkdtempSync(join(tmpdir(), 'dh1017-img-'));
    made.push(images);
    this.image = join(images, 'v.sparseimage');
    this.mount = join(holder, 'v');
    mkdirSync(this.mount);
    try {
      execFileSync('hdiutil', ['create', '-quiet', '-size', `${gb}g`, '-type', 'SPARSE', '-fs', 'APFS', '-volname', 'dh1017', this.image], { stdio: 'pipe' });
      execFileSync('hdiutil', ['attach', '-quiet', '-nobrowse', '-noverify', '-mountpoint', this.mount, this.image], { stdio: 'pipe' });
    } catch (e) {
      throw Error(`BLOCKED: can't make the test volume (hdiutil): ${(e as Error).message}`);
    }
    this.attached = true;
    volumes.push(this);
    const info = execFileSync('diskutil', ['info', '-plist', this.mount], { encoding: 'utf8' });
    const container = /<key>APFSContainerReference<\/key>\s*<string>(disk\d+)<\/string>/.exec(info)?.[1];
    if (!container) throw Error(`BLOCKED: the test volume at ${this.mount} names no APFS container`);
    this.container = container;
  }
  /** The volume's free space in bytes, as a program sees it (statfs: blocks available to a user), after a sync. */
  free(): number {
    execFileSync('/bin/sync');
    const s = statfsSync(this.mount);
    return s.bavail * s.bsize;
  }
  /** Holds free space at `bytes` with a second APFS volume in the container that reserves the difference: nothing is written. */
  holdFreeAt(bytes: number): void {
    this.release();
    const over = Math.floor(this.free() - bytes);
    if (over <= 0) throw Error(`BLOCKED: the test volume has ${this.free()} bytes free, already under ${bytes}`);
    const out = execFileSync('diskutil', ['apfs', 'addVolume', this.container, 'APFS', 'dh1017hold', '-reserve', `${over}B`, '-nomount'], { encoding: 'utf8' });
    const dev = /Created new APFS Volume (disk\d+s\d+)/.exec(out)?.[1];
    if (!dev) throw Error(`BLOCKED: diskutil didn't add the reserving volume: ${out}`);
    this.holds.push(dev);
  }
  release(): void {
    for (const dev of this.holds.splice(0)) try { execFileSync('diskutil', ['apfs', 'deleteVolume', dev], { stdio: 'pipe' }); } catch { /* the image goes anyway */ }
  }
  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    for (const args of [['detach', this.mount, '-quiet'], ['detach', this.mount, '-force', '-quiet']]) {
      try { execFileSync('hdiutil', args, { stdio: 'pipe', timeout: 60_000 }); return; } catch { /* busy: force next */ }
    }
  }
}

// ---- The world: a home on the test volume, its hub, and the sessions in it.
export interface WorldOptions {
  /** DEEP_HUB_PLANT for the hub and every hook (README, Plants). */
  plant?: string | undefined;
  /** The test volume's size in GB; it must leave more than the 30 GB floor free. */
  gb?: number;
  /** Extra variables for the hub, the hooks and every command a test runs. */
  env?: Record<string, string>;
}
export interface Ran { code: number | null; out: string; ms: number }
export class World {
  readonly vol: Volume;
  readonly dir: string;
  readonly home: string;
  readonly root: string;
  readonly bin: string;
  hub: Hub | undefined;
  private hubChild: ChildProcess | undefined;
  private trusted = new Set<string>();
  constructor(readonly o: WorldOptions = {}) {
    this.vol = new Volume(o.gb ?? 64);
    this.dir = this.vol.mount;
    this.home = join(this.dir, 'h');
    this.root = join(this.home, '.deepbuild');
    this.bin = join(this.dir, 'bin');
    mkdirSync(join(this.home, '.claude'), { recursive: true });
    mkdirSync(this.bin);
    // The hub reads each session's Claude Code home with `claude plugin list --json`: a home with no plugins.
    writeFileSync(join(this.bin, 'claude'), `#!/bin/sh\n[ "$1 $2" = "plugin list" ] && echo '[]'\nexit 0\n`, { mode: 0o755 });
  }
  /** The environment of the hub, of every hook and of every command a test runs, with `extra` on top. */
  env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return cleanEnv(this.home, {
      PATH: [this.bin, dirname(NODE), ...TOOL_DIRS, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
      SHELL: '/bin/sh',
      // A temporary HOME would leave rustup, Cargo and uv without their toolchains and caches: theirs stay put, offline.
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(REAL_HOME, '.rustup'),
      CARGO_HOME: process.env.CARGO_HOME ?? join(REAL_HOME, '.cargo'),
      CARGO_NET_OFFLINE: 'true',
      CARGO_TARGET_DIR: undefined,
      CARGO_BUILD_TARGET_DIR: undefined,
      // The user's Cargo config sends every build through sccache, a daemon shared with other sessions: not here.
      RUSTC_WRAPPER: '',
      UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? join(REAL_HOME, '.cache', 'uv'),
      UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR ?? join(REAL_HOME, '.local', 'share', 'uv', 'python'),
      UV_OFFLINE: '1',
      UV_PYTHON_DOWNLOADS: 'never',
      // The cache is on another volume, so uv would copy anyway; said, so it doesn't warn.
      UV_LINK_MODE: 'copy',
      VIRTUAL_ENV: undefined,
      npm_config_update_notifier: 'false',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      DEEP_HUB_PLANT: this.o.plant,
      ...this.o.env,
      ...extra,
    });
  }
  /** `deep hub run` for this home. A hub that doesn't start fails the test here, naming the plant when one is set. */
  async startHub(): Promise<Hub> {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
    await deepHook();
    const child = own(spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'], detached: true }));
    let err = '';
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
    const ready = await new Promise<Line | undefined>((resolve) => {
      let first = '';
      const timer = setTimeout(() => resolve(undefined), 120_000);
      child.stdout!.setEncoding('utf8').on('data', (d: string) => { first += d; if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)); } });
      child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
    });
    if (!ready || ready.ready !== true) {
      expect.fail(`the hub didn't start${this.o.plant ? ` with DEEP_HUB_PLANT=${this.o.plant} (the planted wrong program this test runs against)` : ''}: ${err.slice(0, 1500)}`);
    }
    this.hubChild = child;
    this.hub = { home: this.home, root: this.root, socket: String(ready!.socket), pid: child.pid!, ...(this.o.plant ? { plant: this.o.plant } : {}), stderr: () => err };
    return this.hub;
  }
  /** Stops the hub by its PID and waits for it to exit. */
  async stopHub(): Promise<void> {
    const child = this.hubChild;
    if (!child) return;
    try { process.kill(child.pid!, 'SIGTERM'); } catch { /* gone */ }
    const deadline = Date.now() + 30_000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(50);
    if (child.exitCode === null && child.signalCode === null) try { process.kill(child.pid!, 'SIGKILL'); } catch { /* gone */ }
    this.hub = undefined;
    this.hubChild = undefined;
  }
  /** The hub stopped and the volume detached: called at the end of each scenario, so the next one starts on its own volume. */
  async close(): Promise<void> {
    await this.stopHub();
    this.vol.release();
    this.vol.detach();
  }
  /** Marks folders trusted as the base reads trust: Claude Code's workspace trust in `~/.claude.json` (README). */
  trust(...paths: string[]): void {
    for (const p of paths) { this.trusted.add(p); try { this.trusted.add(realpathSync(p)); } catch { /* as given */ } }
    const projects = Object.fromEntries([...this.trusted].map((p) => [p, { hasTrustDialogAccepted: true }]));
    writeFileSync(join(this.home, '.claude.json'), JSON.stringify({ projects }, null, 2));
  }
  /** A scripted Claude Code session in `cwd` (the #18 mapping suite's), its hooks run with this world's environment. */
  session(cwd: string): Session {
    return new Session(this.home, { cwd, env: this.env({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd }) });
  }
  /** Runs a command to its end in `cwd` with this world's environment: its exit, its output (stdout and stderr together) and its wall time. */
  run(cmd: string, args: readonly string[], cwd: string, timeoutMs = 3_600_000): Ran {
    const t0 = performance.now();
    const r = spawnSync('/bin/sh', ['-c', '"$0" "$@" 2>&1', cmd, ...args], { cwd, env: this.env(), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1 << 28 });
    return { code: r.status, out: String(r.stdout ?? ''), ms: performance.now() - t0 };
  }
  /** As `run`, throwing BLOCKED when the fixture's own tool can't do what it does today. */
  must(cmd: string, args: readonly string[], cwd: string, timeoutMs?: number): Ran {
    const r = this.run(cmd, args, cwd, timeoutMs);
    if (r.code !== 0) throw Error(`BLOCKED: \`${cmd} ${args.join(' ')}\` in ${cwd} exited ${r.code}: ${r.out.slice(-2000)}`);
    return r;
  }
  git(cwd: string, ...args: string[]): string { return git(this.home, cwd, ...args); }
}

// ---- Sample repos: a main checkout with an `origin`, whose default branch is `origin/main` as last fetched.
export type Files = Record<string, string | Buffer>;
export function writeFiles(dir: string, files: Files): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
}
/** `<dir>/<name>`: a repo on `main` holding `files`, pushed to `<dir>/<name>.git` and fetched back, `origin/HEAD` at `origin/main`. */
export function makeRepo(w: World, name: string, files: Files): string {
  const bare = join(w.dir, `${name}.git`);
  const repo = join(w.dir, name);
  mkdirSync(repo);
  writeFiles(repo, files);
  w.git(w.dir, 'init', '-q', '--bare', '-b', 'main', bare);
  w.git(repo, 'init', '-q', '-b', 'main');
  w.git(repo, 'add', '-A');
  w.git(repo, 'commit', '-q', '-m', 'Start');
  w.git(repo, 'remote', 'add', 'origin', bare);
  w.git(repo, 'push', '-q', '-u', 'origin', 'main');
  w.git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  return realpathSync(repo);
}
/** Commits `files` on `main` in the main checkout, pushes and fetches, so the default branch as last fetched moves. */
export function advanceMain(w: World, repo: string, files: Files, message: string): void {
  writeFiles(repo, files);
  w.git(repo, 'add', '-A');
  w.git(repo, 'commit', '-q', '-m', message);
  w.git(repo, 'push', '-q', 'origin', 'main');
  w.git(repo, 'fetch', '-q', 'origin');
}
/** A branch `branch` off `origin/main` holding `files`, committed in the main checkout, which goes back to `main`. */
export function branchWith(w: World, repo: string, branch: string, files: Files, message: string): void {
  w.git(repo, 'checkout', '-q', '-b', branch, 'origin/main');
  writeFiles(repo, files);
  w.git(repo, 'add', '-A');
  w.git(repo, 'commit', '-q', '-m', message);
  w.git(repo, 'checkout', '-q', 'main');
}
/** `git worktree add` as an agent or its harness makes one: `<dir>/<name>` on a new branch from `from`, or on `branch` as it is. */
export function worktree(w: World, repo: string, name: string, o: { from?: string; branch?: string } = {}): string {
  const path = join(w.dir, name);
  if (o.branch) w.git(repo, 'worktree', 'add', '-q', path, o.branch);
  else w.git(repo, 'worktree', 'add', '-q', '-b', `b-${name}`, path, o.from ?? 'origin/main');
  return realpathSync(path);
}

/** `environment.products[]` (issue, Fields). */
export interface Product { name: string; path: string; key: string[]; key_values: string[]; build: string }
/**
 * `.deepbuild/done.yaml` with an environment that lists `products`. Written as JSON, which YAML reads as it is. The
 * environment also names `up`, `ports` and `ready`, which the base's environment reader requires; nothing starts it.
 */
export function doneYaml(products: Product[]): string {
  return `${JSON.stringify({ environment: { up: 'true', ports: ['web'], ready: { http: 'http://127.0.0.1:${web}/health' }, products } }, null, 2)}\n`;
}
export const TARGET: Product = { name: 'target', path: 'target', key: ['Cargo.lock', 'rust-toolchain.toml'], key_values: ['rustc --version'], build: 'cargo build --workspace --locked' };
export const NODE_MODULES: Product = { name: 'node_modules', path: 'node_modules', key: ['package-lock.json'], key_values: ['node --version'], build: 'npm ci' };
export const VENV: Product = { name: 'venv', path: '.venv', key: ['uv.lock', '.python-version'], key_values: ['uv --version'], build: 'uv sync --frozen' };

// ---- Fixture bodies, made once per test process from the user's caches, offline.
const toolchain = (): string => /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1] ?? 'stable';
/** The 3 workspace crates of the Cargo sample. `paths` bakes CARGO_MANIFEST_DIR in with `env!`, in its library, its test and its `where` binary. */
export const CRATES = ['app', 'cart', 'paths'];
function cargoSources(): Files {
  return {
    'Cargo.toml': '[workspace]\nmembers = ["cart", "paths", "app"]\nresolver = "2"\n',
    'rust-toolchain.toml': `[toolchain]\nchannel = "${toolchain()}"\n`,
    'cart/Cargo.toml': '[package]\nname = "cart"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nserde = { version = "1", features = ["derive"] }\nserde_json = "1"\nimage = "0.25"\n',
    'cart/src/lib.rs': 'pub fn total(items: &[u32]) -> u32 { items.iter().sum() }\n',
    'paths/Cargo.toml': '[package]\nname = "paths"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\nregex = "1"\ntoml = "0.8"\nchrono = "0.4"\n',
    'paths/src/lib.rs': 'pub const DIR: &str = env!("CARGO_MANIFEST_DIR");\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn dir() { assert!(super::DIR.ends_with("paths")); println!("{}", super::DIR); }\n}\n',
    'paths/src/bin/where.rs': 'fn main() { println!("{}", paths::DIR); }\n',
    'app/Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\ncart = { path = "../cart" }\npaths = { path = "../paths" }\ntokio = { version = "1", features = ["full"] }\nhyper = { version = "1", features = ["full"] }\nrayon = "1"\nrand = "0.8"\nanyhow = "1"\n',
    'app/src/main.rs': 'fn main() { println!("{} {}", cart::total(&[1, 2]), paths::DIR); }\n',
  };
}
let cargoLock: string | undefined;
/** The Cargo sample's lockfile, resolved offline from the user's Cargo cache; BLOCKED when that can't give 120 dependencies. */
function lockCargo(w: World): string {
  if (cargoLock) return cargoLock;
  const dir = join(w.dir, 'lock-cargo');
  writeFiles(dir, cargoSources());
  w.must('cargo', ['generate-lockfile', '--offline'], dir, 600_000);
  const lock = readFileSync(join(dir, 'Cargo.lock'), 'utf8');
  const deps = (lock.match(/^name = /gm) ?? []).length - CRATES.length;
  if (deps < 120) throw Error(`BLOCKED: the Cargo cache resolves the sample's crates to only ${deps} dependencies, not over 120`);
  rmSync(dir, { recursive: true, force: true });
  return (cargoLock = lock);
}
/** A package tarball as npm packs one: `package/package.json` and `package/index.js`, made once per version. */
const tarballs = new Map<string, Buffer>();
function padTarball(w: World, version: string): Buffer {
  const cached = tarballs.get(version);
  if (cached) return cached;
  const dir = join(w.dir, `pad-${version}`);
  writeFiles(dir, {
    'package/package.json': JSON.stringify({ name: 'dh-pad', version, main: 'index.js' }),
    'package/index.js': `module.exports = (s, n) => String(s).padStart(n, '0');\nmodule.exports.version = '${version}';\n`,
  });
  execFileSync('tar', ['-czf', join(dir, 'p.tgz'), '-C', dir, 'package']);
  const bytes = readFileSync(join(dir, 'p.tgz'));
  rmSync(dir, { recursive: true, force: true });
  tarballs.set(version, bytes);
  return bytes;
}
/**
 * The npm sample: a workspace (`packages/lib`, `@shop/lib`) with one dependency, `dh-pad`, from a tarball in the repo
 * (`vendor/`), so `npm ci` needs no registry; `npm test` runs node's test runner, which needs both installed.
 */
export function npmFiles(w: World, padVersion = '1.0.0'): Files {
  const files: Files = {
    'package.json': `${JSON.stringify({ name: 'shop', private: true, workspaces: ['packages/*'], scripts: { test: 'node --test' }, dependencies: { 'dh-pad': `file:vendor/dh-pad-${padVersion}.tgz` } }, null, 2)}\n`,
    'packages/lib/package.json': `${JSON.stringify({ name: '@shop/lib', version: '0.1.0', main: 'index.js' })}\n`,
    'packages/lib/index.js': "const pad = require('dh-pad');\nexports.id = (n) => pad(n, 4);\n",
    'lib.test.js': `const test = require('node:test');\nconst assert = require('node:assert');\ntest('id', () => assert.equal(require('@shop/lib').id(7), '0007'));\ntest('pad', () => assert.equal(require('dh-pad').version, '${padVersion}'));\n`,
    [`vendor/dh-pad-${padVersion}.tgz`]: padTarball(w, padVersion),
  };
  const dir = join(w.dir, `lock-npm-${padVersion}`);
  writeFiles(dir, files);
  w.must('npm', ['install', '--package-lock-only', '--offline', '--no-audit', '--no-fund'], dir, 300_000);
  files['package-lock.json'] = readFileSync(join(dir, 'package-lock.json'), 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return files;
}
/** AC1's sample: a Cargo workspace of 3 crates over 120 dependencies, plus an npm workspace, both products declared. */
export function cargoNpmFiles(w: World): Files {
  return {
    ...cargoSources(),
    'Cargo.lock': lockCargo(w),
    ...npmFiles(w),
    '.gitignore': 'target/\nnode_modules/\n',
    '.deepbuild/done.yaml': doneYaml([TARGET, NODE_MODULES]),
  };
}
let uvLock: string | undefined;
/** AC2's sample: a uv project (`uv.lock`, `.python-version`) whose packages come from the user's uv cache, offline. */
export function pythonFiles(w: World): Files {
  const files: Files = {
    'pyproject.toml': '[project]\nname = "shop"\nversion = "0.1.0"\nrequires-python = ">=3.13"\ndependencies = ["lxml", "attrs", "click", "httpx", "pygments"]\n',
    '.python-version': '3.13\n',
    'test_shop.py': 'import unittest\n\nimport attrs\nimport lxml.etree\n\n\nclass Shop(unittest.TestCase):\n    def test_xml(self):\n        self.assertEqual(lxml.etree.fromstring("<a>1</a>").text, "1")\n',
    '.gitignore': '.venv/\n__pycache__/\n',
    '.deepbuild/done.yaml': doneYaml([VENV]),
  };
  if (!uvLock) {
    const dir = join(w.dir, 'lock-uv');
    writeFiles(dir, files);
    w.must('uv', ['lock', '--offline'], dir, 300_000);
    uvLock = readFileSync(join(dir, 'uv.lock'), 'utf8');
    rmSync(dir, { recursive: true, force: true });
  }
  return { ...files, 'uv.lock': uvLock };
}

// ---- What the hub says and records.
/** What a SessionStart (or any hook) reply hands the agent: its additionalContext, else its stdout. */
export function contextOf(h: HookCall): string {
  const reply = parseObject(h.ran.stdout.trim());
  return String(reply?.hookSpecificOutput?.additionalContext ?? reply?.systemMessage ?? h.ran.stdout);
}
export interface Decision { denied: boolean; reason: string }
/** What a PreToolUse reply decided: a deny (exit 2, `permissionDecision: deny` or `decision: block`) with its reason. */
export function decisionOf(h: HookCall): Decision {
  const reply = parseObject(h.ran.stdout.trim());
  if (h.ran.code === 2) return { denied: true, reason: h.ran.stderr.trim() };
  if (reply?.hookSpecificOutput?.permissionDecision === 'deny') return { denied: true, reason: String(reply.hookSpecificOutput.permissionDecisionReason ?? '') };
  if (reply?.decision === 'block') return { denied: true, reason: String(reply.reason ?? '') };
  return { denied: false, reason: '' };
}
export const shownHook = (h: HookCall): string => `exit ${h.ran.code}, stdout ${JSON.stringify(h.ran.stdout.slice(0, 600))}, stderr ${JSON.stringify(h.ran.stderr.slice(0, 600))}`;

/** One socket call with the control token. */
export async function rpc(hub: Hub, method: string, params: unknown = {}, timeoutMs = 60_000): Promise<Line> {
  const conn = await Conn.open(hub.socket);
  try {
    await conn.hello(readFileSync(join(hub.root, 'control.token'), 'utf8').trim());
    return await conn.call(method, params, timeoutMs);
  } finally {
    conn.close();
  }
}
/** The record's `product.built` events for a product, by its name (README, Names this suite picks). */
export async function builtEvents(hub: Hub, product: string): Promise<Ev[]> {
  return (await allEvents(hub)).filter((e) => e.kind === 'product.built' && e.data?.product === product);
}
/** Waits until the record holds a `product.built` after log position `after` for each of `products`; fails naming those that never did, by name and path. */
export async function waitBuilt(w: World, products: readonly Product[], o: { after?: number; ms?: number } = {}): Promise<Ev[]> {
  const deadline = Date.now() + (o.ms ?? BUILD_WAIT_MS);
  for (;;) {
    const found = await Promise.all(products.map(async (p) => (await builtEvents(w.hub!, p.name)).find((e) => e.log_pos > (o.after ?? 0))));
    if (found.every(Boolean)) return found as Ev[];
    if (Date.now() > deadline) {
      const missing = products.filter((_, i) => !found[i]).map((p) => `${p.name} (${p.path})`);
      expect.fail(`the hub never recorded a product.built for ${missing.join(', ')} within ${Math.round((o.ms ?? BUILD_WAIT_MS) / 60_000)} min of a session's start in the repo; the store holds: ${storeListing(w)}`);
    }
    await sleep(2000);
  }
}
export const logEnd = async (hub: Hub): Promise<number> => (await allEvents(hub)).at(-1)?.log_pos ?? 0;

// ---- The store, as the tests see it: `~/.deepbuild/products/`, each kept entry a folder named as its product's path.
export const storeRoot = (w: World): string => join(w.root, 'products');
/** Every kept entry of a product: folders under the store named as the product's `path` (its last part), none inside another. */
export function keptEntries(w: World, path: string): string[] {
  const base = path.split('/').at(-1)!;
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) return;
    let names: string[];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const at = join(dir, name);
      const st = lstatSync(at, { throwIfNoEntry: false });
      if (!st?.isDirectory()) continue;
      if (name === base) found.push(at);
      else walk(at, depth + 1);
    }
  };
  walk(storeRoot(w), 0);
  return found;
}
function storeListing(w: World): string {
  if (!existsSync(storeRoot(w))) return `nothing (no ${storeRoot(w)})`;
  const top: string[] = [];
  const walk = (dir: string, depth: number): void => {
    for (const name of readdirSync(dir)) {
      const at = join(dir, name);
      top.push(relative(storeRoot(w), at));
      if (depth < 2 && lstatSync(at).isDirectory()) walk(at, depth + 1);
    }
  };
  walk(storeRoot(w), 0);
  return top.slice(0, 40).join(', ') || 'nothing';
}
/** Each file, folder and link under `dir`: its size, modification time, inode and, for a link, where it points. */
export type Tree = Map<string, { size: number; mtimeMs: number; ino: number; link?: string }>;
export function tree(dir: string): Tree {
  const out: Tree = new Map();
  const walk = (at: string): void => {
    const st = lstatSync(at, { throwIfNoEntry: false });
    if (!st) return;
    out.set(at, { size: st.isDirectory() ? 0 : st.size, mtimeMs: st.isDirectory() ? 0 : st.mtimeMs, ino: st.ino, ...(st.isSymbolicLink() ? { link: readlinkSync(at) } : {}) });
    if (st.isDirectory()) for (const name of readdirSync(at)) walk(join(at, name));
  };
  walk(dir);
  return out;
}
/** The paths whose file changed, appeared or went between two readings of a tree, in path order. */
export function changedPaths(before: Tree, after: Tree): string[] {
  const out = new Set<string>();
  for (const [p, a] of before) {
    const b = after.get(p);
    if (!b || b.size !== a.size || b.mtimeMs !== a.mtimeMs || b.ino !== a.ino || b.link !== a.link) out.add(p);
  }
  for (const p of after.keys()) if (!before.has(p)) out.add(p);
  return [...out].sort();
}
/** The digest of every file a worktree's git sees as its own (tracked, edited or untracked, ignored left out): its sources and uncommitted edits. */
export function sourceDigests(w: World, wt: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of w.git(wt, 'ls-files', '-co', '--exclude-standard', '-z').split('\0').filter(Boolean)) {
    const at = join(wt, p);
    out.set(p, existsSync(at) ? createHash('sha256').update(readFileSync(at)).digest('hex') : 'missing');
  }
  return out;
}
/** The crates a cargo build compiled, from its `Compiling <name> v<version>` lines. */
export const compiled = (out: string): string[] => [...new Set([...out.matchAll(/^\s*Compiling (\S+) v/gm)].map((m) => m[1]!))].sort();
/** The free space a reading names, in GB, for the log. */
export const gb = (bytes: number): string => `${(bytes / GB).toFixed(3)} GB`;

/** A test process that holds `file` open (`tail -f`), stopped by its PID after the file. */
export function holdOpen(file: string): number {
  const child = own(spawn('/usr/bin/tail', ['-f', file], { stdio: 'ignore' }));
  return child.pid!;
}
export const running = (pid: number): boolean => alive(pid);

// ---- Judges.
/** Runs `scenario` against a planted wrong program: it must fail, and its message must name each of `names`. */
export async function mustFail(what: string, scenario: () => unknown, names: readonly (string | RegExp)[]): Promise<string> {
  const message = await failureOf(scenario);
  console.log(`${what}: ${message ?? 'passed'}`);
  expect(message, `${what}: the planted wrong program passed, so the test proves nothing`).not.toBeNull();
  for (const n of names) {
    if (typeof n === 'string') expect(message, `${what}: the failure must name ${n}`).toContain(n);
    else expect(message, `${what}: the failure must name ${n}`).toMatch(n);
  }
  return message!;
}
/** Free space on the host disk, where a sparse test volume's bytes really go. */
export function hostFree(): number {
  const s = statfsSync(tmpdir());
  return s.bavail * s.bsize;
}

// ---- AC1 and AC2: a second worktree made from the default branch.
export interface Toolchain {
  /** What the criterion calls it, for the log. */
  name: string;
  files(w: World): Files;
  products: Product[];
  /** The first worktree's builds as they run today, with no store: their disk is what the second worktree's is held to. */
  cold(w: World, wt: string): void;
  /** The second worktree's first build. */
  firstBuild(w: World, wt: string): Ran;
  /** What the criterion asks of that build and of the tests after it, asserted. */
  after(w: World, wt: string, build: Ran): void;
}
/**
 * The scenario of AC1 and AC2, against the hub as built or the planted wrong program `plant`. A sample repo on a test
 * volume; its first worktree made and built as today, before the hub knows the repo, and the volume's free space read
 * before and after; a session there, which tells the hub of the repo; the store's entries built; then a second
 * worktree made from the default branch and its session's start, after which every product must be in place, before
 * the session's first prompt, its disk under 5% of the first worktree's; its first build must change nothing in the
 * store, and do only what the criterion says.
 */
export async function secondWorktree(tag: string, t: Toolchain, plant?: string): Promise<void> {
  const w = new World({ plant });
  try {
    await w.startHub();
    const repo = makeRepo(w, 'shop', t.files(w));
    const f0 = w.vol.free();
    const first = worktree(w, repo, 'wt-1');
    t.cold(w, first);
    const firstAdded = f0 - w.vol.free();
    console.log(`${tag} the first worktree, built as today: the volume's free space ${gb(f0)} before, ${gb(f0 - firstAdded)} after: it added ${gb(firstAdded)}`);
    w.trust(repo, first);
    const s1 = w.session(first);
    await s1.start();
    await s1.prompt('Build it and run the tests.');
    await waitBuilt(w, t.products);
    const entries = t.products.flatMap((p) => keptEntries(w, p.path));
    const store = new Map(entries.map((e) => [e, tree(e)]));
    console.log(`${tag} the store's entries: ${entries.join(', ') || 'none'}`);

    const f2 = w.vol.free();
    const second = join(w.dir, 'wt-2');
    w.trust(second);
    worktree(w, repo, 'wt-2');
    const s2 = w.session(second);
    const started = await s2.start();
    const missing = t.products.filter((p) => !existsSync(join(second, p.path))).map((p) => p.path);
    const f3 = w.vol.free();
    const added = f2 - f3;
    console.log(`${tag} the second worktree: free space ${gb(f2)} before it was made, ${gb(f3)} once its session started: it added ${gb(added)}, ${((100 * added) / firstAdded).toFixed(2)}% of the first worktree's; in place: ${t.products.map((p) => `${p.path} ${existsSync(join(second, p.path)) ? 'yes' : 'no'}`).join(', ')}`);
    expect(missing, `${t.name}: the second worktree, made from the default branch, must have ${missing.join(' and ')} in place before its session's first prompt; its session start said: ${JSON.stringify(contextOf(started).slice(0, 800))}`).toEqual([]);
    expect(added, `${t.name}: until its first edit, the second worktree must add under 5% of the disk the first one did (${gb(firstAdded)}); it added ${gb(added)}`).toBeLessThan(0.05 * firstAdded);

    await s2.prompt('Build it and run the tests.');
    const build = t.firstBuild(w, second);
    console.log(`${tag} the second worktree's first build log (exit ${build.code}, ${(build.ms / 1000).toFixed(1)} s):\n${build.out.slice(-4000)}`);
    const changed = [...store].flatMap(([e, before]) => changedPaths(before, tree(e)));
    expect(changed, `${t.name}: a build in the second worktree changed the store: ${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ` and ${changed.length - 5} more` : ''}`).toEqual([]);
    t.after(w, second, build);
  } finally {
    await w.close();
  }
}
