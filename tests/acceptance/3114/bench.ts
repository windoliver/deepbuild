// The gate runner on a bench for #3114 (README): the hub's own GateRunner (packages/hub/src/gate-runner.ts), which
// works out what a claim changed from its worktree, a real git repo whose merge base is a real commit, and judges the
// claim through the gate's verdict.
//
// What stands in, at the calls the gate makes of the hub: the base-commit service (`checkouts`: the snapshot is the
// worktree's tree written into an index of its own, as packages/hub/test/gate-runner.test.ts's `checkoutsOf` does; the
// checkout is the worktree itself), and the run service (`start` gets a run handle; `ended` records and keys the run
// as packages/hub/src/runs.ts does at a run's end, with the files the test says it read). The run passed, with
// digested output. The verdict is read once the gate calls `judged` for the claim, which it does after the run has ended;
// a timer only bounds that wait. Nothing here knows what a verdict should be.
//
// Safety: every folder is under the system temp dir (`dh3114-*`), removed after each test; the only process started
// is git, each run to its end; no network, no model.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RecordedRun } from '../../../packages/gate/src/index.ts';
import { GateRunner, type ClaimCheck, type GateOptions, type RunKey } from '../../../packages/hub/src/gate-runner.ts';

const SHA = 'a'.repeat(64);
const dirs: string[] = [];
export const cleanup = (): void => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); };

/** git in the repo, with no user config, hooks or GIT_* env of the caller's; quotePath left at git's default. */
export function git(dir: string, args: string[], env: Record<string, string> = {}): string {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
    { cwd: dir, stdio: 'pipe', env: { ...clean, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...env } }).toString();
}
export function write(dir: string, files: Record<string, string>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

/** The approved check the claim is judged on: the task's definition's, covering R1 at unit depth. */
export const CHECK: ClaimCheck = { check: 'unit-tests', approved: 'approved', command: 'node --test test/', covers: ['R1'], depth: 'unit', on_base: 'passes', asserts: [], expected_ms: 1, source: 'definition' };

export interface Judged {
  outcome: string | undefined;
  reasons: string[];
  /** The check's own outcome on the claim. */
  check: string | undefined;
  /** The runs that started, by the files they read. */
  runs: string[][];
}

/**
 * A repo whose merge base (a real commit) holds `base`, a session on a branch of it whose worktree then gets
 * `claim` written over it (new files left untracked), and one claim's stop judged on CHECK, its run reading `read`.
 */
export async function judge(o: { base: Record<string, string>; claim: Record<string, string>; read: string[] }): Promise<Judged> {
  const dir = mkdtempSync(join(tmpdir(), 'dh3114-'));
  dirs.push(dir);
  git(dir, ['init', '-q', '-b', 'main']);
  write(dir, o.base);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const base = git(dir, ['rev-parse', 'HEAD']).trim();
  git(dir, ['checkout', '-q', '-b', 'session']);
  write(dir, o.claim);

  let snapshots = 0;
  const index = { GIT_INDEX_FILE: join(dir, '.git', 'snapshot-index') };
  const checkouts = {
    budget: () => ({ since: Date.now() }),
    snapshot: async () => { git(dir, ['add', '-A'], index); return { commit: `snap${++snapshots}`, wrote: true, tree: git(dir, ['write-tree'], index).trim() }; },
    checkout: async () => ({ dir, commit: `snap${snapshots}` }),
    ended: async () => undefined,
  } as unknown as ReturnType<GateOptions['checkouts']>;

  const runs: string[][] = [];
  const keys = new Map<string, RunKey | undefined>();
  let n = 0;
  // The gate calls `judged` once a run of the claim has ended and its verdict as it now stands can be read.
  let judged!: () => void;
  const verdictReady = new Promise<void>((done) => { judged = done; });
  const gate: GateRunner = new GateRunner({
    judged: async (claim) => { if (claim === 'claim:3114') judged(); },
    raw: async () => [], now: () => Date.now(), core: {} as GateOptions['core'], append: async () => undefined,
    start: async (r) => { const run = `run:${++n}`; keys.set(run, r.key); return run; },
    ended: async (run) => {
      runs.push([...o.read]);
      const record = gate.recorded(run, {
        run, outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [...o.read], mask: null, exit: { code: 0, signal: null, cause: 'exit' },
        output: { stdout: 'ok\n', stderr: '', sha256: { stdout: SHA, stderr: SHA } }, attempts: [], seeded: [], contract: null,
      } as unknown as RecordedRun);
      const key = keys.get(run);
      if (key) await gate.keyed(key, run, record);
      return record.outcome;
    },
    slots: () => ({ free: 4 }), budget_ms: 60_000, hold_ms: 60_000, checkouts: () => checkouts,
    invalid: async (claim, _commit, reason) => { throw Error(`BLOCKED: the gate refused ${claim} before its check ran: ${reason}`); },
    stopping: () => false, stoodIn: async () => undefined, kept: async () => true,
  });
  await gate.stop({ session: 'S3114', claim: 'claim:3114', task: 'task:3114', cwd: dir, base, requirements: [], checks: [CHECK], stopAt: Date.now() });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<never>((_, fail) => {
    // deadline: a gate that never judges the claim fails the test as BLOCKED instead of hanging it; the wait is for `judged`.
    timer = setTimeout(() => fail(Error(`BLOCKED: the gate never judged claim:3114 within 10 s (runs started: ${runs.length})`)), 10_000);
  });
  try { await Promise.race([verdictReady, hung]); } finally { clearTimeout(timer); }
  const v = gate.verdictOf('claim:3114');
  return { outcome: v?.outcome, reasons: v?.reasons ?? [], check: v?.checks.find((c) => c.check === CHECK.check)?.outcome, runs };
}

/** The reason line that says the check counts as the agent's own, or undefined. */
export const ownLine = (j: Judged): string | undefined => j.reasons.find((r) => r.includes(CHECK.check) && r.includes("counts as the agent's own"));
