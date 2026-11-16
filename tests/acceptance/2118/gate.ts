// The gate runner on a bench, for AC1 to AC3 (README): the hub's own GateRunner, given what packages/hub/src/core.ts
// gives it. Real: the gate runner; the base-commit service (`openCheckouts`, through #31's world), so every snapshot,
// claim checkout and merge-base checkout is git's, made from real repos and linked worktrees; the record its queries
// and events go to; and each check's program, a node script run in the folder the gate names.
//
// What stands in is the hub's run service, at the two calls the gate makes of it: `start`, which AC2 and AC3 name, and
// `ended`. A start the test refuses rejects with the test's cause. Any other gets a run handle; when the gate asks how
// it ended, the check's program is run there, and the run is recorded and keyed as packages/hub/src/runs.ts does at a
// run's end (`recorded`, then `keyed` when the start carried a key) before `ended` resolves. Nothing here knows what a
// verdict should be.
//
// Safety: every folder is #31's, under /tmp/dh31-*, removed after the file; HOME is a temp folder; no network, no
// model; the only processes started are git and the check's node script, each run to its end.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { TestContext } from 'vitest';
import type { RecordedRun } from '../../../packages/gate/src/index.ts';
import { GateRunner, type ClaimCheck, type GateOptions, type RunKey, type StatePin } from '../../../packages/hub/src/gate-runner.ts';
import { ulid } from '../../../packages/record/src/index.ts';
import { git, makeRepo, openWorld, write, type World } from '../31/helpers.ts';

export { write };
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A reading load spoiled, such as a snapshot past the service's 8 s of git work: a skip, never a pass and never a failure. */
export class Inconclusive extends Error {}
export async function verdict(ctx: TestContext, judge: () => Promise<void>): Promise<void> {
  try {
    await judge();
  } catch (error) {
    if (error instanceof Inconclusive) ctx.skip(`INCONCLUSIVE ${error.message}`);
    throw error;
  }
}

// ---- The repo: main is broken. `total` ignores the discount, so the price check fails on every commit that holds
// this file as it is, the merge base among them; the sum check passes.
export const CODE = 'src/price.cjs';
export const FILES: Record<string, string> = {
  'README.md': '# shop\n',
  [CODE]: 'exports.total = (cart) => cart.items.reduce((a, b) => a + b, 0);\n',
  'test/price.check.cjs': "const assert = require('node:assert/strict');\nconst { total } = require('../src/price.cjs');\nassert.equal(total({ items: [100], discount: 10 }), 90, 'total takes the discount off');\n",
  'test/sum.check.cjs': "const assert = require('node:assert/strict');\nconst { total } = require('../src/price.cjs');\nassert.equal(total({ items: [1, 2], discount: 0 }), 3, 'total adds the items');\n",
};
/** A check's program: the script the bench runs for it, and the one test it holds. */
interface Program { file: string; test: string }
const PROGRAMS: Record<string, Program> = {
  price: { file: 'test/price.check.cjs', test: 'total takes the discount off' },
  sum: { file: 'test/sum.check.cjs', test: 'total adds the items' },
};
export const PRICE_TEST = PROGRAMS.price!.test;
const claimCheck = (check: string, source: 'spec' | 'definition'): ClaimCheck => ({
  check, approved: null, command: `node ${PROGRAMS[check]!.file}`, covers: [], depth: 'unit', on_base: 'passes', asserts: [], expected_ms: 1, source,
});
/** The repo's spec check, as the hub makes one from .deepbuild/done.yaml: a command alone, covering the claim as a whole. It fails while `total` ignores the discount. */
export const PRICE: ClaimCheck = claimCheck('price', 'spec');
/** A check that passes on this repo. */
export const SUM: ClaimCheck = claimCheck('sum', 'definition');

/** A workspace's state reading (#67), as a claim pins it: what its checks read now, and what was pinned at the lock. */
export const reading = (open: number): StatePin => {
  const text = `{"open":${open}}\n`;
  return { digests: [sha256(text)], files: { 'state/now.json': text }, pinned: { 'state/lock.json': text } };
};

/** One start the gate asked for: where, for which claim and check, and how it went. */
export interface Started {
  claim: string; check: string; cwd: string; commit: string;
  /** A run on the merge base (its key says so). */
  base: boolean;
  /** The run's handle, or null when the start rejected. */
  run: string | null;
  /** The cause the start rejected with. */
  refused: string | null;
  /** How the run ended, once the gate asked. */
  outcome: string | null;
}
export interface Bench {
  gate: GateRunner;
  /** The repo's main checkout, on a branch cut from `base`: one session's folder. */
  repo: string;
  /** The merge base: main's commit. */
  base: string;
  /** Every start the gate asked for, in order. */
  starts: Started[];
  /** Each claim the gate said a run of ended (GateOptions.judged), in order. */
  judged: string[];
  /** While set, every start rejects with the error it returns. */
  refuse: (() => Error) | undefined;
  /** A linked worktree of the repo on a branch of its own, cut from `base`: another session's folder. */
  worktree(name: string): string;
  /** A stop's claim, as the hub hands one to the gate; resolves once its fast lane has ended. */
  stop(o: { session: string; claim: string; cwd: string; checks: ClaimCheck[]; same?: boolean; state?: StatePin }): Promise<void>;
  close(): Promise<void>;
}

const play = (cwd: string, file: string): Promise<{ code: number; stdout: string; stderr: string }> => new Promise((resolve) => {
  execFile(process.execPath, [file], { cwd, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? cwd }, timeout: 300_000 }, (error, stdout, stderr) => {
    const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
    resolve({ code, stdout, stderr: error && !stderr ? error.message : stderr });
  });
});

export async function openBench(): Promise<Bench> {
  const w: World = await openWorld();
  const service = await w.service();
  const repo = makeRepo(FILES);
  const base = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '-q', '-b', 'session-a']);
  const starts: Started[] = [];
  const judged: string[] = [];
  const overBudget: string[] = [];
  const going = new Map<string, { at: Started; key: RunKey | undefined }>();
  const options: GateOptions = {
    raw: (query, params) => w.record.raw(query, params),
    now: () => Date.now(),
    append: async (connection, input) => { await w.record.append(connection, input); },
    core: { writer: 'core', actor: 'you', scope: 'you' },
    start: async (r) => {
      const at: Started = { claim: r.claim, check: r.check, cwd: r.cwd, commit: r.commit, base: r.key?.base === true, run: null, refused: null, outcome: null };
      starts.push(at);
      const refusal = bench.refuse?.();
      if (refusal) {
        at.refused = refusal.message;
        throw refusal;
      }
      at.run = `run:${ulid(Date.now())}`;
      going.set(at.run, { at, key: r.key });
      return at.run;
    },
    ended: async (run) => {
      const { at, key } = going.get(run)!;
      const program = PROGRAMS[at.check]!;
      const ran = await play(at.cwd, program.file);
      const message = ran.stderr.split('\n').find((l) => /AssertionError|Error:/.test(l))?.trim() ?? `exited ${ran.code}`;
      let record: RecordedRun = {
        run, outcome: ran.code === 0 ? 'passed' : 'failed', testsRun: 1,
        failures: ran.code === 0 ? [] : [{ test: program.test, file: program.file, line: 3, stack: null, assertion: true, message }],
        evidence: [], read: [CODE, program.file], mask: null, exit: { code: ran.code, signal: null, cause: 'exit' },
        output: { stdout: ran.stdout, stderr: ran.stderr, sha256: { stdout: sha256(ran.stdout), stderr: sha256(ran.stderr) } }, attempts: [], seeded: [], contract: null,
      };
      record = bench.gate.recorded(run, record);
      if (key) await bench.gate.keyed(key, run, record);
      at.outcome = record.outcome;
      return record.outcome;
    },
    slots: () => ({ free: 4 }), budget_ms: 60_000, hold_ms: 900_000,
    checkouts: () => service,
    invalid: async (claim, _commit, reason, outcome) => { overBudget.push(`${claim} ${outcome ?? 'INVALID'}: ${reason}`); },
    stopping: () => false,
    stoodIn: async () => undefined,
    judged: async (claim) => { judged.push(claim); },
  };
  const bench: Bench = {
    gate: new GateRunner(options), repo, base, starts, judged, refuse: undefined,
    worktree: (name) => {
      const dir = join(dirname(repo), name);
      git(repo, ['worktree', 'add', '-q', '-b', name, dir, 'main']);
      return dir;
    },
    stop: async (o) => {
      const before = overBudget.length;
      await bench.gate.stop({
        session: o.session, claim: o.claim, task: 'task:2118', cwd: o.cwd, base, requirements: [], checks: o.checks, stopAt: Date.now(),
        ...(o.same ? { same: true } : {}), ...(o.state ? { state: o.state } : {}),
      });
      if (overBudget.length > before) throw new Inconclusive(`the base-commit service gave ${o.claim} no snapshot and checkout (${overBudget.slice(before).join('; ')}), so none of its checks could start`);
    },
    close: async () => {
      // What the gate still gives back (a claim's checkout, a reading) settles first.
      await sleep(200);
      await w.close();
    },
  };
  return bench;
}

/** How a start reads in a failure message. */
export const shownStarts = (starts: readonly Started[]): string => starts.map((s) => `${s.check} for ${s.claim}${s.base ? ' on the merge base' : ''}: ${s.refused !== null ? `start rejected (${s.refused})` : `${s.run} ${s.outcome ?? 'going'}`}`).join('; ') || 'none';
