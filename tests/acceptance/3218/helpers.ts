// Test-side tools for the #3218 acceptance tests: IDs, temp folders, a clock the test sets, held promises, the
// record read back, git on this checkout, the merge base's own lease table and heavy queue extracted into a temp
// folder, and the perf lane's timing judge. Nothing here stands in for the lease table or the heavy queue: tests
// reach them through `@deepbuild/leases`'s public entry and the hub's `@deepbuild/hub/lease` entry (world.ts; README,
// The surface under test).
//
// Safety: every folder is under /tmp/dl3218-*; HOME is a temp folder for this process and every child, and the agent's
// own CLAUDE_* and DEEP_* variables are removed first, so nothing here reaches a real hub or ~/.deepbuild. The only
// processes the suite starts are `git` reads of this checkout, the perf lane's benchmark and, for AC2, #237's own suite
// under Vitest; each is awaited to its end, and none is stopped by name or port.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { loadavg } from 'node:os';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
let HOME: string | undefined;
/** This process's HOME and every child's: a temp folder, made before the first thing a test opens. */
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dl3218-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}
home();

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export function ulid(ms = Date.now()): string {
  return base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
}
/** A holder: `session:<ULID>`, as the record's holder pattern writes one. */
export const session = (): string => `session:${ulid()}`;

// ---- Temp folders.
const made: string[] = [];
export function tempDir(): string {
  home();
  const dir = realpathSync(mkdtempSync('/tmp/dl3218-'));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (HOME) rmSync(HOME, { recursive: true, force: true });
});

// ---- A clock the test sets: the record's and the table's `now`. It starts at the real time and moves only when the
// test moves it.
export interface Clock { now(): number; set(ms: number): void; advance(ms: number): void }
export function makeClock(start = Date.now()): Clock {
  let t = start;
  return { now: () => t, set: (ms) => { t = ms; }, advance: (ms) => { t += ms; } };
}

// ---- Values.
export const json = (v: unknown): string => JSON.stringify(v, (_, x: unknown) => (typeof x === 'bigint' ? x.toString() : x));
/** Every order of the given items. */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}
/** A promise the test resolves itself: a read held open. */
export interface Held<T> { promise: Promise<T>; resolve(value: T): void }
export function held<T>(): Held<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
/** The promise's value, or 'pending' when it hasn't settled within `ms`. */
export async function within<T>(promise: Promise<T>, ms: number): Promise<T | 'pending'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'pending'>((resolve) => { timer = setTimeout(() => resolve('pending'), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

// ---- Git, on this checkout only, with no inherited repository variables.
export const gitEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
export function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', env: gitEnv(), maxBuffer: 1 << 28 });
}
let base: string | undefined;
/** The merge base with origin/main: the commit every "on the merge base" in the issue reads. */
export function mergeBase(): string {
  if (base) return base;
  try {
    base = git('merge-base', 'HEAD', 'origin/main').trim();
  } catch (error) {
    expect.fail(`BLOCKED: no merge base with origin/main in this checkout (${(error as Error).message.split('\n')[0]}); fetch main`);
  }
  return base;
}
const show = (rev: string, path: string): string | null => {
  try { return git('show', `${rev}:${path}`); } catch { return null; }
};

// ---- The merge base's own modules, for the criteria that compare with it (AC2's record, AC9's `deep lease`).
//
// Each named file and every file it imports by a relative path are read from the merge base with `git show` into a
// temp folder, laid out as in the repo. `@deepbuild/leases` is the merge base's copy too; any other `@deepbuild/*`
// import is this checkout's package entry (its `development` export), and any other package is this checkout's
// node_modules, so the record and the contracts both sides use are one.
const EXPORT_CONDITIONS = ['development', 'default', 'types'] as const;
function packageEntry(spec: string): string {
  const [scope, name, ...sub] = spec.split('/');
  const dir = realpathSync(join(REPO, 'node_modules', scope!, name!));
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { exports?: unknown; main?: string };
  const key = sub.length ? `./${sub.join('/')}` : '.';
  const exports = manifest.exports as Record<string, unknown> | string | undefined;
  let entry: unknown = typeof exports === 'string' ? exports
    : exports && Object.keys(exports).some((k) => k.startsWith('.')) ? exports[key] : key === '.' ? exports : undefined;
  if (entry && typeof entry === 'object') entry = EXPORT_CONDITIONS.map((c) => (entry as Record<string, unknown>)[c]).find((v) => typeof v === 'string');
  if (typeof entry !== 'string') throw Error(`BLOCKED: ${spec} has no entry this suite can read in ${dir}/package.json`);
  return join(dir, entry);
}
const requireHere = createRequire(join(REPO, 'package.json'));
const baseTrees = new Map<string, string>();
/** The merge base's copies of `files` (repo paths) and their relative imports; resolves with each file's path there. */
export function baseTree(files: string[]): Record<string, string> {
  const rev = mergeBase();
  const key = `${rev} ${files.join(' ')}`;
  let root = baseTrees.get(key);
  if (!root) {
    root = tempDir();
    const todo = [...files];
    const seen = new Set<string>();
    while (todo.length) {
      const path = todo.pop()!;
      if (seen.has(path)) continue;
      seen.add(path);
      const source = show(rev, path);
      if (source === null) expect.fail(`BLOCKED: the merge base ${rev.slice(0, 9)} has no ${path}`);
      const out = join(root, path);
      // Static imports and re-exports (`import … from`, `export … from`, `import '…'`) and dynamic `import('…')`.
      const IMPORTS = /^(\s*(?:import|export)\b[^;'"]*?\bfrom\s*|\s*import\s*)(['"])([^'"]+)\2|(\bimport\(\s*)(['"])([^'"]+)\5/gm;
      const rewritten = source.replace(IMPORTS, (whole, staticLead?: string, sq?: string, sspec?: string, dynLead?: string, dq?: string, dspec?: string) => {
        const [lead, quote, spec] = staticLead !== undefined ? [staticLead, sq!, sspec!] : [dynLead!, dq!, dspec!];
        if (spec.startsWith('node:')) return whole;
        let target: string;
        if (spec.startsWith('.')) {
          const ts = normalize(join(dirname(path), spec.replace(/\.js$/, '.ts')));
          todo.push(ts);
          return `${lead}${quote}${spec.replace(/\.js$/, '.ts')}${quote}`;
        }
        if (spec === '@deepbuild/leases') {
          todo.push('packages/leases/src/index.ts');
          target = join(root!, 'packages/leases/src/index.ts');
        } else if (spec.startsWith('@deepbuild/')) target = packageEntry(spec);
        else target = requireHere.resolve(spec);
        let rel = relative(dirname(out), target);
        if (!rel.startsWith('.')) rel = `./${rel}`;
        return `${lead}${quote}${rel}${quote}`;
      });
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, rewritten);
    }
    baseTrees.set(key, root);
  }
  return Object.fromEntries(files.map((f) => [f, join(root, f)]));
}
/** Imports a module of the merge base's tree. */
export const importBase = async <T>(file: string): Promise<T> => (await import(pathToFileURL(file).href)) as T;

// ---- Timing on the reference Mac, by the perf lane's own rule (scripts/benchmark.mjs): five runs after warm-up, on a
// reference Mac on mains power, Low Power Mode off, thermal state nominal, the load at each run's start and end within
// the cores. A reading that can't be judged is INCONCLUSIVE, which fails the test: it never passes.
export const load = (): number => loadavg()[0]!;
interface Bench {
  fingerprint(): Record<string, unknown>;
  judgeLimit(o: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: { start: number; end: number }[] }): { status: string; reason?: string };
  validateBudgets(current: unknown, base: unknown, approved?: string[]): unknown;
}
export const bench = async (): Promise<Bench> => (await import(pathToFileURL(join(REPO, 'scripts', 'benchmark.mjs')).href)) as Bench;
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
