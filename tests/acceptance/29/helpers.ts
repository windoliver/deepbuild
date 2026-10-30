// Shared test-side tools for issue #29's acceptance tests (README): temp folders under /tmp/dh29-*, real git
// repositories, the reference-Mac judge, scenario builders for the scheduler (README, The surface under test, section 7)
// and the planted-program judge. Nothing here stands in for the gate runner: every reading comes from
// `@deepbuild/gate`'s public entry, imported by the tests with its `.ts` path.
//
// Safety: every folder is under /tmp/dh29-*; HOME is a temp folder for this process and every child; no network, no
// model, no real `claude` or `codex`; processes a test starts are stopped by PID only, never by name or port.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, type TestContext } from 'vitest';
import type { CheckDef, RunContext, ScriptEvent, SessionScript, Trace, StopReply, RunRecord } from '../../../packages/gate/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const NODE = process.execPath;
export const SECOND = 1000;
export const MINUTE = 60_000;
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const tag = (n = 4) => randomBytes(n).toString('hex');

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_')) delete process.env[key];
let HOME: string | undefined;
/** This process's HOME and every child's: a temp folder, made before the first thing a test opens. */
export function home(): string {
  if (!HOME || !existsSync(HOME)) {
    HOME = realpathSync(mkdtempSync('/tmp/dh29-home-'));
    process.env.HOME = HOME;
  }
  return HOME;
}

// ---- Temp folders: short real paths (a socket path must fit 104 bytes; the supervisor matches real paths).
const made: string[] = [];
export function tempDir(): string {
  home();
  const dir = realpathSync(mkdtempSync('/tmp/dh29-'));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---- IDs.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(value: bigint, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
export const ulid = (ms = Date.now()): string => base32(BigInt(ms), 10) + base32(BigInt(`0x${randomBytes(10).toString('hex')}`), 16);
/** A lease holder: `session:<ULID>`. */
export const session = (): string => `session:${ulid()}`;

// ---- Real git repositories.
export function git(cwd: string, args: readonly string[], env: Record<string, string> = {}): string {
  return execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'protocol.file.allow=always', ...args], {
    cwd, encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home(), GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
      GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test', ...env,
    },
  }).trim();
}
export function write(dir: string, files: Record<string, string>): void {
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), bytes);
  }
}
/** A git repository on `main` with one commit holding `files`. */
export function makeRepo(files: Record<string, string>): { dir: string; commit: string } {
  const dir = join(tempDir(), 'repo');
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  write(dir, files);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'base']);
  return { dir, commit: git(dir, ['rev-parse', 'HEAD']) };
}
/** Writes `files` (a value of null deletes) and commits them; the commit's author and committer fields as given. */
export function commitFiles(dir: string, files: Record<string, string | null>, message: string, who: { author?: string; committer?: string } = {}): string {
  for (const [path, bytes] of Object.entries(files)) {
    if (bytes === null) rmSync(join(dir, path), { force: true });
    else write(dir, { [path]: bytes });
  }
  git(dir, ['add', '-A']);
  const a = who.author ?? 'T';
  const c = who.committer ?? a;
  git(dir, ['commit', '-q', '-m', message], {
    GIT_AUTHOR_NAME: a, GIT_AUTHOR_EMAIL: `${a}@example.test`, GIT_COMMITTER_NAME: c, GIT_COMMITTER_EMAIL: `${c}@example.test`,
  });
  return git(dir, ['rev-parse', 'HEAD']);
}

// ---- The reference-Mac judge (as #28's and #303's budgets): a timing result off a reference Mac is a reading only.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine is not a reference Mac on mains power with Low Power Mode off and a nominal thermal state, or null when it is. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model');
    chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt');
    power = read('pmset', '-g');
    therm = read('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/** Five runs after a warm-up: PASS when all are within the limit, FAIL when all are over it by more than the margin, else INCONCLUSIVE (a skip). */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

// ---- Planted wrong programs: an assertion run on one must fail.
/** The message an assertion throws, or null when it holds. */
export async function failureOf(assertion: () => unknown): Promise<string | null> {
  try {
    await assertion();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
/** Asserts the planted program fails the same assertion; `names` must appear in the failure's message (the criterion says it names a stop, a check, a snapshot…). */
export async function mustFail(what: string, assertion: () => unknown, names: string[] = []): Promise<void> {
  const message = await failureOf(assertion);
  expect(message, `${what}: the planted wrong program passed the assertion, so the assertion proves nothing`).not.toBeNull();
  for (const n of names) expect(message, `${what}: the failure must name ${n}`).toContain(n);
}

// ---- Scenario builders for the scheduler.
export type RunFn = (ctx: RunContext) => { took_ms: number; outcome: 'passed' | 'failed'; load?: number };
export interface CheckOpts extends Partial<Omit<CheckDef, 'id' | 'run'>> {
  /** The time a run takes (default the check's expected_ms), or per snapshot. */
  took?: number | Record<string, number>;
  /** How a run ends (default passed), per snapshot, or `fails_on_worktree`: a run is FAIL when the live worktree it reads is not `ok_snapshot`. */
  ends?: 'passed' | 'failed' | Record<string, 'passed' | 'failed'>;
  /** A run that reads the live worktree (a wrong program) fails when the worktree holds this snapshot. */
  worktree_fails_on?: string;
  /** A run's own function, replacing the above. */
  run?: RunFn;
}
/** A check with a scripted behavior. `expected_ms` is the median of its last clean runs. */
export function check(id: string, expected_ms: number, o: CheckOpts = {}): CheckDef {
  const { took, ends, worktree_fails_on, run, ...rest } = o;
  const pick = <T>(v: T | Record<string, T> | undefined, snapshot: string, fallback: T): T =>
    v === undefined ? fallback : typeof v === 'object' ? ((v as Record<string, T>)[snapshot] ?? fallback) : v;
  return {
    id, on_base: 'passes', inputs: [], expected_ms,
    ...rest,
    run: run ?? ((ctx) => {
      const live = ctx.worktree_at(ctx.started_ms);
      const outcome = worktree_fails_on !== undefined && live === worktree_fails_on ? 'failed' : pick(ends as 'passed' | 'failed' | Record<string, 'passed' | 'failed'> | undefined, ctx.snapshot, 'passed');
      return { took_ms: pick(took, ctx.snapshot, expected_ms), outcome };
    }),
  };
}
export const stop = (at: number, snapshot: string, o: { changed?: string[]; checkout_ms?: number; sorted?: Extract<ScriptEvent, { kind: 'stop' }>['sorted']; id?: string } = {}): ScriptEvent =>
  ({ at, kind: 'stop', snapshot, changed: o.changed ?? ['src/cart.ts'], ...(o.checkout_ms !== undefined ? { checkout_ms: o.checkout_ms } : {}), ...(o.sorted ? { sorted: o.sorted } : {}), ...(o.id ? { id: o.id } : {}) });
export const prompt = (at: number, origin: Extract<ScriptEvent, { kind: 'prompt' }>['origin'] = 'human'): ScriptEvent => ({ at, kind: 'prompt', origin });
export const edit = (at: number, snapshot: string, changed: string[] = ['src/cart.ts']): ScriptEvent => ({ at, kind: 'edit', snapshot, changed });
export const script = (id: string, agent: SessionScript['agent'], checks: CheckDef[], events: ScriptEvent[], o: Partial<SessionScript> = {}): SessionScript => ({ id, agent, checks, events, ...o });

// ---- Reading a trace.
export const stopOf = (t: Trace, session: string, n: number): StopReply => {
  const s = t.stops.filter((x) => x.session === session)[n - 1];
  if (!s) throw Error(`no stop ${n} of ${session} in the trace (it has ${t.stops.filter((x) => x.session === session).length})`);
  return s;
};
export const runsOf = (t: Trace, check: string, snapshot?: string): RunRecord[] =>
  t.runs.filter((r) => r.check === check && (snapshot === undefined || r.snapshot === snapshot));
export const sum = (h: { question: number; slow: number; fast: number; snapshot_start: number; queue_wait: number }): number => h.question + h.slow + h.fast + h.snapshot_start + h.queue_wait;
