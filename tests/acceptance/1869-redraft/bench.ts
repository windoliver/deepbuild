// The gate runner on a bench, for #1869's two criteria (README): the hub's own GateRunner, given what
// packages/hub/src/core.ts gives it (its budget and its stop hold, STOP_HOLD_MS). Real: the gate runner, which works out
// what a claim changed from its worktree itself (`changesOf`: git diff, git ls-files, git show); the base-commit service
// (`openCheckouts`, through #31's world), so the snapshot and the claim's checkout are git's; the record; and the check's
// program, a node script run in the checkout the gate names.
//
// What stands in:
// - the hub's run service, at the two calls the gate makes of it, as #2118's bench does: `start` gets a run handle, and
//   `ended` runs the check's program there and records and keys the run as packages/hub/src/runs.ts does (`recorded`,
//   then `keyed`), the files it read being its own file and the code it requires;
// - git, at the process boundary: a script named `git`, first on this process's PATH, that execs the real git with the
//   same arguments, except in the session's worktree while a stub mode is armed: `diff-fails` makes every `git diff`
//   there exit 128 with git's own kind of message; `ls-files-hangs` makes every listing of tracked files there
//   (`git ls-files` with none of -o/--others, -i/--ignored, -v, and no GIT_INDEX_FILE: the snapshot never lists them so)
//   hang. Each stubbed call is logged with its PID, and a hung one is stopped by that PID when the test ends.
// Nothing here knows what a verdict should be.
//
// Safety: every folder is #31's, under /tmp/dh31-*, removed after the file; HOME is a temp folder; no network, no model;
// the only processes started are git, the stub's /bin/sh and the hang it execs, and the check's node script. A hung
// call left running is stopped by the PID it logged, after checking that PID still runs the stub's hang.
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Checkouts, ClaimRequirement, RecordedRun } from '../../../packages/gate/src/index.ts';
import { STOP_HOLD_MS } from '../../../packages/hub/src/claude-settings.ts';
import { GateRunner, type ClaimCheck, type GateOptions, type RunKey } from '../../../packages/hub/src/gate-runner.ts';
import { ulid } from '../../../packages/record/src/index.ts';
import type { Verdict } from '../../../packages/verdicts/src/index.ts';
import { git, makeRepo, openWorld, tempDir, write, type World } from '../31/helpers.ts';

export { STOP_HOLD_MS, write };
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// ---- The repo: one approved check, `total`, whose test file reads the code under test.
export const CODE = 'src/price.cjs';
export const TEST_FILE = 'test/total.check.cjs';
const TEST_NAME = 'total adds the items';
export const FILES: Record<string, string> = {
  'README.md': '# shop\n',
  [CODE]: 'exports.total = (items) => items.reduce((a, b) => a + b, 0);\n',
  [TEST_FILE]: `const assert = require('node:assert/strict');\nconst { total } = require('../src/price.cjs');\nassert.equal(total([1, 2]), 3, '${TEST_NAME}');\n`,
};
/** The claim's edit of the check's own test file: its assertion weakened, so the check still passes. */
export const EDITED_TEST = `const assert = require('node:assert/strict');\nconst { total } = require('../src/price.cjs');\nassert.equal(typeof total, 'function', '${TEST_NAME}');\n`;
/** The claim's edit of the code under test alone: same behavior, so the check passes and none of its own files changed. */
export const EDITED_CODE = 'exports.total = (items) => items.reduce((sum, n) => sum + n, 0);\n';
/** The requirement the check covers, at unit depth. */
export const REQUIREMENTS: ClaimRequirement[] = [{ req: 'R1', depth: 'unit', oracle: 'code', on_base: 'passes' }];
/** The task's definition check, as the hub hands one to the gate: approved, not the agent's own. */
export const TOTAL: ClaimCheck = { check: 'total', approved: null, command: `node ${TEST_FILE}`, covers: ['R1'], depth: 'unit', on_base: 'passes', asserts: [], expected_ms: 1, source: 'definition' };

// ---- The git stub.
export type StubMode = 'off' | 'diff-fails' | 'ls-files-hangs';
const REAL_GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
if (!REAL_GIT.startsWith('/')) throw Error(`BLOCKED: no git on PATH to stand behind the stub (found ${JSON.stringify(REAL_GIT)})`);
/** The hang a stubbed ls-files execs: long, so a runner with no deadline waits on it, and stopped by PID at the end. */
const HANG_S = 900;
const stubScript = (mode: string, log: string, worktree: string): string => `#!/bin/sh
# #1869's stand-in for git (bench.ts): the real git, but in one worktree while a mode is armed.
sub=""
skip=0
for a in "$@"; do
  if [ "$skip" = 1 ]; then skip=0; continue; fi
  case "$a" in
    -c|-C|--git-dir|--work-tree|--namespace|--exec-path) skip=1 ;;
    -*) ;;
    *) sub="$a"; break ;;
  esac
done
here=$(pwd -P)
armed=$(cat '${mode}' 2>/dev/null)
if [ "$here" = '${worktree}' ]; then
  if [ "$armed" = diff-fails ] && [ "$sub" = diff ]; then
    echo "$$ failed git $*" >> '${log}'
    echo "fatal: unable to read the index: Cannot allocate memory (stubbed)" >&2
    exit 128
  fi
  if [ "$armed" = ls-files-hangs ] && [ "$sub" = ls-files ] && [ -z "$GIT_INDEX_FILE" ]; then
    tracked=1
    for a in "$@"; do
      case "$a" in
        -o|--others|-i|--ignored|-v|-oi|-io|-co|-oc|--directory) tracked=0 ;;
      esac
    done
    if [ "$tracked" = 1 ]; then
      echo "$$ hung git $*" >> '${log}'
      exec sleep ${HANG_S}
    fi
  fi
fi
exec '${REAL_GIT}' "$@"
`;

/** One call the stub stood in for: its PID, what it did, and its arguments. */
export interface Stubbed { pid: number; did: 'failed' | 'hung'; args: string }

export interface Bench {
  gate: GateRunner;
  /** The repo's main checkout, on a branch cut from `base`: the session's folder. */
  repo: string;
  base: string;
  /** Each run's outcome, as the stand-in run service closed it. */
  outcomes: string[];
  /** Arms the git stub for the session's worktree. */
  arm(mode: StubMode): void;
  /** The calls the stub stood in for so far. */
  stubbed(): Stubbed[];
  /**
   * A stop's claim, as the hub hands one to the gate, with the hub's stop hold. Resolves with `replied` once the stop
   * resolves, or `hold ended` once the hold has ended (and a second's grace for the reply to land) without it.
   */
  stop(o: { session: string; claim: string }): Promise<{ replied: boolean; stopAt: number }>;
  /** The claim's verdict as the gate reads it now. */
  verdict(claim: string): Verdict | undefined;
  close(): Promise<void>;
}

const play = (cwd: string, file: string): Promise<{ code: number; stdout: string; stderr: string }> => new Promise((resolve) => {
  execFile(process.execPath, [file], { cwd, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? cwd }, timeout: 120_000 }, (error, stdout, stderr) => {
    const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
    resolve({ code, stdout, stderr: error && !stderr ? error.message : stderr });
  });
});

/** `p`, or `late` once `ms` have passed without it. */
function within<T>(p: Promise<T>, ms: number, late: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  // deadline: turns a stop that never replies, or a checkout never given back, into the test's reading, never a wait of its own
  const bound = new Promise<T>((done) => { timer = setTimeout(() => done(late), Math.max(0, ms)); });
  return Promise.race([p, bound]).finally(() => clearTimeout(timer));
}

/** Whether `pid` still runs the stub's hang: only then is it this bench's to stop. */
const isHang = (pid: number): boolean => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim() === `sleep ${HANG_S}`;
  } catch {
    return false;
  }
};

/** A repo whose merge base holds FILES, with the session on a branch of it, and `edit` written to its worktree. */
export async function openBench(edit: Record<string, string>): Promise<Bench> {
  const w: World = await openWorld();
  const service = await w.service();
  const repo = realpathSync(makeRepo(FILES));
  const base = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '-q', '-b', 'session-a']);
  write(repo, edit);

  const stubDir = tempDir();
  const modeFile = join(stubDir, 'mode');
  const log = join(stubDir, 'stubbed.log');
  writeFileSync(modeFile, 'off');
  writeFileSync(join(stubDir, 'git'), stubScript(modeFile, log, repo));
  chmodSync(join(stubDir, 'git'), 0o755);
  const pathBefore = process.env.PATH ?? '/usr/bin:/bin';
  process.env.PATH = `${stubDir}:${pathBefore}`;
  const stubbed = (): Stubbed[] => (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n').filter(Boolean).map((line) => {
    const [pid, did, , ...args] = line.split(' ');
    return { pid: Number(pid), did: did as Stubbed['did'], args: `git ${args.join(' ')}` };
  });

  // The base-commit service, its checkouts' return watched so the bench closes only once each is given back.
  const checkedOut = new Map<string, Promise<void>>();
  const givenBack = new Map<string, () => void>();
  const checkouts: Checkouts = {
    ...service,
    checkout: (r) => {
      for (const run of r.runs) checkedOut.set(run, new Promise<void>((done) => givenBack.set(run, done)));
      return service.checkout(r);
    },
    ended: async (checkout, run) => {
      try {
        await service.ended(checkout, run);
      } finally {
        givenBack.get(run)?.();
      }
    },
  };

  const outcomes: string[] = [];
  const going = new Map<string, { cwd: string; key: RunKey | undefined }>();
  const refused: string[] = [];
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
      const ran = await play(cwd, TEST_FILE);
      let record: RecordedRun = {
        run, outcome: ran.code === 0 ? 'passed' : 'failed', testsRun: 1,
        failures: ran.code === 0 ? [] : [{ test: TEST_NAME, file: TEST_FILE, line: 3, stack: null, assertion: true, message: ran.stderr.slice(0, 500) }],
        evidence: [], read: [CODE, TEST_FILE], mask: null, exit: { code: ran.code, signal: null, cause: 'exit' },
        output: { stdout: ran.stdout, stderr: ran.stderr, sha256: { stdout: sha256(ran.stdout), stderr: sha256(ran.stderr) } }, attempts: [], seeded: [], contract: null,
      };
      record = bench.gate.recorded(run, record);
      if (key) await bench.gate.keyed(key, run, record);
      outcomes.push(record.outcome);
      return record.outcome;
    },
    // As packages/hub/src/core.ts gives them: a 10 s budget and the stop hold.
    slots: () => ({ free: 4 }), budget_ms: 10_000, hold_ms: STOP_HOLD_MS,
    checkouts: () => checkouts,
    invalid: async (claim, _commit, reason, outcome) => { refused.push(`${claim} ${outcome ?? 'INVALID'}: ${reason}`); },
    stopping: () => false,
    stoodIn: async () => undefined,
    judged: async () => undefined,
  };
  const bench: Bench = {
    gate: new GateRunner(options), repo, base, outcomes,
    arm: (mode) => writeFileSync(modeFile, mode),
    stubbed,
    stop: async (o) => {
      const stopAt = Date.now();
      const stop = bench.gate.stop({ session: o.session, claim: o.claim, task: 'task:1869', cwd: repo, base, requirements: REQUIREMENTS, checks: [TOTAL], stopAt });
      stops.push(stop.catch(() => undefined));
      const replied = await within(stop.then(() => true), stopAt + STOP_HOLD_MS + 1_000 - Date.now(), false);
      if (refused.length) throw Error(`BLOCKED: the base-commit service gave ${o.claim} no snapshot and checkout (${refused.join('; ')}), so its check could not start`);
      return { replied, stopAt };
    },
    verdict: (claim) => bench.gate.verdictOf(claim),
    close: async () => {
      writeFileSync(modeFile, 'off');
      // A hung read the gate left running is stopped by the PID it logged: only then can the stop go on and end.
      for (const s of stubbed()) if (s.did === 'hung' && isHang(s.pid)) process.kill(s.pid, 'SIGKILL');
      await within(Promise.all(stops), 120_000, undefined);
      await within(Promise.all(checkedOut.values()), 120_000, undefined);
      process.env.PATH = pathBefore;
      await w.close();
    },
  };
  return bench;
}

/** How a verdict reads in a failure message. */
export const shown = (v: Verdict | undefined): string => (v ? `${v.outcome}; reasons: ${JSON.stringify(v.reasons)}` : 'no verdict');
