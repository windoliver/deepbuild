// The gate runner on a bench, for AC1 (README), as #2118's suite builds one (tests/acceptance/2118/gate.ts): the hub's
// own GateRunner, given what packages/hub/src/core.ts gives it. Real: the gate runner, which works out a claim's
// changes from its worktree (git diff against the merge base, the untracked files, each runner config's text); the
// base-commit service (`openCheckouts`, through #31's world), so the snapshot and the claim's checkout are git's; the
// record; and the check's program, a node script run in the checkout the gate names.
//
// What stands in is the hub's run service, at the two calls the gate makes of it: `start` gets a run handle, and
// `ended` runs the check's program there and records and keys the run as packages/hub/src/runs.ts does at a run's end
// (`recorded`, then `keyed`). Nothing here knows what a verdict should be.
//
// Safety: every folder is #31's, under /tmp/dh31-*, removed after the file; HOME is a temp folder; no network, no
// model; the only processes started are git and the check's node script, each run to its end.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { RecordedRun } from '../../../packages/gate/src/index.ts';
import { GateRunner, type ClaimCheck, type GateOptions, type RunKey } from '../../../packages/hub/src/gate-runner.ts';
import { ulid } from '../../../packages/record/src/index.ts';
import { git, makeRepo, openWorld, type World } from '../31/helpers.ts';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The check's program: a test that passes, reading one source file. */
export const PROGRAM = { file: 'test/ok.check.cjs', test: 'the module loads', reads: 'pkg00/src/index.cjs' };
export const PROGRAM_FILES: Record<string, string> = {
  [PROGRAM.file]: "const assert = require('node:assert/strict');\nassert.equal(typeof require('../pkg00/src/index.cjs').ok, 'function', 'the module loads');\n",
  [PROGRAM.reads]: 'exports.ok = () => true;\n',
};
/** The task's definition check, as the hub hands one to the gate. */
export const CHECK: ClaimCheck = { check: 'ok', approved: null, command: `node ${PROGRAM.file}`, covers: [], depth: 'unit', on_base: 'passes', asserts: [], expected_ms: 1, source: 'definition' };

export interface Bench {
  gate: GateRunner;
  /** The repo's main checkout, on a branch cut from `base`: the session's folder. */
  repo: string;
  base: string;
  /** Each start's outcome, in order. */
  outcomes: string[];
  stop(o: { session: string; claim: string; checks: ClaimCheck[] }): Promise<void>;
  close(): Promise<void>;
}

const play = (cwd: string, file: string): Promise<{ code: number; stdout: string; stderr: string }> => new Promise((resolve) => {
  execFile(process.execPath, [file], { cwd, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? cwd }, timeout: 120_000 }, (error, stdout, stderr) => {
    const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
    resolve({ code, stdout, stderr: error && !stderr ? error.message : stderr });
  });
});

/** A repo whose merge base holds `files`, with the session on a branch of it. */
export async function openBench(files: Record<string, string>): Promise<Bench> {
  const w: World = await openWorld();
  const service = await w.service();
  const repo = makeRepo({ ...PROGRAM_FILES, ...files });
  const base = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '-q', '-b', 'session-a']);
  const outcomes: string[] = [];
  const going = new Map<string, { cwd: string; key: RunKey | undefined }>();
  const refused: string[] = [];
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
        failures: ran.code === 0 ? [] : [{ test: PROGRAM.test, file: PROGRAM.file, line: 2, stack: null, assertion: true, message: ran.stderr.slice(0, 500) }],
        evidence: [], read: [PROGRAM.reads, PROGRAM.file], mask: null, exit: { code: ran.code, signal: null, cause: 'exit' },
        output: { stdout: ran.stdout, stderr: ran.stderr, sha256: { stdout: sha256(ran.stdout), stderr: sha256(ran.stderr) } }, attempts: [], seeded: [], contract: null,
      };
      record = bench.gate.recorded(run, record);
      if (key) await bench.gate.keyed(key, run, record);
      outcomes.push(record.outcome);
      return record.outcome;
    },
    slots: () => ({ free: 4 }), budget_ms: 60_000, hold_ms: 900_000,
    checkouts: () => service,
    invalid: async (claim, _commit, reason, outcome) => { refused.push(`${claim} ${outcome ?? 'INVALID'}: ${reason}`); },
    stopping: () => false,
    stoodIn: async () => undefined,
    judged: async () => undefined,
  };
  const bench: Bench = {
    gate: new GateRunner(options), repo, base, outcomes,
    stop: async (o) => {
      await bench.gate.stop({ session: o.session, claim: o.claim, task: 'task:2647', cwd: repo, base, requirements: [], checks: o.checks, stopAt: Date.now() });
      if (refused.length) throw Error(`BLOCKED: the base-commit service gave ${o.claim} no snapshot and checkout (${refused.join('; ')}), so its check could not start`);
    },
    close: async () => {
      await sleep(200);
      await w.close();
    },
  };
  return bench;
}
