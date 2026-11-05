// Shared test-side tools for #1016's acceptance tests (README): the criterion tags; the pinned Rust toolchain; a
// generated sample workspace; a world (a temp home, the hub as a process, a bin folder with the stand-ins); `deep lease`
// started as the caller starts it; a `ps` sampler that counts the compile jobs of the test's own builds every 100 ms and
// their memory once a second; the token count of the pool's named pipe, read by draining it and writing every byte back;
// and the judges. Nothing here stands in for the hub, `deep lease`, cargo or rustc: the stand-ins are only the "build"
// that holds tokens and the test runner that records its worker flag.
//
// Safety: every folder is under /tmp/dh1016-*; no network, no model; sccache is off (RUSTC_WRAPPER and
// CARGO_BUILD_RUSTC_WRAPPER empty), so builds are cold and their rustc processes real; a process a test starts is stopped
// by its PID or its process group's ID, never by name or port.

import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { availableParallelism, homedir, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';
import { allEvents, cleanEnv, CLI, failureOf, git, NODE, parseObject, REPO, sleep, type Hub, type Line } from '../18/mapping/helpers.ts';

export { failureOf, sleep, type Hub };

// ---- Criterion tags: `#1016.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #1016.b32141c1';
export const AC2 = 'AC2 #1016.33bb2666';
export const AC3 = 'AC3 #1016.4d1dc510';
export const AC4 = 'AC4 #1016.37903724';
export const AC5 = 'AC5 #1016.16cfab87';

/** The reference Mac's 12 cores, as the hub is told them (DEEP_HUB_TEST_CORES): one token per core less one is 11. */
export const CORES = 12;
export const TOKENS = CORES - 1;
/** How often the builds' processes are sampled, and their memory read. */
export const SAMPLE_MS = 100;
export const MEMORY_MS = 1000;

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

// ---- Temp folders and processes of this suite's own.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1016-'));
  made.push(dir);
  return dir;
}
const children = new Set<ChildProcess>();
/** Process groups the builds and stand-ins ran in, as the sampler and the stand-ins' log saw them. */
export const groups = new Set<number>();
const goDirs = new Set<string>();
const stopGroup = (pgid: number, signal: NodeJS.Signals) => { if (pgid > 1) try { process.kill(-pgid, signal); } catch { /* gone */ } };
/** Every go file written, every group and process this file started stopped by its ID, every folder removed. */
export async function cleanup(): Promise<void> {
  for (const dir of goDirs) try { writeFileSync(join(dir, 'all'), 'go'); } catch { /* gone */ }
  await sleep(300);
  const pids = [...children].filter((c) => c.exitCode === null && c.signalCode === null).map((c) => c.pid!);
  for (const pgid of groups) stopGroup(pgid, 'SIGTERM');
  for (const pid of pids) stopGroup(pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while ([...children].some((c) => c.exitCode === null && c.signalCode === null) && Date.now() < deadline) await sleep(50);
  for (const pgid of groups) stopGroup(pgid, 'SIGKILL');
  for (const pid of pids) stopGroup(pid, 'SIGKILL');
  children.clear();
  groups.clear();
  goDirs.clear();
  await sleep(100);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
afterAll(cleanup, 60_000);

// ---- The pinned toolchain, by its folder, so cargo and rustc are the real programs and not rustup's proxies.
export interface Toolchain { channel: string; bin: string; version: string }
let pinned: Toolchain | undefined;
export function toolchain(): Toolchain {
  if (pinned) return pinned;
  const channel = /^\s*channel\s*=\s*"([^"]+)"/m.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!channel) throw Error('BLOCKED: rust-toolchain.toml names no channel');
  let cargo: string;
  try {
    cargo = execFileSync('rustup', ['which', '--toolchain', channel, 'cargo'], { encoding: 'utf8', env: { ...process.env, RUSTUP_TOOLCHAIN: channel } }).trim();
  } catch (error) {
    throw Error(`BLOCKED: the pinned toolchain ${channel} (rust-toolchain.toml) isn't installed: ${(error as Error).message.slice(0, 300)}`);
  }
  const bin = dirname(cargo);
  const version = `${execFileSync(join(bin, 'rustc'), ['-V'], { encoding: 'utf8' }).trim()}, ${execFileSync(join(bin, 'cargo'), ['-V'], { encoding: 'utf8' }).trim()}`;
  pinned = { channel, bin, version };
  return pinned;
}

// ---- The sample workspace: many independent leaf crates, so an unlimited build runs a rustc per core at once.
export const LEAVES = 24;
const leafSource = (i: number): string => {
  let s = '';
  for (let f = 0; f < 120; f++) {
    s += `pub fn f${f}<T: Clone + core::fmt::Debug>(x: &[T]) -> Vec<String> { x.iter().cloned().map(|v| format!("{v:?}-${i}-${f}")).filter(|s| s.len() > ${f % 7}).collect() }\n`;
    s += `pub fn g${f}() -> usize { f${f}(&[${f}u64, ${i}, 3]).len() + f${f}(&["a", "b"]).len() }\n`;
  }
  return s;
};
/** Writes the workspace into `dir`: `leaf01` … `leaf24` (libraries with no dependencies) and `app`, a binary using them all. */
export function writeWorkspace(dir: string): void {
  const leaves = Array.from({ length: LEAVES }, (_, i) => `leaf${String(i + 1).padStart(2, '0')}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Cargo.toml'), `[workspace]\nmembers = [${[...leaves, 'app'].map((m) => `"${m}"`).join(', ')}]\nresolver = "2"\n`);
  leaves.forEach((name, i) => {
    mkdirSync(join(dir, name, 'src'), { recursive: true });
    writeFileSync(join(dir, name, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n`);
    writeFileSync(join(dir, name, 'src/lib.rs'), leafSource(i + 1));
  });
  mkdirSync(join(dir, 'app', 'src'), { recursive: true });
  writeFileSync(join(dir, 'app', 'Cargo.toml'), `[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n${leaves.map((l) => `${l} = { path = "../${l}" }`).join('\n')}\n`);
  writeFileSync(join(dir, 'app', 'src/main.rs'), `fn main() {\n    let n = 0${leaves.map((l) => ` + ${l}::g0()`).join('')};\n    println!("{n}");\n}\n`);
  writeFileSync(join(dir, '.gitignore'), 'target/\n');
}

// ---- The world: a home, its hub, the stand-ins.
export interface WorldOptions { cores: number; plant?: string }
export class World {
  readonly dir = tempDir();
  readonly home = join(this.dir, 'h');
  readonly bin = join(this.dir, 'bin');
  readonly root = join(this.home, '.deepbuild');
  /** Where the stand-ins write `log` and read `go/<label>`. */
  readonly runs = join(this.dir, 'runs');
  hub: Hub | undefined;
  private hubChild: ChildProcess | undefined;
  constructor(readonly o: WorldOptions) {
    mkdirSync(join(this.home, '.claude'), { recursive: true });
    mkdirSync(this.bin);
    mkdirSync(join(this.runs, 'go'), { recursive: true });
    goDirs.add(join(this.runs, 'go'));
    writeFileSync(join(this.runs, 'log'), '');
    writeFileSync(join(this.bin, 'deep'), `#!/bin/sh\nexec '${NODE}' '${CLI}' "$@"\n`, { mode: 0o755 });
    for (const role of ['holder', 'npm']) writeFileSync(join(this.bin, role), `#!/bin/sh\nexec '${NODE}' '${join(FIXTURES, 'standin.mjs')}' ${role} "$@"\n`, { mode: 0o755 });
    writeFileSync(join(this.bin, 'claude'), `#!/bin/sh\n[ "$1 $2" = "plugin list" ] && echo '[]'\nexit 0\n`, { mode: 0o755 });
  }
  /** The environment of the hub and of every `deep lease`, with `extra` on top: no jobserver of the test's own, no sccache. */
  env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    const tc = toolchain();
    return cleanEnv(this.home, {
      PATH: `${this.bin}:${tc.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`,
      SHELL: '/bin/sh',
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), '.rustup'),
      CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), '.cargo'),
      RUSTUP_TOOLCHAIN: tc.channel,
      RUSTC: join(tc.bin, 'rustc'),
      RUSTC_WRAPPER: '',
      CARGO_BUILD_RUSTC_WRAPPER: '',
      MAKEFLAGS: undefined,
      CARGO_MAKEFLAGS: undefined,
      MFLAGS: undefined,
      DH1016_DIR: this.runs,
      DEEP_HUB_TEST_CORES: String(this.o.cores),
      DEEP_HUB_PLANT: this.o.plant,
      ...extra,
    });
  }
  /** `deep hub run` for this home. A hub that doesn't start fails the test here, naming the plant when one is set. */
  async startHub(): Promise<Hub> {
    if (!existsSync(CLI)) throw Error(`BLOCKED: the deep CLI (npm run build --workspaces) is not built at ${CLI}`);
    const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: this.env(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    children.add(child);
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
  /** A git repo on `main` with `files`, and `n` worktrees of it, `wt-1` … `wt-n`. */
  repo(files: (dir: string) => void, n = 0): { repo: string; worktrees: string[] } {
    const repo = join(this.dir, 'sample');
    files(repo);
    git(this.home, repo, 'init', '-q', '-b', 'main');
    git(this.home, repo, 'add', '-A');
    git(this.home, repo, 'commit', '-q', '-m', 'Start');
    const worktrees: string[] = [];
    for (let i = 1; i <= n; i++) {
      const wt = join(this.dir, `wt-${i}`);
      git(this.home, repo, 'worktree', 'add', '-q', '-b', `b-${i}`, wt);
      worktrees.push(realpathSync(wt));
    }
    return { repo: realpathSync(repo), worktrees };
  }
  /** `deep lease <args>` as a caller starts it, in `cwd`, in a process group of its own. */
  lease(args: readonly string[], cwd: string, extra: Record<string, string> = {}): Leased {
    const child = spawn(NODE, [CLI, 'lease', ...args], { cwd, env: this.env(extra), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    children.add(child);
    let output = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => (output += d));
    child.stderr!.setEncoding('utf8').on('data', (d: string) => (output += d));
    let over = false;
    const done = new Promise<{ code: number | null; signal: string | null; ms: number }>((resolve) => child.on('exit', (code, signal) => { over = true; resolve({ code, signal, ms: Date.now() }); }));
    return { pid: child.pid!, args, output: () => output, done, finished: () => over };
  }
  /** The stand-ins' lines, in the order written. */
  marks(): Line[] {
    return readFileSync(join(this.runs, 'log'), 'utf8').split('\n').filter(Boolean).map((l) => parseObject(l)).filter((l): l is Line => Boolean(l));
  }
  mark(label: string, what: string): Line | undefined { return this.marks().find((m) => m.label === label && m.what === what); }
  /** Lets the stand-in labelled `label` give its tokens back and end. */
  go(label: string): void { writeFileSync(join(this.runs, 'go', label), 'go'); }
}
export interface Leased { pid: number; args: readonly string[]; output(): string; done: Promise<{ code: number | null; signal: string | null; ms: number }>; finished(): boolean }

/** Polls until `ok` holds or `ms` passes; returns whether it held. */
export async function until(ok: () => boolean | Promise<boolean>, ms: number, every = 100): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await ok()) return true;
    if (Date.now() > deadline) return false;
    await sleep(every);
  }
}

// ---- The repo's own entries (README, Surfaces).
export const DONE_YAML = [
  'heavy_commands:',
  '  - name: token holder',
  '    argv_prefix: [holder]',
  '    kinds: []',
  '    jobs: jobserver',
  '  - name: npm test',
  '    argv_prefix: [npm, test]',
  '    kinds: []',
  '    jobs: n',
  '    jobs_flag: --maxWorkers',
  '',
].join('\n');
/** A plain repo whose `.deepbuild/done.yaml` names the stand-in build and the test runner. */
export function entriesRepo(w: World): string {
  return w.repo((dir) => {
    mkdirSync(join(dir, '.deepbuild'), { recursive: true });
    writeFileSync(join(dir, '.deepbuild', 'done.yaml'), DONE_YAML);
    writeFileSync(join(dir, 'README.md'), '# sample\n');
  }).repo;
}

// ---- The pool as a build sees it.
/** The named pipe a jobserver flag gives: `--jobserver-auth=fifo:<path>`. */
export const fifoOf = (flags: unknown): string | undefined => (typeof flags === 'string' ? /--jobserver-auth=fifo:(\S+)/.exec(flags)?.[1] : undefined);
/** A stand-in build's join: both variables carry the same named pipe. */
export function joined(m: Line | undefined, what: string): string {
  expect(m, `${what} never reported what it was given`).toBeDefined();
  const make = fifoOf(m!.makeflags);
  const cargo = fifoOf(m!.cargo_makeflags);
  expect(make && cargo && make === cargo, `${what} must receive the pool as \`--jobserver-auth=fifo:<path>\` in both MAKEFLAGS and CARGO_MAKEFLAGS: MAKEFLAGS ${JSON.stringify(m!.makeflags ?? null)}, CARGO_MAKEFLAGS ${JSON.stringify(m!.cargo_makeflags ?? null)}`).toBe(true);
  return make!;
}
/** The tokens in the pipe now: every byte read without waiting, then each written back as it was. */
export function tokensIn(fifo: string): number {
  const fd = openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK);
  const taken: Buffer[] = [];
  try {
    for (;;) {
      const buf = Buffer.alloc(4096);
      let n = 0;
      try { n = readSync(fd, buf, 0, buf.length, null); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EAGAIN') break; throw error; }
      if (n <= 0) break;
      taken.push(buf.subarray(0, n));
    }
    const all = Buffer.concat(taken);
    if (all.length) writeSync(fd, all);
    return all.length;
  } finally {
    closeSync(fd);
  }
}

// ---- The sampler.
const LINKERS = new Set(['cc', 'clang', 'gcc', 'c++', 'clang++', 'ld', 'ld64', 'ld64.lld', 'ld.lld', 'lld', 'ld-prime']);
export interface Sample { ms: number; jobs: number; who: string[] }
export interface MemorySample { ms: number; kb: number }
export interface Sampled { samples: Sample[]; memory: MemorySample[]; stop(): Promise<void> }
/**
 * Samples `ps` every 100 ms (each sample starts once the last is read, at most every 100 ms) for the processes
 * descended from `roots`: the compile jobs (each `rustc`, and each linker with no rustc or linker above it, since a
 * linker a rustc runs is that rustc's job), and once a second their combined resident memory.
 */
export function sample(roots: readonly number[], t0 = Date.now()): Sampled {
  const samples: Sample[] = [];
  const memory: MemorySample[] = [];
  let on = true;
  let nextMemory = 0;
  const loop = (async () => {
    while (on) {
      const started = Date.now();
      const out = await new Promise<string>((resolve) => execFile('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,rss=,ucomm='], { maxBuffer: 1 << 24 }, (_e, stdout) => resolve(stdout ?? '')));
      const ms = Date.now() - t0;
      const procs = new Map<number, { ppid: number; pgid: number; rss: number; comm: string }>();
      for (const line of out.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
        if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), pgid: Number(m[3]), rss: Number(m[4]), comm: m[5]!.split('/').at(-1)! });
      }
      const mine = new Map<number, boolean>();
      const under = (pid: number): boolean => {
        if (mine.has(pid)) return mine.get(pid)!;
        const p = procs.get(pid);
        const yes = roots.includes(pid) || (p !== undefined && p.ppid > 1 && p.ppid !== pid && under(p.ppid));
        mine.set(pid, yes);
        return yes;
      };
      const job = (pid: number): boolean => {
        const p = procs.get(pid)!;
        if (p.comm === 'rustc') return true;
        if (!LINKERS.has(p.comm)) return false;
        for (let up = procs.get(p.ppid), guard = 0; up && guard < 64; up = procs.get(up.ppid), guard++) if (up.comm === 'rustc' || LINKERS.has(up.comm)) return false;
        return true;
      };
      const who: string[] = [];
      let kb = 0;
      for (const [pid, p] of procs) {
        if (roots.includes(pid) || !under(pid)) continue;
        groups.add(p.pgid);
        kb += p.rss;
        if (job(pid)) who.push(`${p.comm} ${pid}`);
      }
      samples.push({ ms, jobs: who.length, who });
      if (ms >= nextMemory) { memory.push({ ms, kb }); nextMemory = ms - (ms % MEMORY_MS) + MEMORY_MS; }
      const wait = SAMPLE_MS - (Date.now() - started);
      if (wait > 0) await sleep(wait);
    }
  })();
  return { samples, memory, stop: async () => { on = false; await loop; } };
}
export const most = (samples: readonly Sample[]): number => samples.reduce((m, s) => Math.max(m, s.jobs), 0);
export const peakMb = (memory: readonly MemorySample[]): number => Math.round(memory.reduce((m, s) => Math.max(m, s.kb), 0) / 1024);
/** The sampling's cadence as read: how many samples, and the median gap between them. */
export function cadence(samples: readonly Sample[]): string {
  const gaps = samples.slice(1).map((s, i) => s.ms - samples[i]!.ms).sort((a, b) => a - b);
  return `${samples.length} samples, median gap ${gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0} ms`;
}
/** Fails at the first sample with more compile jobs than `limit`, naming it. */
export function noSampleOver(samples: readonly Sample[], limit: number, what: string): void {
  samples.forEach((s, i) => {
    expect(s.jobs <= limit, `sample ${i + 1} of ${samples.length} (+${(s.ms / 1000).toFixed(1)} s): ${s.jobs} rustc and linker processes of ${what} ran at once (${s.who.join(', ')}), over the ${limit} tokens`).toBe(true);
  });
}

// ---- cpu.slot leases in the record, folded from lease.acquired and lease.released.
/** The record's last log position now, to read a round's leases from. */
export const logEnd = async (hub: Hub): Promise<number> => (await allEvents(hub)).reduce((m, e) => Math.max(m, e.log_pos), 0);
/** The most `cpu.slot` leases held at once, in log order, among those acquired after log position `after`. */
export async function slotsAtOnce(hub: Hub, after: number): Promise<number> {
  const open = new Set<string>();
  let most = 0;
  for (const e of [...(await allEvents(hub))].sort((a, b) => a.log_pos - b.log_pos)) {
    if (e.log_pos <= after) continue;
    if (e.kind === 'lease.acquired' && (e.data.resource as Line | undefined)?.kind === 'cpu.slot') open.add(String(e.subject ?? e.id));
    if (e.kind === 'lease.released') open.delete(String(e.subject));
    most = Math.max(most, open.size);
  }
  return most;
}

// ---- Judges.
/** Runs `assertion` against a planted wrong program: it must fail, and its message must name each of `names`. */
export async function mustFail(what: string, assertion: () => unknown, names: readonly string[]): Promise<string> {
  const message = await failureOf(assertion);
  expect(message, `${what}: the planted wrong program passed the assertion, so the assertion proves nothing`).not.toBeNull();
  for (const n of names) expect(message, `${what}: the failure must name ${n}`).toContain(n);
  return message!;
}
/** Why a timing reading here can't count: the machine's load past its cores. */
export function loaded(): string | null {
  const load = loadavg()[0]!;
  return load > availableParallelism() ? `load ${load.toFixed(1)} is past the ${availableParallelism()} cores` : null;
}
