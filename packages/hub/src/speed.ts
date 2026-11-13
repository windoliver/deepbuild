// A speed a claim states, judged through the timing check it cites (#1863; design: Speed claims name their baseline).
// A final message states a speed, such as "1.8× faster than the merge base" or "40 µs at batch 8", with the timing
// check behind it in plain words: `(timing check <file>)`. The file, as the merge base holds it (a check the change
// brings is its own, never one that judges it), names the baseline (the merge base by default), each side's
// toolchain by version, the machine by its fingerprint, the timed repeats a side, and the four commands each side
// runs in its own checkout: a warm-up that only compiles and loads, a cache flush that exits 0 once flushed, one
// timed repeat of the work, and a report of the toolchain and machine the side ran with. The numbers check's
// `checkSpeed` (#87) times both sides in one run and judges the stated speed; each side's steps run through host@1,
// hermetic, as a command check's run does.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { checkSpeed, type Side, type SpeedClaim, type TimingCheck, type Toolchain } from '@deepbuild/checks-numbers';
import type { CheckContext, CheckResult, CheckSpec, Failure } from '@deepbuild/conformance';
import { gitEnv } from '@deepbuild/gate';
import type { TimingReport } from '@deepbuild/verdicts';
import type { Supervisor } from '@deepbuild/supervisor';

/** A stated speed with the timing check the claim cites: "<n>× faster …" or "<n> <unit> at <what> <n>", then `(timing check <file>)`. */
const STATED = /(\d+(?:\.\d+)?\s*[×x]\s+faster\b[^.;()`]*?|\d+(?:\.\d+)?\s*(?:ns|µs|μs|us|ms|s)\s+at\s+[\w-]+(?:\s+\d+)?)\s*\(\s*timing check\s+`?([\w./-]+)`?\s*\)/gi;
/** How long a speed check may take: both sides' warm-ups and every repeat, which its timing check sets, not the numbers kind's 30 s. */
export const SPEED_DEADLINE_MS = 30 * 60_000;
/** What a speed check is expected to take before it has run: more than any fast lane admits, so it runs once the turn ends. */
export const SPEED_EXPECTED_MS = 60_000;
/** What a step's output keeps: a side's report, or the end of a failed step's output for its failure. */
const OUTPUT_BYTES = 64 * 1024;
/**
 * Failures as the record holds them: run.finished@2 keeps each as one finding of at most 8192 characters, its test,
 * place and message together, so a long term, command or list of repeats keeps its start, which names it.
 */
export const recordable = (failures: Failure[]): Failure[] => failures.map((f) => ({ ...f, test: f.test.slice(0, 1000), message: f.message.slice(0, 6000) }));

/** A speed a claim's words state, as written, and the timing check file it cites. */
export interface StatedSpeed { stated: string; file: string }
/** The check a stated speed runs as, through the numbers kind: the claim's speed, its timing file and the claim's merge base, its default baseline. */
export interface SpeedSpec extends CheckSpec { kind: 'numbers'; runner: 'timing'; stated: string; file: string; base: string }
/** Where a claim's numbers checks read beyond its checkout: the supervisor, the hub's object store and checkouts of other commits. */
export interface ClaimRepo {
  supervisor: Supervisor;
  /** The hub's object store, a bare repo reading the repo's objects as alternates. */
  store: string;
  checkoutOf(commit: string): Promise<{ dir: string; ended(): Promise<void> }>;
}

/** Each speed the words state with the timing check cited for it, in order, once each. */
export function statedSpeeds(words: string): StatedSpeed[] {
  const out = new Map<string, StatedSpeed>();
  for (const m of words.matchAll(STATED)) {
    const s = { stated: m[1]!.trim().replace(/\s+/g, ' '), file: m[2]! };
    out.set(`${s.stated}\0${s.file}`, s);
  }
  return [...out.values()];
}
/** The words with each speed's timing check cite as plain text: the check re-runs it, so it is no file or run the session cites. */
export const uncitedSpeeds = (words: string): string => words.replace(STATED, (m) => m.replaceAll('`', ''));

const git = (store: string, args: string[]): Promise<Buffer | undefined> => new Promise((done) =>
  execFile('git', [`--git-dir=${store}`, ...args], { encoding: 'buffer', maxBuffer: 1 << 30, env: gitEnv() }, (error, out) => done(error ? undefined : out)));
/** A file's bytes at a commit, read from the hub's store; undefined where the commit doesn't hold it. */
export const blobAt = (store: string, commit: string, path: string): Promise<Buffer | undefined> => {
  const p = normalize(path);
  return isAbsolute(p) || p.startsWith('..') ? Promise.resolve(undefined) : git(store, ['cat-file', 'blob', `${commit}:${p}`]);
};

/** A timing check file's fields: #87's timing check, and the four commands each side runs. */
interface TimingFile { timing: Omit<TimingCheck, 'baseline'> & { baseline?: TimingCheck['baseline'] }; steps: Record<Step, string> }
type Step = 'warmup' | 'flush' | 'work' | 'report';
const STEPS: readonly Step[] = ['warmup', 'flush', 'work', 'report'];
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const toolchainOf = (v: unknown): Toolchain | undefined => {
  const t = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return text(t.compiler) && text(t.driver) && text(t.runtime) ? { compiler: t.compiler, driver: t.driver, runtime: t.runtime } : undefined;
};
/** The timing check file's fields, or what's wrong with it. */
function timingOf(file: string, bytes: Buffer): TimingFile | string {
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString('utf8')); } catch (error) { return `the timing check ${file} isn't JSON: ${(error as Error).message}`; }
  const f = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const missing = STEPS.filter((s) => !text(f[s]));
  if (missing.length) return `the timing check ${file} names no ${missing.join(', ')} command`;
  const toolchain = (typeof f.toolchain === 'object' && f.toolchain !== null ? f.toolchain : {}) as Record<string, unknown>;
  const baseline = toolchainOf(toolchain.baseline), change = toolchainOf(toolchain.change);
  if (!baseline || !change) return `the timing check ${file} names no compiler, driver and runtime by version for each side`;
  if (!text(f.machine)) return `the timing check ${file} names no machine by its fingerprint`;
  const b = (typeof f.baseline === 'object' && f.baseline !== null ? f.baseline : undefined) as Record<string, unknown> | undefined;
  const named = b === undefined ? undefined : text(b.commit) ? { commit: b.commit } : text(b.library) ? { library: b.library, ...(text(b.release) ? { release: b.release } : {}) } : null;
  if (named === null) return `the timing check ${file} names a baseline that is neither a commit nor a library`;
  return {
    timing: { toolchain: { baseline, change }, machine: f.machine, repeats: Number(f.repeats), ...(f.warm === true ? { warm: true as const } : {}), ...(named ? { baseline: named } : {}) },
    steps: { warmup: String(f.warmup), flush: String(f.flush), work: String(f.work), report: String(f.report) },
  };
}

/** A step that ended other than as its command means, or was stopped: what kept the speed from being timed. */
class StepFailed extends Error { constructor(message: string, readonly outcome: 'failed' | 'overran' | 'stopped' = 'failed') { super(message); } }

/** One side: its steps run in its checkout through host@1, hermetic, its own temp folder its home. */
function sideOf(repo: ClaimRepo, name: 'baseline' | 'change', dir: string, steps: TimingFile['steps'], temp: string, deadline: number, stop?: AbortSignal): { side: Side; report(): Promise<void> } {
  const node = dirname(process.execPath);
  const step = async (s: Step): Promise<{ code: number | null; out: string }> => {
    if (stop?.aborted) throw new StepFailed('the hub stopped', 'stopped');
    const run = `run:${randomBytes(12).toString('hex')}`;
    const chunks: Buffer[] = [];
    let size = 0;
    const keep = (c: Buffer): void => { if (size < OUTPUT_BYTES) { chunks.push(c); size += c.length; } };
    const started = await repo.supervisor.start({
      run, argv: ['/bin/sh', '-c', steps[s]], cwd: dir, inherit: false, grant: { read: [node], write: [dir, temp] }, output: { stdout: keep, stderr: keep },
      env: { PATH: [node, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'), HOME: temp, TMPDIR: temp, LANG: 'en_US.UTF-8', TZ: 'UTC', CI: 'true', NO_COLOR: '1' },
    });
    let why: StepFailed | undefined;
    const halt = (e: StepFailed): void => { why ??= e; void repo.supervisor.signal(run, 'SIGKILL').catch(() => undefined); };
    const onStop = (): void => halt(new StepFailed('the hub stopped', 'stopped'));
    const timer = setTimeout(() => halt(new StepFailed(`the timing check was still running at its deadline, in the ${name} side's ${s}`, 'overran')), Math.max(1, deadline - Date.now()));
    stop?.addEventListener('abort', onStop);
    try {
      if (started.status !== 'started') throw new StepFailed(`the ${name} side's ${s} found no ${started.kind} free`);
      const exit = await repo.supervisor.wait(run);
      if (why) throw why;
      return { code: exit.code, out: Buffer.concat(chunks).toString('utf8').slice(0, OUTPUT_BYTES) };
    } finally {
      clearTimeout(timer);
      stop?.removeEventListener('abort', onStop);
      await repo.supervisor.cleanup(run).catch(() => undefined);
    }
  };
  const must = async (s: Step): Promise<string> => {
    const r = await step(s);
    if (r.code !== 0) throw new StepFailed(`the ${name} side's ${s} (\`${steps[s]}\`) exited ${String(r.code)}: ${r.out.trim().split('\n').slice(-3).join(' ').slice(0, 400)}`);
    return r.out;
  };
  let ran = { toolchain: { compiler: '', driver: '', runtime: '' }, machine: '' };
  return {
    side: { warmUp: async () => { await must('warmup'); }, flush: async () => (await step('flush')).code === 0, work: async () => { await must('work'); }, toolchain: () => ran.toolchain, machine: () => ran.machine },
    // What the side runs with, from its own report, read once before any repeat.
    report: async () => {
      const out = await must('report');
      let r: Record<string, unknown> = {};
      try { const parsed: unknown = JSON.parse(out.trim().split('\n').at(-1) ?? ''); if (typeof parsed === 'object' && parsed !== null) r = parsed as Record<string, unknown>; } catch { /* named below */ }
      const toolchain = toolchainOf(r.toolchain);
      const machine = r.machine;
      if (!toolchain || !text(machine)) throw new StepFailed(`the ${name} side's report names no toolchain (compiler, driver, runtime) and machine: ${out.slice(0, 200)}`);
      ran = { toolchain, machine };
    },
  };
}

/** A run whose timing can't count: uncounted, its timing report INVALID naming why, so the verdict names it. */
const invalid = (why: string): CheckResult & { speed: TimingReport } =>
  ({ outcome: 'uncounted', testsRun: 0, failures: [], evidence: [], read: [], mask: null, speed: { outcome: 'INVALID', reasons: [why], warm: false } });

/**
 * One run of a stated speed's timing check: the baseline side in a checkout of its commit (the merge base by default),
 * the change side in the claim's, both timed by `checkSpeed` in one run. Its timing report goes with the result, so an
 * INVALID or a reading reaches the verdict with its reasons. A step that can't run is a crash, never a timed repeat.
 * It names no file it read: its sides run the whole program, so no file's contents could key its result, and a run
 * that read none never carries to another claim (#1018).
 */
export async function runSpeed(spec: SpeedSpec, ctx: CheckContext, repo: ClaimRepo, stop?: AbortSignal): Promise<CheckResult & { speed?: TimingReport }> {
  const deadline = Date.now() + ctx.deadline;
  const base = spec.base;
  const bytes = await blobAt(repo.store, base, spec.file);
  if (!bytes) return invalid(`the timing check ${spec.file} isn't in the merge base ${base}: one the change brings is its own, and judges nothing`);
  const file = timingOf(spec.file, bytes);
  if (typeof file === 'string') return invalid(file);
  const claim: SpeedClaim = { stated: spec.stated, timing: { ...file.timing, baseline: file.timing.baseline ?? { commit: base } } };
  const commit = 'commit' in claim.timing.baseline ? claim.timing.baseline.commit : undefined;
  // A baseline commit the store doesn't hold is checkSpeed's INVALID, found before any side runs.
  const resolved = commit === undefined || (await git(repo.store, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`])) !== undefined;
  const temps = ['baseline', 'change'].map((n) => mkdtempSync(join(realpathSync(tmpdir()), `deep-speed-${n}-`)));
  let checkout: { dir: string; ended(): Promise<void> } | undefined;
  try {
    if (commit !== undefined && resolved) checkout = await repo.checkoutOf(commit);
    const baseline = sideOf(repo, 'baseline', checkout?.dir ?? ctx.checkout, file.steps, temps[0]!, deadline, stop);
    const change = sideOf(repo, 'change', ctx.checkout, file.steps, temps[1]!, deadline, stop);
    if (resolved) { await baseline.report(); await change.report(); }
    const timed = await checkSpeed(claim, { baseline: baseline.side, change: change.side }, { ...ctx, checkout: repo.store });
    // The repeats a side, in ms, kept with the failure: what the stated speed was judged on.
    const repeats = ` (repeats in ms: baseline ${timed.repeats.baseline.map((x) => x.toFixed(0)).join(', ')}; change ${timed.repeats.change.map((x) => x.toFixed(0)).join(', ')})`;
    return { outcome: timed.outcome, testsRun: timed.testsRun, failures: recordable(timed.failures.map((f) => ({ ...f, file: spec.file, message: `${f.message}${repeats}` }))), evidence: [], read: [], mask: null, speed: timed.timing };
  } catch (error) {
    if (!(error instanceof StepFailed)) throw error;
    return { outcome: error.outcome, testsRun: 0, failures: recordable([{ test: `speed: ${spec.stated}`, file: spec.file, line: 1, stack: null, assertion: false, message: error.message }]), evidence: [], read: [], mask: null };
  } finally {
    await checkout?.ended().catch(() => undefined);
    for (const t of temps) rmSync(t, { recursive: true, force: true });
  }
}
