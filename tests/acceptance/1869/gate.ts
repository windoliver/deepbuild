// The gate runner on a bench, for #1869 (README): the hub's own GateRunner, given what packages/hub/src/core.ts gives
// it, as #2118's and #2647's suites build one (tests/acceptance/2118/gate.ts). Real: the gate runner, which reads what
// a claim changed from its worktree with git (`changesOf`: git diff against the merge base, git ls-files, git show);
// the base-commit service (`openCheckouts`, through #31's world), so the snapshot and the claim's checkout are git's;
// the record; and the check's program, a node script run in the checkout the gate names.
//
// What stands in:
// - the hub's run service, at the two calls the gate makes of it: `start` gets a run handle, and `ended` runs the
//   check's program there and records and keys the run as packages/hub/src/runs.ts does at a run's end (`recorded`,
//   then `keyed`);
// - git, at the process boundary only: a `git` first on PATH (the stub below) that runs the real git for every call
//   but the read the test stubs, and only in the claim's worktree. Nothing here knows what a verdict should be.
//
// Safety: every folder is #31's, under /tmp/dh31-*, removed after the file; HOME is a temp folder; no network, no
// model; the only processes started are git, the stub's `sleep` (stopped by its PID at close) and the check's node
// script, each run to its end.
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RecordedRun } from '../../../packages/gate/src/index.ts';
import { GateRunner, type ClaimCheck, type GateOptions, type RunKey } from '../../../packages/hub/src/gate-runner.ts';
import { ulid } from '../../../packages/record/src/index.ts';
import type { Verdict } from '../../../packages/verdicts/src/index.ts';
import { git, makeRepo, openWorld, tempDir, write, type World } from '../31/helpers.ts';

export { write };
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The approved check's test file: it passes on the merge base and on the claim. */
export const TEST_FILE = 'test/price.check.cjs';
const CODE = 'src/price.cjs';
const TEST_TEXT = "const assert = require('node:assert/strict');\nconst { total } = require('../src/price.cjs');\nassert.equal(total({ items: [100], discount: 10 }), 90, 'total takes the discount off');\n";
export const FILES: Record<string, string> = {
  'README.md': '# shop\n',
  [CODE]: 'exports.total = (cart) => cart.items.reduce((a, b) => a + b, 0) - cart.discount;\n',
  [TEST_FILE]: TEST_TEXT,
};
/** The claim's edit of the approved check's own test file: one more line, the assertion as it was, so it still passes. */
export const EDITED_TEST = `${TEST_TEXT}// the agent was here\n`;
const PROGRAM = { file: TEST_FILE, test: 'total takes the discount off' };
/** The task's approved definition check, as the definition locks it: its approved bytes by digest, the command its run is. */
export const PRICE: ClaimCheck = {
  check: 'price-approved', approved: `sha256:${sha256(TEST_TEXT)}`, command: `node ${TEST_FILE}`, covers: [], depth: 'unit', on_base: 'passes', asserts: [], expected_ms: 1, source: 'definition',
};

/** What the stub does to the read it stubs, in the claim's worktree only. */
export type Stub = 'off' | 'fail-diff' | 'hang-ls-files';
/** One read the stub stubbed: its PID, what it did and its arguments. */
export interface Stubbed { pid: number; did: string; args: string }
/** A claim's verdict as the hub would show it: the runner's `verdictOf`, or what it handed `invalid` for the claim. */
export interface Seen { outcome: string; reasons: string[]; at: number; via: 'verdictOf' | 'invalid' }

export interface Bench {
  gate: GateRunner;
  /** The repo's main checkout, on a branch cut from `base`: the session's worktree. */
  repo: string;
  base: string;
  /** The stop hold the runner was given. */
  hold_ms: number;
  /** Each start's outcome, in order. */
  outcomes: string[];
  /** Each verdict the runner handed `invalid` (a claim it judged without its checks), with when. */
  invalids: { claim: string; outcome: string; reason: string; at: number }[];
  /** Sets what the stub does from now on. */
  stub(mode: Stub): void;
  /** The reads the stub stubbed so far. */
  stubbed(): Stubbed[];
  /** The claim's verdict as it stands: one past pending from `verdictOf`, or what `invalid` was handed; undefined while there is none. */
  seen(claim: string): Seen | undefined;
  /** A stop's claim as the hub hands one to the gate, at `stopAt`. */
  stop(o: { session: string; claim: string; checks: ClaimCheck[]; stopAt: number }): Promise<unknown>;
  close(): Promise<void>;
}

const play = (cwd: string, file: string): Promise<{ code: number; stdout: string; stderr: string }> => new Promise((resolve) => {
  execFile(process.execPath, [file], { cwd, env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? cwd }, timeout: 120_000 }, (error, stdout, stderr) => {
    const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
    resolve({ code, stdout, stderr: error && !stderr ? error.message : stderr });
  });
});

/**
 * The stub git. Its subcommand is the first argument that is not an option or a `-c`/`-C` value. In the claim's
 * worktree (its folder, by `pwd -P`) and in the stub's mode:
 * - `fail-diff`: every `git diff` fails as git does on a read it can't make (exit 128, a `fatal:` line). The snapshot
 *   and the checkout make no `git diff` on the base; were one to, the snapshot would fail and the bench says so.
 * - `hang-ls-files`: every `git ls-files` hangs (it execs `sleep`), except the base-commit service's own: those carry
 *   its call shape, a short-option cluster other than a lone `-z` (`-v`, `-o`, `-oi`, `-co`) together with the
 *   environment its git always sets (`GIT_NO_LAZY_FETCH=1`, packages/gate/src/checkouts.ts `runGit`). The gate
 *   runner's reads of what a claim changed (`ls-files`, `ls-files --others --exclude-standard`) have neither on the
 *   base; a read that dropped either one is still stubbed.
 * Every other call, and every call anywhere else, is the real git's, exec'd with its arguments as they came.
 */
const STUB = (real: string, log: string, modeFile: string, worktree: string): string => `#!/bin/sh
mode=$(cat '${modeFile}' 2>/dev/null)
if [ "$mode" != off ] && [ "$(pwd -P)" = '${worktree}' ]; then
  sub=; skip=0; short=0
  for a in "$@"; do
    if [ -n "$sub" ]; then
      case "$a" in --) break ;; -z) ;; --*) ;; -?*) short=1 ;; esac
      continue
    fi
    if [ "$skip" = 1 ]; then skip=0; continue; fi
    case "$a" in -c|-C|--git-dir|--work-tree|--namespace) skip=1 ;; -*) ;; *) sub="$a" ;; esac
  done
  if [ "$mode" = fail-diff ] && [ "$sub" = diff ]; then
    echo "$$ failed $*" >> '${log}'
    echo "fatal: git diff could not be read (stubbed by #1869's test)" >&2
    exit 128
  fi
  if [ "$mode" = hang-ls-files ] && [ "$sub" = ls-files ] && ! { [ "$short" = 1 ] && [ "$GIT_NO_LAZY_FETCH" = 1 ]; }; then
    echo "$$ hung $*" >> '${log}'
    exec sleep 600
  fi
fi
exec '${real}' "$@"
`;

/** A repo whose merge base holds the check and its code, with the session on a branch of it; `hold_ms` is the runner's stop hold. */
export async function openBench(o: { hold_ms: number }): Promise<Bench> {
  const w: World = await openWorld();
  const service = await w.service();
  const repo = makeRepo(FILES);
  const base = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '-q', '-b', 'session-a']);

  // The stub, first on PATH for this process only, restored at close.
  const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const bin = tempDir();
  const log = join(bin, 'stubbed.log');
  const modeFile = join(bin, 'mode');
  writeFileSync(modeFile, 'off');
  writeFileSync(log, '');
  writeFileSync(join(bin, 'git'), STUB(real, log, modeFile, repo));
  chmodSync(join(bin, 'git'), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path ?? '/usr/bin:/bin'}`;

  const outcomes: string[] = [];
  const invalids: Bench['invalids'] = [];
  const going = new Map<string, { cwd: string; key: RunKey | undefined }>();
  const stops: Promise<unknown>[] = [];
  const options: GateOptions = {
    raw: (query, params) => w.record.raw(query, params),
    now: () => Date.now(),
    append: async (connection, input) => { await w.record.append(connection, input); },
    core: { writer: 'core', actor: 'you', scope: 'you' },
    start: async (r) => {
      const run = `run:${ulid(Date.now())}`;
      going.set(run, { cwd: r.cwd, key: r.key });
      return run;
    },
    ended: async (run) => {
      const { cwd, key } = going.get(run)!;
      const ran = await play(cwd, PROGRAM.file);
      let record: RecordedRun = {
        run, outcome: ran.code === 0 ? 'passed' : 'failed', testsRun: 1,
        failures: ran.code === 0 ? [] : [{ test: PROGRAM.test, file: PROGRAM.file, line: 3, stack: null, assertion: true, message: ran.stderr.slice(0, 500) }],
        evidence: [], read: [CODE, PROGRAM.file], mask: null, exit: { code: ran.code, signal: null, cause: 'exit' },
        output: { stdout: ran.stdout, stderr: ran.stderr, sha256: { stdout: sha256(ran.stdout), stderr: sha256(ran.stderr) } }, attempts: [], seeded: [], contract: null,
      };
      record = bench.gate.recorded(run, record);
      if (key) await bench.gate.keyed(key, run, record);
      outcomes.push(record.outcome);
      return record.outcome;
    },
    // As core.ts gives it: a 10 s snapshot budget; the hold is the test's.
    slots: () => ({ free: 4 }), budget_ms: 10_000, hold_ms: o.hold_ms,
    checkouts: () => service,
    invalid: async (claim, _commit, reason, outcome) => { invalids.push({ claim, outcome: outcome ?? 'INVALID', reason, at: Date.now() }); },
    stopping: () => false,
    stoodIn: async () => undefined,
    judged: async () => undefined,
  };
  const stubbed = (): Stubbed[] => (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n').filter(Boolean).map((line) => {
    const [pid, did, ...args] = line.split(' ');
    return { pid: Number(pid), did: did!, args: args.join(' ') };
  });
  const bench: Bench = {
    gate: new GateRunner(options), repo, base, hold_ms: o.hold_ms, outcomes, invalids,
    stub: (mode) => writeFileSync(modeFile, mode),
    stubbed,
    seen: (claim) => {
      const v: Verdict | undefined = bench.gate.verdictOf(claim);
      if (v && v.outcome !== 'pending') return { outcome: v.outcome, reasons: [...v.reasons], at: Date.now(), via: 'verdictOf' };
      const i = invalids.find((x) => x.claim === claim);
      return i ? { outcome: i.outcome, reasons: [i.reason], at: i.at, via: 'invalid' } : undefined;
    },
    stop: (s) => {
      const p = bench.gate.stop({ session: s.session, claim: s.claim, task: 'task:1869', cwd: repo, base, requirements: [], checks: s.checks, stopAt: s.stopAt });
      stops.push(p.catch(() => undefined));
      return p;
    },
    close: async () => {
      bench.stub('off');
      // The stub's hung reads end, by their PIDs: each is a process this bench's stub started.
      for (const s of stubbed()) if (s.did === 'hung') { try { process.kill(s.pid, 'SIGKILL'); } catch { /* already ended */ } }
      // What the gate still does for a stop (its checks, giving back its checkout) settles before the world closes.
      await Promise.race([Promise.all(stops), sleep(30_000)]);
      await sleep(200);
      process.env.PATH = path;
      await w.close();
    },
  };
  return bench;
}

/** How a verdict reads in a failure message. */
export const shown = (s: Seen | undefined): string => (s ? `${s.outcome} (from ${s.via}): ${JSON.stringify(s.reasons)}` : 'no verdict');
