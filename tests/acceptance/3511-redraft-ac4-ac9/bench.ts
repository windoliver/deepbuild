import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RecordedRun } from '../../../packages/gate/src/index.ts';
import { GateRunner, type ClaimCheck, type GateOptions, type RunKey } from '../../../packages/hub/src/gate-runner.ts';
import { bound } from '../999/helpers.ts';

const SHA = 'a'.repeat(64);
const CLAIM = 'claim:3511';
const dirs: string[] = [];

export const CHECK_NAME = 'price-check';
export const CHECK_SCRIPT = 'sh .deepbuild/checks/price.sh';

export const removeRepos = (): void => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); };

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

export const append = (dir: string, path: string, text: string): void => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  appendFileSync(join(dir, path), text);
};

export interface Repo { dir: string; outside: string; base: string }

export interface Judged { outcome: string | undefined; reasons: string[]; runs: number }

export function plainGitListing(r: Repo): string[] {
  return [git(r.dir, ['diff', '--name-only', r.base]), git(r.dir, ['ls-files', '--others', '--exclude-standard'])].join('\n').split('\n').filter(Boolean);
}

export async function judgeClaim(o: {
  base: Record<string, string>;
  beforeCommit?: ((r: Omit<Repo, 'base'>) => void) | undefined;
  claim: (r: Repo) => void;
  read: string[];
  command: string;
  hides?: string | undefined;
}): Promise<Judged> {
  const dir = mkdtempSync(join(tmpdir(), 'dh3511-'));
  const outside = mkdtempSync(join(tmpdir(), 'dh3511o-'));
  dirs.push(dir, outside);
  git(dir, ['init', '-q', '-b', 'main']);
  write(dir, o.base);
  o.beforeCommit?.({ dir, outside });
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  const base = git(dir, ['rev-parse', 'HEAD']).trim();
  git(dir, ['checkout', '-q', '-b', 'session']);
  const repo: Repo = { dir, outside, base };
  o.claim(repo);
  if (o.hides !== undefined && plainGitListing(repo).includes(o.hides)) {
    throw Error(`BLOCKED: the scene meant to hide ${JSON.stringify(o.hides)} from a plain read, but plain git lists it: ${JSON.stringify(plainGitListing(repo))}`);
  }

  const check: ClaimCheck = { check: CHECK_NAME, approved: 'approved', command: o.command, covers: ['R1'], depth: 'unit', on_base: 'passes', asserts: [], expected_ms: 1, source: 'definition' };
  let snapshots = 0;
  const index = { GIT_INDEX_FILE: join(outside, 'snapshot-index') };
  const checkouts = {
    budget: () => ({ since: Date.now() }),
    snapshot: async () => { git(dir, ['add', '-A'], index); return { commit: `snap${++snapshots}`, wrote: true, tree: git(dir, ['write-tree'], index).trim() }; },
    checkout: async () => ({ dir, commit: `snap${snapshots}` }),
    ended: async () => undefined,
  } as unknown as ReturnType<GateOptions['checkouts']>;

  let runs = 0;
  const keys = new Map<string, RunKey | undefined>();
  let refused: Judged | undefined;
  let judged!: () => void;
  const verdictReady = new Promise<void>((done) => { judged = done; });
  const gate: GateRunner = new GateRunner({
    judged: async (claim) => { if (claim === CLAIM) judged(); },
    raw: async () => [], now: () => Date.now(), core: {} as GateOptions['core'], append: async () => undefined,
    start: async (r) => { const run = `run:${++runs}`; keys.set(run, r.key); return run; },
    ended: async (run) => {
      const record = gate.recorded(run, {
        run, outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [...o.read], mask: null, exit: { code: 0, signal: null, cause: 'exit' },
        output: { stdout: 'ok\n', stderr: '', sha256: { stdout: SHA, stderr: SHA } }, attempts: [], seeded: [], contract: null,
      } as unknown as RecordedRun);
      const key = keys.get(run);
      if (key) await gate.keyed(key, run, record);
      return record.outcome;
    },
    slots: () => ({ free: 4 }), budget_ms: 60_000, hold_ms: 60_000, checkouts: () => checkouts,
    invalid: async (claim, _commit, reason, outcome) => { if (claim === CLAIM) { refused = { outcome: outcome ?? 'INVALID', reasons: [reason], runs }; judged(); } },
    stopping: () => false, stoodIn: async () => undefined, kept: async () => true,
  });
  await gate.stop({ session: 'S3511', claim: CLAIM, task: 'task:3511', cwd: dir, base, requirements: [], checks: [check], stopAt: Date.now() });
  await Promise.race([verdictReady, bound(20_000)]);
  if (refused) return refused;
  const v = gate.verdictOf(CLAIM);
  return { outcome: v?.outcome, reasons: v?.reasons ?? [], runs };
}
