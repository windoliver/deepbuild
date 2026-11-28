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

export const CODE = 'src/price.cjs';
export const TEST_FILE = 'test/total.check.cjs';
const TEST_NAME = 'total adds the items';
export const FILES: Record<string, string> = {
  'README.md': '# shop\n',
  [CODE]: 'exports.total = (items) => items.reduce((a, b) => a + b, 0);\n',
  [TEST_FILE]: `const assert = require('node:assert/strict');\nconst { total } = require('../src/price.cjs');\nassert.equal(total([1, 2]), 3, '${TEST_NAME}');\n`,
};
export const EDITED_TEST = `const assert = require('node:assert/strict');\nconst { total } = require('../src/price.cjs');\nassert.equal(typeof total, 'function', '${TEST_NAME}');\n`;
export const EDITED_CODE = 'exports.total = (items) => items.reduce((sum, n) => sum + n, 0);\n';
export const REQUIREMENTS: ClaimRequirement[] = [{ req: 'R1', depth: 'unit', oracle: 'code', on_base: 'passes' }];
export const TOTAL: ClaimCheck = { check: 'total', approved: null, command: `node ${TEST_FILE}`, covers: ['R1'], depth: 'unit', on_base: 'passes', asserts: [], expected_ms: 1, source: 'definition' };

export type StubMode = 'off' | 'diff-fails' | 'ls-files-hangs';
const REAL_GIT = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
if (!REAL_GIT.startsWith('/')) throw Error(`BLOCKED: no git on PATH to stand behind the stub (found ${JSON.stringify(REAL_GIT)})`);
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

export interface Stubbed { pid: number; did: 'failed' | 'hung'; args: string }

export interface Bench {
  gate: GateRunner;
  repo: string;
  base: string;
  outcomes: string[];
  arm(mode: StubMode): void;
  stubbed(): Stubbed[];
  stop(o: { session: string; claim: string }): Promise<{ replied: boolean; stopAt: number }>;
  verdict(claim: string): Verdict | undefined;
  close(): Promise<void>;
}

const play = (cwd: string, file: string): Promise<{ code: number; stdout: string; stderr: string }> => new Promise((resolve) => {
  execFile(process.execPath, [file], { cwd, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? cwd }, timeout: 120_000 }, (error, stdout, stderr) => {
    const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
    resolve({ code, stdout, stderr: error && !stderr ? error.message : stderr });
  });
});

function within<T>(p: Promise<T>, ms: number, late: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  // deadline: turns a stop that never replies, or a checkout never given back, into the test's reading, never a wait of its own
  const bound = new Promise<T>((done) => { timer = setTimeout(() => done(late), Math.max(0, ms)); });
  return Promise.race([p, bound]).finally(() => clearTimeout(timer));
}

const isHang = (pid: number): boolean => {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim() === `sleep ${HANG_S}`;
  } catch {
    return false;
  }
};

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
      for (const s of stubbed()) if (s.did === 'hung' && isHang(s.pid)) process.kill(s.pid, 'SIGKILL');
      await within(Promise.all(stops), 120_000, undefined);
      await within(Promise.all(checkedOut.values()), 120_000, undefined);
      process.env.PATH = pathBefore;
      await w.close();
    },
  };
  return bench;
}

export const shown = (v: Verdict | undefined): string => (v ? `${v.outcome}; reasons: ${JSON.stringify(v.reasons)}` : 'no verdict');
