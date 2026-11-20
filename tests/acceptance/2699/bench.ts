// The gate runner on a bench, for #2699 (README): the hub's own GateRunner, given what packages/hub/src/core.ts gives it.
// Real: the gate runner; the base-commit service (`openCheckouts`, through #31's world), so every snapshot and every
// checkout is git's, made from a real repo into the service's real checkouts' folder; the record its queries and events
// go to; and each check's program, a node script run in the folder the gate names.
//
// What stands in is the hub's run service, at the two calls the gate makes of it: `start` and `ended`. A start in no
// folder rejects, as the hub's run service can't start a command nowhere. Any other gets a run handle; when the gate
// asks how it ended, the check's program is run in that folder, and the run is recorded and keyed as
// packages/hub/src/runs.ts does at a run's end (`recorded`, then `keyed`) before `ended` resolves. A test may hold one
// run's end until it lets it go, so a check has not ended when the next stop comes. Nothing here knows what a verdict
// should be, or whether a stop should make a checkout.
//
// What the bench counts, outside the code under test:
// - every file and folder that appears under the checkouts' folder (the service's `root`), by watching it, and
// - every git process started while it counts, by a `git` first on PATH that writes one line per process (its folder
//   and arguments) and then runs the real git. Every process the gate and the base-commit service start on this bench
//   is git: the repo has no ignored dependency folder, so no copy of one is started.
//
// Safety: every folder is #31's, under /tmp/dh31-*, removed after the file; HOME is a temp folder; no network, no model;
// the only processes started are git and the check's node script, each run to its end.
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { TestContext } from 'vitest';
import type { RecordedRun } from '../../../packages/gate/src/index.ts';
import { GateRunner, type ClaimCheck, type GateOptions, type RunKey, type StatePin } from '../../../packages/hub/src/gate-runner.ts';
import { ulid } from '../../../packages/record/src/index.ts';
import type { Verdict } from '../../../packages/verdicts/src/index.ts';
import { git, makeRepo, openWorld, tempDir, write, type World } from '../31/helpers.ts';

export { git, write };
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

// ---- The repo: `total` takes the discount off, so the price check passes; the sum check passes; the state check
// passes while the workspace's reading (#67) has at most one open item.
export const CODE = 'src/price.cjs';
export const CODE_BYTES = 'exports.total = (cart) => cart.items.reduce((a, b) => a + b, 0) - cart.discount;\n';
/** The same file changed by one byte: `-` becomes `+`, so the total adds the discount and the price check fails. */
export const CODE_ONE_BYTE = CODE_BYTES.replace('- cart.discount', '+ cart.discount');
export const STATE_FILE = 'state/now.json';
const FILES: Record<string, string> = {
  'README.md': '# shop\n',
  [CODE]: CODE_BYTES,
  'test/price.check.cjs': "const assert = require('node:assert/strict');\nconst { total } = require('../src/price.cjs');\nassert.equal(total({ items: [100], discount: 10 }), 90, 'total takes the discount off');\n",
  'test/sum.check.cjs': "const assert = require('node:assert/strict');\nconst { total } = require('../src/price.cjs');\nassert.equal(total({ items: [1, 2], discount: 0 }), 3, 'total adds the items');\n",
  'test/state.check.cjs': "const assert = require('node:assert/strict');\nconst { readFileSync } = require('node:fs');\nassert.ok(JSON.parse(readFileSync('state/now.json', 'utf8')).open <= 1, 'at most one item is open');\n",
};
interface Program { file: string; test: string; read: string[] }
const PROGRAMS: Record<string, Program> = {
  price: { file: 'test/price.check.cjs', test: 'total takes the discount off', read: [CODE, 'test/price.check.cjs'] },
  sum: { file: 'test/sum.check.cjs', test: 'total adds the items', read: [CODE, 'test/sum.check.cjs'] },
  state: { file: 'test/state.check.cjs', test: 'at most one item is open', read: [STATE_FILE, 'test/state.check.cjs'] },
};
const claimCheck = (check: string): ClaimCheck => ({
  check, approved: null, command: `node ${PROGRAMS[check]!.file}`, covers: [], depth: 'unit', on_base: 'passes', asserts: [], expected_ms: 1, source: 'definition',
});
export const PRICE: ClaimCheck = claimCheck('price');
export const SUM: ClaimCheck = claimCheck('sum');
/** A check that reads the workspace's state (#67): its recorded reads are the state file the claim pins. */
export const STATE: ClaimCheck = claimCheck('state');

/** A workspace's state reading (#67), as a claim pins it: what its checks read now, and what was pinned at the lock. */
export const reading = (open: number, pinned = 1): StatePin => {
  const text = `{"open":${open}}\n`;
  const lock = `{"open":${pinned}}\n`;
  return { digests: [sha256(text)], files: { [STATE_FILE]: text }, pinned: { 'state/lock.json': lock } };
};

/** One start the gate asked for: where, for which claim and check, and how it went. */
export interface Started {
  claim: string; check: string; cwd: string; commit: string;
  /** The run's handle, or null when the start rejected. */
  run: string | null;
  refused: string | null;
  /** How the run ended, once it did. */
  outcome: string | null;
  /** What the check's program found in its folder as it ran: the code file, and the state file when there is one. */
  code: string | null; state: string | null;
}
/** What the bench counted between `count()` and `counted()`. */
export interface Counted {
  /** Each top-level folder or file made under the checkouts' folder, by name: one per checkout. */
  checkouts: string[];
  /** Every path under the checkouts' folder that a write touched. */
  written: string[];
  /** Every git process started: its folder and its arguments. */
  processes: { cwd: string; args: string[] }[];
}
export interface Bench {
  gate: GateRunner;
  /** The session's worktree: the repo's main checkout, on a branch cut from `base`. */
  repo: string;
  /** The merge base: main's commit. */
  base: string;
  /** The base-commit service's checkouts' folder. */
  root: string;
  starts: Started[];
  /** Holds the end of the next run started of this check until the returned function is called. */
  holdNext(check: string): () => void;
  /** A stop's claim, as the hub hands one to the gate; resolves once its fast lane has ended or its hold has. */
  stop(o: { claim: string; checks: ClaimCheck[]; same?: boolean; state?: StatePin; hold_ms?: number }): Promise<void>;
  /** Waits for what came before to settle, then starts counting: from here every write under the checkouts' folder and every git process is kept. */
  count(): Promise<void>;
  /** Waits until every run started has ended and nothing was written or started for 1.5 s, and answers what was counted since `count()`. */
  counted(): Promise<Counted>;
  close(): Promise<void>;
}

const play = (cwd: string, file: string): Promise<{ code: number; stdout: string; stderr: string }> => new Promise((resolve) => {
  execFile(process.execPath, [file], { cwd, env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? cwd }, timeout: 300_000 }, (error, stdout, stderr) => {
    const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
    resolve({ code, stdout, stderr: error && !stderr ? error.message : stderr });
  });
});
/** A hold long enough that a stop resolves when its fast lane has ended. */
const HOLD_MS = 600_000;
const readOr = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);

/** A `git` that writes its folder and arguments, one process to a record, then runs the real git. */
function countingGit(dir: string, log: string): void {
  const real = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  if (!real || real.startsWith(dir)) throw Error(`BLOCKED: no git found on PATH (${process.env.PATH ?? ''})`);
  mkdirSync(dir, { recursive: true });
  // One record per process, written with one write so records of processes running at once never interleave:
  // RS, the folder, US, then each argument followed by US.
  const script = [
    '#!/bin/bash',
    'line="\x1e$(pwd -P)\x1f"',
    'for a in "$@"; do line="$line$a\x1f"; done',
    `printf '%s\\n' "$line" >> '${log}'`,
    `exec '${real}' "$@"`,
    '',
  ].join('\n');
  writeFileSync(join(dir, 'git'), script);
  chmodSync(join(dir, 'git'), 0o755);
}
const processesIn = (log: string): { cwd: string; args: string[] }[] => (existsSync(log) ? readFileSync(log, 'utf8') : '')
  .split('\x1e').slice(1).map((rec) => { const [cwd = '', ...args] = rec.replace(/\n$/, '').split('\x1f'); args.pop(); return { cwd, args }; });

export async function openBench(): Promise<Bench> {
  const w: World = await openWorld();
  const service = await w.service();
  const repo = makeRepo(FILES);
  const base = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '-q', '-b', 'session-a']);
  mkdirSync(w.root, { recursive: true });
  const root = realpathSync(w.root);

  // The counting git, first on PATH for this process and everything it starts.
  const tools = tempDir();
  const log = join(tools, 'git.log');
  countingGit(join(tools, 'bin'), log);
  const path = process.env.PATH;
  process.env.PATH = `${join(tools, 'bin')}:${path ?? '/usr/bin:/bin'}`;

  // Every path under the checkouts' folder a write touches, from the moment counting starts, leaving out the folders
  // already there when it started (an earlier claim's checkout, still in use or being given back).
  let counting = false;
  let already = new Set<string>();
  const touched: string[] = [];
  let lastTouch = 0;
  const watcher: FSWatcher = watch(root, { recursive: true }, (_event, name) => {
    lastTouch = Date.now();
    if (!counting || !name || already.has(String(name).split('/')[0]!)) return;
    touched.push(String(name));
  });
  let logFrom = 0;

  const starts: Started[] = [];
  const going = new Map<string, { at: Started; key: RunKey | undefined; held: Promise<void> | undefined }>();
  const holds = new Map<string, Promise<void>>();
  const overBudget: string[] = [];
  // The stop's hold, read by the gate at each stop: the shipped bench waits for the fast lane; a test may cut one stop's short.
  let holdMs = HOLD_MS;
  const options: GateOptions = {
    raw: (query, params) => w.record.raw(query, params),
    now: () => Date.now(),
    append: async (connection, input) => { await w.record.append(connection, input); },
    core: { writer: 'core', actor: 'you', scope: 'you' },
    start: async (r) => {
      const at: Started = { claim: r.claim, check: r.check, cwd: r.cwd, commit: r.commit, run: null, refused: null, outcome: null, code: null, state: null };
      starts.push(at);
      if (typeof r.cwd !== 'string' || !existsSync(r.cwd) || !statSync(r.cwd).isDirectory()) {
        at.refused = `no folder to run in: ${String(r.cwd)}`;
        throw Error(at.refused);
      }
      at.run = `run:${ulid(Date.now())}`;
      const held = holds.get(r.check);
      holds.delete(r.check);
      going.set(at.run, { at, key: r.key, held });
      return at.run;
    },
    ended: async (run) => {
      const { at, key, held } = going.get(run)!;
      if (held) await held;
      const program = PROGRAMS[at.check]!;
      at.code = readOr(join(at.cwd, CODE));
      at.state = readOr(join(at.cwd, STATE_FILE));
      const ran = await play(at.cwd, program.file);
      const message = ran.stderr.split('\n').find((l) => /AssertionError|Error:/.test(l))?.trim() ?? `exited ${ran.code}`;
      let record: RecordedRun = {
        run, outcome: ran.code === 0 ? 'passed' : 'failed', testsRun: 1,
        failures: ran.code === 0 ? [] : [{ test: program.test, file: program.file, line: 3, stack: null, assertion: true, message }],
        evidence: [], read: program.read, mask: null, exit: { code: ran.code, signal: null, cause: 'exit' },
        output: { stdout: ran.stdout, stderr: ran.stderr, sha256: { stdout: sha256(ran.stdout), stderr: sha256(ran.stderr) } }, attempts: [], seeded: [], contract: null,
      };
      record = bench.gate.recorded(run, record);
      if (key) await bench.gate.keyed(key, run, record);
      at.outcome = record.outcome;
      return record.outcome;
    },
    slots: () => ({ free: 4 }), budget_ms: 60_000,
    get hold_ms() { return holdMs; },
    checkouts: () => service,
    invalid: async (claim, _commit, reason, outcome) => { overBudget.push(`${claim} ${outcome ?? 'INVALID'}: ${reason}`); },
    stopping: () => false,
    stoodIn: async () => undefined,
  };
  const bench: Bench = {
    gate: new GateRunner(options), repo, base, root, starts,
    holdNext: (check) => {
      let release!: () => void;
      holds.set(check, new Promise<void>((done) => { release = done; }));
      return release;
    },
    stop: async (s) => {
      const before = overBudget.length;
      holdMs = s.hold_ms ?? HOLD_MS;
      await bench.gate.stop({
        session: 'session-a', claim: s.claim, task: 'task:2699', cwd: repo, base, requirements: [], checks: s.checks, stopAt: Date.now(), definition: 'locked',
        ...(s.same ? { same: true } : {}), ...(s.state ? { state: s.state } : {}),
      });
      if (overBudget.length > before) throw new Inconclusive(`the base-commit service gave ${s.claim} no snapshot and checkout inside its budget (${overBudget.slice(before).join('; ')})`);
    },
    count: async () => {
      // What came before settles first: no write under the checkouts' folder and no git process for 1.5 s.
      let seen = -1;
      let quiet = Date.now();
      for (const deadline = Date.now() + 300_000; Date.now() < deadline;) {
        const n = processesIn(log).length;
        if (n !== seen) { seen = n; quiet = Date.now(); }
        if (Date.now() - Math.max(quiet, lastTouch) >= 1500) break;
        await sleep(100);
      }
      already = new Set(readdirSync(root));
      touched.length = 0;
      logFrom = processesIn(log).length;
      counting = true;
    },
    counted: async () => {
      const deadline = Date.now() + 600_000;
      let seen = -1;
      let quiet = Date.now();
      for (;;) {
        const n = processesIn(log).length;
        const idle = starts.every((s) => s.run === null || s.outcome !== null);
        if (n !== seen || !idle) { seen = n; quiet = Date.now(); }
        if ((idle && Date.now() - Math.max(quiet, lastTouch) >= 1500) || Date.now() > deadline) break;
        await sleep(100);
      }
      counting = false;
      const processes = processesIn(log).slice(logFrom);
      // A checkout is a folder made under the checkouts' folder: seen by the watcher, or named by a git process that worked there.
      const tops = new Set(touched.map((p) => p.split('/')[0]!).filter(Boolean));
      for (const p of processes) for (const at of [p.cwd, ...p.args.map((a) => a.replace(/^--[\w-]+=/, ''))]) if (at.startsWith(`${root}/`)) tops.add(at.slice(root.length + 1).split('/')[0]!);
      return { checkouts: [...tops].filter((t) => !already.has(t)).sort(), written: [...new Set(touched)].sort(), processes };
    },
    close: async () => {
      watcher.close();
      process.env.PATH = path;
      // What the gate still gives back (a claim's checkout) settles first.
      await sleep(300);
      await w.close();
    },
  };
  return bench;
}

/** How the starts read in a failure message. */
export const shownStarts = (starts: readonly Started[]): string => starts.map((s) => `${s.check} for ${s.claim}${s.refused !== null ? `: start rejected (${s.refused})` : ` in ${s.cwd}: ${s.run} ${s.outcome ?? 'going'}`}`).join('; ') || 'none';
/** A verdict as the claim records it, without the claim's own name: its outcome, the commit it covers, each check's result and counted runs, and its send-backs. */
export const recorded = (v: Verdict | undefined): unknown => (v === undefined ? 'no verdict' : {
  outcome: v.outcome, commit: v.commit,
  checks: v.checks.map((c) => ({ check: c.check, outcome: c.outcome, counted: c.counted, stale: c.stale, inherited: c.inherited })).sort((a, b) => a.check.localeCompare(b.check)),
  send_backs: v.send_backs, requirements: v.requirements.map((r) => ({ req: r.req, outcome: r.outcome, counted: r.runs.counted })),
});
export const shownVerdict = (v: Verdict | undefined): string => (v ? `${v.outcome} (${v.reasons.join('; ') || 'no reasons'})` : 'no verdict');
/** The turn's work that changes no file: `git status` and one shell command, run in the session's worktree. */
export function commandsChangingNothing(repo: string): void {
  git(repo, ['status', '--porcelain']);
  execFileSync('/bin/sh', ['-c', 'ls -la src > /dev/null'], { cwd: repo });
}
