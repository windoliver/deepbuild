// Shared test-side tools for the #87 numbers acceptance tests: the plug-in (imported lazily, so each test fails on
// its own at the base), the real pieces of work the numbers kind checks (SQLite files in a temporary checkout), the
// speed claim's two sides and its checkout (a real git repository), and the core's verdict over one check's run.
// None of them stands in for the plug-in.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll } from 'vitest';
import { verdict } from '../../../../packages/verdicts/src/index.ts';
import type { ClaimCheck, ClaimInput, Run, Verdict } from '../../../../packages/verdicts/src/index.ts';
import type { CheckContext, CheckResult } from '../../../../packages/conformance/src/index.ts';
import type { NumbersSpec, Side, SpeedResult, StatedNumber, AddedTerm, Toolchain } from '../../../../packages/checks-numbers/src/index.ts';

// ---- The plug-in, reached only through its public entry, imported when a test first needs it.

type Numbers = typeof import('../../../../packages/checks-numbers/src/index.ts');
export const numbers = (): Promise<Numbers> => import('../../../../packages/checks-numbers/src/index.ts');

/** Far past any run here. */
export const DEADLINE = 60_000;
export const context = (checkout: string, deadline = DEADLINE): CheckContext => ({ checkout, deadline, now: () => Date.now() });

// ---- What the tests make, removed when the file's tests end: only what they made.

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
export const tempDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'deep-87-numbers-'));
  dirs.push(d);
  return d;
};
export const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** A SQLite file in `dir`, built from `sql`, closed. */
export function database(dir: string, file: string, sql: string): string {
  mkdirSync(dirname(join(dir, file)), { recursive: true });
  const db = new DatabaseSync(join(dir, file));
  db.exec(sql);
  db.close();
  return file;
}

/** The numbers spec over these stated numbers and added terms, its inputs the files they read. */
export function numbersSpec(stated: StatedNumber[], added: AddedTerm[] = []): NumbersSpec {
  const files = new Set<string>([...stated.flatMap((n) => [n.query.database, ...(n.recount ? [n.recount.database] : [])]), ...added.map((a) => a.sample)]);
  return { kind: 'numbers', runner: 'sqlite', inputs: [...files], depth: 'unit', oracle: 'code', contract: null, numbers: stated, added };
}

/** The numbers kind's runner on a spec in a checkout. */
export async function runNumbers(spec: NumbersSpec, checkout: string): Promise<CheckResult> {
  const fill = (await numbers()).numbersFill();
  return await fill.run(spec, context(checkout));
}

// ---- The speed claim: its checkout, a git repository whose merge base is a real commit, and its two sides.

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=Deep Test', '-c', 'user.email=deep@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).trim();

const SPIN = (work: number): string =>
  `export const spin = (n) => { let h = 0; for (let i = 0; i < n; i++) h = (Math.imul(h, 31) + i) | 0; return h; };\nexport const WORK = ${work};\n`;
/** A repository with the merge base and the change on top of it, which spins a twentieth of the base's range; `base` is the merge base's commit. */
export function speedCheckout(): { dir: string; base: string; head: string } {
  const dir = tempDir();
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'spin.mjs'), SPIN(BASE_WORK));
  git(dir, 'add', 'spin.mjs');
  git(dir, 'commit', '-q', '-m', 'spin the whole range');
  const base = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'switch', '-q', '-c', 'change');
  writeFileSync(join(dir, 'spin.mjs'), SPIN(CHANGE_WORK));
  git(dir, 'commit', '-q', '-am', 'spin a twentieth of it');
  return { dir, base, head: git(dir, 'rev-parse', 'HEAD') };
}

export const TOOLCHAIN: Toolchain = { compiler: 'clang 17.0.6', driver: 'Metal 350.10', runtime: 'node 24.22.0' };
export const MACHINE = 'fp:Mac15,7/macOS-26.1/M3-Pro-12c-18g/36GB';
/** The base's work and the change's, of deterministic cost: the change does a twentieth of the base's. */
export const BASE_WORK = 100_000_000;
export const CHANGE_WORK = 5_000_000;

let sink = 0;
const spin = (n: number): void => {
  let h = 0;
  for (let i = 0; i < n; i++) h = (Math.imul(h, 31) + i) | 0;
  sink ^= h;
};
/** 32 MB, past the caches of the reference Macs' CPUs: overwriting it is the test's cache flush. */
const EVICT = new Uint8Array(32 * 1024 * 1024);
let flushes = 0;

export type Event = 'warm' | 'flush' | 'work';
export interface SideOptions {
  work: number;
  /** The toolchain the side actually runs with; the check's own unless given. */
  toolchain?: Toolchain;
  /** The flush reports no flush on this repeat (1-based). */
  unflushedAt?: number;
}
/** One side as the platform would run it, recording what the check asked of it, in order. */
export function side(o: SideOptions): { side: Side; events: Event[] } {
  const events: Event[] = [];
  let flushed = 0;
  return {
    events,
    side: {
      warmUp: () => { events.push('warm'); spin(1000); },
      flush: () => {
        events.push('flush');
        flushed += 1;
        EVICT.fill(++flushes & 0xff);
        return flushed !== o.unflushedAt;
      },
      work: () => { events.push('work'); spin(o.work); },
      toolchain: () => ({ ...(o.toolchain ?? TOOLCHAIN) }),
      machine: () => MACHINE,
    },
  };
}

// ---- The core's verdict on a claim whose one requirement one check covers, from that check's one run.

const HEAD = 'c'.repeat(40);
const ENV = { os: 'darwin' };
const T0 = 1_761_955_200_000;
const REQ = 'R1';

export function runRecord(result: CheckResult | SpeedResult, check: string): Run {
  const run: Run = {
    run: `run:${check.replace(/[^0-9A-Za-z]/g, '')}`, check, claim: 'claim:87', commit: HEAD, digest: `d1:${sha256(check)}`,
    environment: { ...ENV }, tools: {}, outcome: result.outcome, started: T0, ended: T0 + 1, tests_run: result.testsRun,
    reads: [...result.read],
    failures: result.failures.map((f) => ({ test: f.test, message: f.message, cause: 'change:numbers', frames: [{ file: f.file, line: f.line }], covers: [], case: null })),
    evidence: [], kept: true,
    ...(result.outcome === 'missing' ? { missing: { cause: result.failures.map((f) => f.message).join('; ') || 'missing', owner: 'you', since: T0 } } : {}),
  };
  // A speed's run carries its timing report, as a contract's run carries its contract report.
  if ('timing' in result) run.timing = result.timing;
  return run;
}
/** The verdict on one run of a check named `check`, whose oracle is code, at unit depth. */
export function judge(result: CheckResult | SpeedResult, check = 'check:numbers'): Verdict {
  const c: ClaimCheck = {
    check, digest: `d1:${sha256(check)}`, source: 'definition', depth: 'unit', proof: 'test_run', covers: [REQ],
    environment: { ...ENV }, tools: {}, oracle: 'code',
  };
  const claim: ClaimInput = {
    claim: 'claim:87', agent: 'session:agent', repo: 'repo:numbers', task: 'task:87', commit: HEAD,
    requirements: [{ req: REQ, depth: 'unit', oracle: 'code', on_base: 'passes' }],
    checks: [c], runs: [runRecord(result, check)], changes: [], waivers: [], now: T0 + 2,
  };
  return verdict(claim);
}

export const shown = (r: CheckResult): string =>
  `run ${r.outcome}, ${r.testsRun} run; failures: ${r.failures.map((f) => `${f.file}:${f.line} ${f.assertion ? '(assertion) ' : ''}${f.message}`).join(' | ') || '(none)'}`;
export const shownSpeed = (r: SpeedResult, v?: Verdict): string =>
  `${shown(r)}; timing ${r.timing?.outcome} [${(r.timing?.reasons ?? []).join(' | ')}]; repeats base ${JSON.stringify(r.repeats?.baseline)} change ${JSON.stringify(r.repeats?.change)}${v ? `; verdict ${v.outcome} [${v.reasons.join(' | ')}]` : ''}`;
/** A number as the tests look for it in a message: written with or without thousands separators. */
export const writtenEither = (n: number): RegExp => new RegExp(`(?<![0-9.,])(${n.toLocaleString('en-US')}|${n})(?![0-9]|[.,][0-9])`);
