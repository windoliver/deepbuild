// Shared test-side tools for #1411's acceptance tests (README): the criterion tags; a world whose memory-pressure level
// the test scripts through #1015's test seam (DEEP_TEST_MEMORY_PRESSURE_FILE), built on #1016's world (the hub as a
// process, `deep lease`, the pipe's count and the ps sampler, imported, never changed); the stand-in build's readings of
// the tokens out over time; the pool's changes counted from them; and a cargo workspace for the real build. Nothing here
// stands in for the hub, `deep lease`, the pool, cargo or rustc.
//
// Safety: folders are #1016's, under /tmp/dh1016-*, removed after each file; every process a test starts is stopped by
// its PID or process group's ID (#1016's cleanup, which also writes every go file so the stand-ins end on their own).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { NODE, type Line } from '../18/mapping/helpers.ts';
import { groups, sleep, until, World as PoolWorld, type Leased, type WorldOptions } from '../1016/helpers.ts';

export { sleep, until, type Line };

// ---- Criterion tags: `#1411.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #1411.5cf27caa';
export const AC2 = 'AC2 #1411.a9c42261';
export const AC3 = 'AC3 #1411.36f7169d';
export const AC4 = 'AC4 #1411.50e54eec';

/** The issue's 8 tokens: the hub is told 9 cores (DEEP_HUB_TEST_CORES), one token per core less one (#1016). */
export const CORES = 9;
export const TOKENS = 8;
/** The most that may be out once running jobs return theirs: half the 8 at warn, all but one at critical. */
export const OUT_AT = { warn: 4, critical: 1 } as const;
/** The longest any of the stand-in build's jobs runs before it gives its token back (100 to 300 ms each). */
const JOB_MS = 300;
/** "Once running jobs return theirs" (README, Open points 3): a bound is reached within 15 s of the level's change… */
const SETTLE_MS = 15_000;
/** …and then holds for 5 s. */
const HOLD_MS = 5_000;
/** The hysteresis window is read as 5 s to 60 s (README, Open points 4): back at normal, all 8 are out within 70 s. */
export const RESTORE_MS = 70_000;

type Level = 'normal' | 'warn' | 'critical';
const STANDIN = fileURLToPath(new URL('./fixtures/standin.mjs', import.meta.url));

/** #1016's world with the memory-pressure level the hub reads written by the test, and #1411's stand-ins on PATH. */
export class World extends PoolWorld {
  readonly pressureFile = join(this.dir, 'memory-pressure');
  /** The scripted pressure source: each level the test set, and when. */
  readonly script: { ms: number; level: Level }[] = [];
  constructor(o: WorldOptions) {
    super(o);
    this.setLevel('normal');
    for (const role of ['jobbuild', 'steadyrun']) writeFileSync(join(this.bin, role), `#!/bin/sh\nexec '${NODE}' '${STANDIN}' ${role} "$@"\n`, { mode: 0o755 });
  }
  override env(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
    return super.env({ DEEP_TEST_MEMORY_PRESSURE_FILE: this.pressureFile, DH1411_DIR: this.runs, ...extra });
  }
  /** The level the hub reads, written whole: a new file renamed over the old, so no read sees it half written. */
  setLevel(level: Level): void {
    writeFileSync(`${this.pressureFile}.new`, `${level}\n`);
    renameSync(`${this.pressureFile}.new`, this.pressureFile);
    this.script.push({ ms: Date.now(), level });
  }
  /** A stand-in's lines (fixtures/standin.mjs), in the order written. */
  lines(label: string): Line[] {
    const file = join(this.runs, `${label}.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as Line]; } catch { return []; } });
  }
  first(label: string, what: string): Line | undefined { return this.lines(label).find((l) => l.what === what); }
}

// ---- The repo's own entries: the stand-in build takes its jobs from the pool; the runner has a fixed job count.
const DONE_YAML = [
  'heavy_commands:',
  '  - name: jobbuild',
  '    argv_prefix: [jobbuild]',
  '    kinds: []',
  '    jobs: jobserver',
  '  - name: steadyrun',
  '    argv_prefix: [steadyrun]',
  '    kinds: []',
  '    jobs: 3',
  '',
].join('\n');
export function entriesRepo(w: World): string {
  return w.repo((dir) => {
    mkdirSync(join(dir, '.deepbuild'), { recursive: true });
    writeFileSync(join(dir, '.deepbuild', 'done.yaml'), DONE_YAML);
    writeFileSync(join(dir, 'README.md'), '# sample\n');
  }).repo;
}

// ---- The tokens out, as the stand-in build reads them.
export interface Reading { ms: number; held: number; running: number; done: number }
export const readings = (w: World, label = 'build'): Reading[] => w.lines(label).filter((l) => l.what === 'jobs') as Reading[];
/**
 * The tokens out while the build runs (README, Open points 1): those its jobs read from the pipe, and the one the hub
 * took for its first job (#1016). The pipe itself is empty at each reading: the build has just taken every free token.
 */
const out = (r: Reading): number => r.held + 1;
export const outNow = (w: World, label = 'build'): number | undefined => {
  const last = readings(w, label).at(-1);
  return last ? out(last) : undefined;
};

/** `deep lease -- jobbuild` in the repo, and whether all 8 tokens were out at normal (7 it read and its first job's). */
export async function startBuild(w: World, repo: string, extra: Record<string, string> = {}): Promise<{ build: Leased; full: boolean; fifo: string | null }> {
  const build = w.lease(['--', 'jobbuild'], repo, { DH1411_LABEL: 'build', ...extra });
  await until(() => outNow(w) === TOKENS || build.finished(), 120_000);
  const joined = w.first('build', 'joined');
  if (joined) groups.add(Number(joined.pgid));
  return { build, full: outNow(w) === TOKENS, fifo: (joined?.fifo as string | null | undefined) ?? null };
}
/** The build given the pool: its joined line names the pool's pipe. */
export function joinedPool(w: World, build: Leased): void {
  const joined = w.first('build', 'joined');
  expect(joined?.fifo, `\`deep lease -- jobbuild\` (a \`jobs: jobserver\` entry) must give the build the pool as \`--jobserver-auth=fifo:<path>\` in MAKEFLAGS or CARGO_MAKEFLAGS: it was given MAKEFLAGS ${JSON.stringify(joined?.makeflags ?? null)}, CARGO_MAKEFLAGS ${JSON.stringify(joined?.cargo_makeflags ?? null)}: ${build.output().slice(-600)}`).toBeTruthy();
}
export function fullAtNormal(w: World, full: boolean): void {
  expect(full, `at \`normal\`, the build must have all ${TOKENS} tokens out (the ${TOKENS - 1} it read and the one the hub took for its first job): it had ${outNow(w) ?? 'none'}`).toBe(true);
}

/** One level of the script, from its change: when the tokens out first came within its bound, and the readings after. */
export interface Phase { level: 'warn' | 'critical'; at: number; reached?: number; from: number; to: number }
/** Sets `level` and waits up to 15 s for the tokens out to come within its bound, then `hold` ms more. */
export async function pressed(w: World, level: 'warn' | 'critical', hold = HOLD_MS): Promise<Phase> {
  const at = Date.now();
  w.setLevel(level);
  const ok = await until(() => (outNow(w) ?? Infinity) <= OUT_AT[level], SETTLE_MS, 50);
  const from = Date.now();
  await sleep(hold);
  return { level, at, ...(ok ? { reached: from - at } : {}), from, to: Date.now() };
}
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;
/**
 * The level's bound: reached within 15 s of the change, and no reading over it for the time held after. `why` says
 * what a criterion other than AC1 needs the held-back pool for.
 */
export function heldBack(w: World, p: Phase, why = ''): void {
  const bound = OUT_AT[p.level];
  const rs = readings(w);
  const atEnd = rs.filter((r) => r.ms <= p.from).at(-1);
  if (p.reached === undefined) expect.fail(`${why}with ${TOKENS} tokens and a simulated \`${p.level}\`, no more than ${bound} may be out once running jobs return theirs (each job gives its token back within ${JOB_MS} ms): ${atEnd ? out(atEnd) : 'no reading of'} tokens were still out ${secs(p.from - p.at)} after the level turned ${p.level}`);
  const over = rs.find((r) => r.ms >= p.from && r.ms <= p.to && out(r) > bound);
  if (over) expect.fail(`${why}at \`${p.level}\`, ${out(over)} tokens were out ${secs(over.ms - p.at)} after the level turned ${p.level}, more than ${bound}, once they had come within it`);
}

// ---- The pool's changes and the token counts over time.
/**
 * The pool's changes among readings (README, Open points 4): a move of the tokens out by 2 or more one way is one
 * change, however many readings it takes as tokens come back one by one; a single token back the other way, one in
 * transit between the pool and the build, is not a change.
 */
export function changes(rs: readonly Reading[]): { count: number; path: number[] } {
  const path = rs.map(out).filter((v, i, all) => i === 0 || v !== all[i - 1]);
  let count = 0;
  let way = 0;
  let extreme = path[0] ?? 0;
  for (const v of path.slice(1)) {
    const step = Math.sign(v - extreme);
    if (step === way) extreme = v;
    else if (Math.abs(v - extreme) >= 2) {
      count++;
      way = step;
      extreme = v;
    }
  }
  return { count, path };
}
/**
 * The token counts over time, for the output: each level the test set and each change of the tokens out, from `t0`
 * until the build is let go at `go` (after which it takes no more tokens, so its readings are no longer the pool's).
 */
export function timeline(w: World, t0: number, go: number, label = 'build'): string {
  const marks = [
    ...w.script.map((s) => ({ ms: s.ms, level: s.level as Level | undefined, n: undefined as number | undefined })),
    ...readings(w, label).map((r) => ({ ms: r.ms, level: undefined, n: out(r) })),
  ].sort((a, b) => a.ms - b.ms);
  let last: number | undefined;
  const parts: string[] = [];
  for (const m of marks) {
    if (m.ms < t0 || m.ms > go) continue;
    if (m.level) parts.push(`+${secs(m.ms - t0)} [${m.level}]`);
    else if (m.n !== last) {
      parts.push(`+${secs(m.ms - t0)} ${m.n}`);
      last = m.n;
    }
  }
  return `${parts.join(', ')}, +${secs(go - t0)} build let go`;
}

// ---- The real build's workspace.
/**
 * A cargo workspace of `leaves` independent library crates `leaf01` … (each about a second of rustc, as #1016's sample)
 * and `app`, a binary using them all, built with one codegen unit and no debug info or incremental cache, so each rustc
 * runs on the one token it was started with.
 */
export function writeCargoWorkspace(dir: string, leaves: number): void {
  const names = Array.from({ length: leaves }, (_, i) => `leaf${String(i + 1).padStart(2, '0')}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Cargo.toml'), `[workspace]\nmembers = [${[...names, 'app'].map((m) => `"${m}"`).join(', ')}]\nresolver = "2"\n\n[profile.dev]\ncodegen-units = 1\ndebug = 0\nincremental = false\n`);
  names.forEach((name, i) => {
    let s = '';
    for (let f = 0; f < 120; f++) {
      s += `pub fn f${f}<T: Clone + core::fmt::Debug>(x: &[T]) -> Vec<String> { x.iter().cloned().map(|v| format!("{v:?}-${i}-${f}")).filter(|s| s.len() > ${f % 7}).collect() }\n`;
      s += `pub fn g${f}() -> usize { f${f}(&[${f}u64, ${i}, 3]).len() + f${f}(&["a", "b"]).len() }\n`;
    }
    mkdirSync(join(dir, name, 'src'), { recursive: true });
    writeFileSync(join(dir, name, 'Cargo.toml'), `[package]\nname = "${name}"\nversion = "0.1.0"\nedition = "2021"\n`);
    writeFileSync(join(dir, name, 'src/lib.rs'), s);
  });
  mkdirSync(join(dir, 'app', 'src'), { recursive: true });
  writeFileSync(join(dir, 'app', 'Cargo.toml'), `[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n${names.map((l) => `${l} = { path = "../${l}" }`).join('\n')}\n`);
  writeFileSync(join(dir, 'app', 'src/main.rs'), `fn main() {\n    let n = 0${names.map((l) => ` + ${l}::g0()`).join('')};\n    println!("{n}");\n}\n`);
  writeFileSync(join(dir, '.gitignore'), 'target/\n');
}
