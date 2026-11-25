// Test-side tools for issue #2060's acceptance tests (README): a fixture repo whose checks name `fixture-tool`, a Node
// script on the hub's PATH outside the system's folders; the real hub (`deep hub run`); two Claude Code sessions, each
// in a linked worktree of its own, that claim the same files one after the other; and the readings taken from the record
// and `changes.read`. Nothing here stands in for DeepBuild: every reading comes from the real hub, deep-hook and record.
//
// From tests/acceptance/3229/helpers.ts: the world's layout, the followed record, the sessions and their hooks (fired
// again until the record holds their event, so a test judges the hub, never the machine's load), the bound and the
// cleanup. This file adds its own repo, the program and a hub whose PATH holds it.
//
// Safety: every folder is under that helper's /tmp/dh3229-* and removed after its test; HOME is the test's own for every
// process; no network, no model, no real `claude`; a process is stopped only by the PID it was started with.

import { spawn } from 'node:child_process';
import { mkdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import {
  bound, childEnv, cleanup as cleanupWorlds, CLI, cut, git, Log, makeWorld, NODE, open, PROMPT, shown, stopHub,
  type Ev, type Hub, type Line, type Worker, type World,
} from '../3229/helpers.ts';

/** Each criterion's tag: `#2060.` and the first 8 hex of SHA-256 of its text, trimmed, white space collapsed (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #2060.6d14b8db',
  2: 'AC2 #2060.df8e51b3',
  3: 'AC3 #2060.e0ef1360',
  4: 'AC4 #2060.ad981d1d',
} as const;

/** The planted wrong programs the criteria name (README, Proof on a wrong program), selected with DEEP_HUB_PLANT. */
export const PLANTS = {
  /** AC1: a key that leaves the program readings out. */
  leavesOut: 'key-leaves-out-programs',
  /** AC2: a key that holds the path of the run's own link to the program. */
  holdsLink: 'key-holds-program-link',
  /** AC3: a hub that adds the readings to head keys only. */
  headOnly: 'program-readings-head-only',
  /** AC4: a reader that skips a program it can't find. */
  skips: 'skips-absent-program',
} as const;

// ---- The program: on the hub's PATH a link, as a package manager's are, to the program's real file.
export const TOOL = 'fixture-tool';
const HEAD = "#!/usr/bin/env node\nconst { readFileSync } = require('node:fs');\nconst text = readFileSync('src/a.txt', 'utf8');\n";
/** Version 1: reads src/a.txt from its working directory and exits 0. */
const V1 = `${HEAD}console.log('fixture-tool 1 read', text.trim());\n`;
/** Version 2: a longer file that exits 1. */
export const V2 = `${HEAD}console.log('fixture-tool 2 read', text.trim());\nconsole.error('fixture-tool 2 finds the text wrong');\nprocess.exitCode = 1;\n`;
/** The fix check's version 2 (README, The surface under test): a longer file that still exits 0, so the head run passes and a base run is due. */
export const V2_EXITS_0 = `${HEAD}console.log('fixture-tool 2 read', text.trim(), 'and finds nothing wrong with it');\n`;
/** Puts the program's file in place as a package manager does: a new file, renamed over the one there. */
export function install(w: Fixture, source: string): void {
  writeFileSync(`${w.program}.new`, source, { mode: 0o755 });
  renameSync(`${w.program}.new`, w.program);
}
/** Takes the program off the hub's PATH, its file too. */
export function uninstall(w: Fixture): void {
  rmSync(join(w.tools, TOOL));
  rmSync(w.program);
}

// ---- The fixture repo: a text, a cart whose total ignores the discount, its test, and the two drafted checks.
export interface Check { check: string; on_base: 'passes' | 'fails'; asserts: string[] }
/** The check whose command is the program alone. */
export const TOOL_CHECK: Check = { check: '.deepbuild/checks/tool.sh', on_base: 'passes', asserts: [] };
/** A fix check: the program, then the test that fails on the merge base at its assertion, line 6, and passes on the fix. */
export const FIX_CHECK: Check = { check: '.deepbuild/checks/fix.sh', on_base: 'fails', asserts: ['test/cart.test.mjs:6'] };
const FILES: Record<string, string> = {
  'package.json': `${JSON.stringify({ name: 'shop2060', private: true, type: 'module' })}\n`,
  'src/a.txt': 'the text the program reads\n',
  'src/cart.mjs': 'export const total = (cart) => cart.items.reduce((a, b) => a + b, 0);\n',
  'test/cart.test.mjs': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { total } from '../src/cart.mjs';\n\ntest('the total takes the discount off', () => {\n  assert.equal(total({ items: [100], discount: 10 }), 90);\n});\n",
  [TOOL_CHECK.check]: `${TOOL}\n`,
  [FIX_CHECK.check]: `${TOOL} && node --test test/cart.test.mjs\n`,
};
/** What both sessions write: the fix, the same bytes in each worktree. */
const FIX = 'export const total = (cart) => cart.items.reduce((a, b) => a + b, 0) - cart.discount;\n';

/** #3229's world, with this suite's repo and its two linked worktrees in place of its sample, and the program. */
export interface Fixture extends World { base: string; tools: string; program: string }
function fixture(c: Check): Fixture {
  const w = makeWorld([{
    ask: PROMPT, deliverables: ['src/cart.mjs'], budget: null,
    requirements: [{ id: 'R1', text: 'The cart total takes the discount off', source_line: 'ask#L1', refuted_by: 'a cart whose total ignores its discount', ...c, depth: 'unit', oracle: 'code', near_misses: [] }],
  }], 0);
  const repo = join(w.tmp, 'shop');
  for (const [path, bytes] of Object.entries(FILES)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), bytes);
  }
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'the fixture repo and its drafted checks');
  const trees = ['a', 'b'].map((name) => join(w.tmp, name));
  for (const tree of trees) git(repo, 'worktree', 'add', '-q', '-b', `session-${tree.slice(-1)}`, tree, 'main');
  const f: Fixture = { ...w, trees: trees.map((t) => realpathSync(t)), base: git(repo, 'rev-parse', 'HEAD'), tools: join(w.tmp, 'tools'), program: join(w.tmp, 'programs', TOOL) };
  mkdirSync(f.tools);
  mkdirSync(dirname(f.program));
  symlinkSync(f.program, join(f.tools, TOOL));
  install(f, V1);
  return f;
}

// ---- The hub, its PATH the program's folder, Node's and the system's.
const hubs: Hub[] = [];
async function startHub(w: Fixture, plant?: string): Promise<Hub> {
  const env = childEnv(w.home, {
    PATH: [w.tools, dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_SECRETS: w.secrets, DEEP_HUB_PLANT: plant,
  });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: w.tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-20_000); });
  const hub: Hub = { child, socket: '', root: w.root, stderr: () => err };
  hubs.push(hub);
  const first = new Promise<Line | undefined>((done) => createInterface({ input: child.stdout }).once('line', (l) => { try { done(JSON.parse(l) as Line); } catch { done(undefined); } }));
  const exit = new Promise<undefined>((done) => child.once('exit', () => done(undefined)));
  const ready = await Promise.race([first, exit, bound(180_000)]);
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub${plant ? ` with the plant DEEP_HUB_PLANT=${plant}` : ''} did not start: ${err.slice(-1500)}`);
  hub.socket = String(ready.socket);
  return hub;
}
/** Stops the test's hub by its PID, then #3229's helper stops the sessions and removes the folders. */
export async function cleanup(): Promise<void> {
  for (const hub of hubs.splice(0)) await stopHub(hub);
  await cleanupWorlds();
}

// ---- Two sessions' claims, read from the record.
export interface Run { run: string; check: string; claim: string; commit: string; outcome: string | null }
/** One claim: every outcome its verdicts had, the last one, and every string its verdicts and its line (`changes.read`) say. */
export interface Claim { claim: string; outcomes: string[]; outcome: string; said: string[] }
export interface Reading { base: string; runs: Run[]; a: Claim; b: Claim }

const runsIn = (events: readonly Ev[]): Run[] => events.filter((e) => e.kind === 'run.started').map((e) => {
  const end = events.find((x) => x.kind === 'run.finished' && x.data.run === e.data.run);
  return { run: String(e.data.run), check: String(e.data.check), claim: String(e.data.claim), commit: String(e.data.commit), outcome: end ? String(end.data.outcome) : null };
});
const verdictsOf = (events: readonly Ev[], claim: string): Ev[] => events.filter((e) => e.kind === 'verdict.made' && e.subject === claim);
const strings = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : []);

/**
 * The session writes the fix and stops, which makes its claim; then its verdict is waited for, with every run of it ended.
 * A stop that makes no claim, a snapshot past the gate's own budget (it ran no check: the machine stalled) and a claim
 * with no verdict in ten minutes are BLOCKED.
 */
async function claimFix(k: Worker, r: Log): Promise<string> {
  await k.s.edit('src/cart.mjs', FIX);
  const from = r.events.length;
  const stop = await k.s.stop();
  const made = (): Ev | undefined => r.events.slice(from).find((e) => e.kind === 'claim.made' && e.data.task_ref === k.task);
  if (!await r.until(() => made() !== undefined, 300_000)) throw Error(`BLOCKED: the stop made no claim on ${k.task}: ${shown(stop)}; events ${r.events.slice(from).map((e) => e.kind).join(', ')}`);
  const claim = `claim:${made()!.id}`;
  const judged = await r.until((events) => verdictsOf(events, claim).length > 0 && runsIn(events).every((x) => x.claim !== claim || x.outcome !== null));
  const reasons = JSON.stringify(verdictsOf(r.events, claim).map((v) => v.data.reasons));
  if (!judged) throw Error(`BLOCKED: ${claim} has no verdict with its runs ended in ten minutes: verdicts ${cut(reasons)}; runs ${cut(JSON.stringify(runsIn(r.events)))}`);
  if (/over budget/.test(reasons) && !runsIn(r.events).some((x) => x.claim === claim)) throw Error(`BLOCKED: ${claim}'s snapshot went over the gate's budget, so no check of it ran: ${cut(reasons)}`);
  return claim;
}
async function read(r: Log, claim: string): Promise<Claim> {
  const verdicts = verdictsOf(r.events, claim);
  const change = (await r.call('changes.read', { id: claim })).change as Line | undefined;
  const outcomes = verdicts.map((v) => String(v.data.outcome));
  return { claim, outcomes, outcome: outcomes.at(-1)!, said: [...verdicts.flatMap((v) => strings(v.data)), String(change?.line ?? ''), String(change?.second ?? '')] };
}

/**
 * Session A claims the fix under version 1 of the program and reads PASS; `between` leaves, replaces or removes the
 * program; then session B, in its own worktree, claims the same files. Where A doesn't read PASS, or a fix check's claim
 * has no base run of its own to carry, the scenario never reached its criterion and is BLOCKED.
 */
export async function twoSessions(c: Check, between: (w: Fixture) => void, plant?: string): Promise<Reading> {
  const w = fixture(c);
  const r = await Log.open(await startHub(w, plant));
  try {
    const [a, b] = [await open(w, r, { tree: 0 }), await open(w, r, { tree: 1 })];
    const first = await claimFix(a, r);
    const seen = { base: w.base, runs: runsIn(r.events), a: await read(r, first) };
    const own = seen.runs.filter((x) => x.claim === first && x.check === c.check);
    if (seen.a.outcome !== 'PASS' || (c.on_base === 'fails' && !own.some((x) => x.commit === w.base))) throw Error(`BLOCKED: session A must read PASS under version 1 of ${TOOL}${c.on_base === 'fails' ? ', proven by a base run of its own' : ''}: ${shownReading({ ...seen, b: seen.a })}`);
    between(w);
    const second = await claimFix(b, r);
    return { base: w.base, runs: runsIn(r.events), a: await read(r, first), b: await read(r, second) };
  } finally {
    r.close();
  }
}

/** A check's runs for a claim: on its snapshot, and on the merge base. */
export const headRuns = (r: Reading, c: Claim, check: string): Run[] => r.runs.filter((x) => x.claim === c.claim && x.check === check && x.commit !== r.base);
export const baseRuns = (r: Reading, c: Claim, check: string): Run[] => r.runs.filter((x) => x.claim === c.claim && x.check === check && x.commit === r.base);
/** What a claim's verdicts and line mark as carried. */
export const carried = (c: Claim): string[] => c.said.filter((s) => /\bcarried\b/i.test(s));
/** A run that ended as neither a pass nor a fail (stopped, overran, missing, uncounted) is the machine's: nothing of the criterion was read, so it's BLOCKED. */
export function endedItself(x: Run, why: string, r: Reading): void {
  if (x.outcome !== 'passed' && x.outcome !== 'failed') throw Error(`BLOCKED: ${x.run} ended ${x.outcome}, and ${why}: ${shownReading(r)}`);
}
export const shownReading = (r: Reading): string => {
  const claim = (c: Claim): string => `${c.claim} read ${c.outcomes.join(', then ')}, saying ${cut(JSON.stringify(c.said.filter((s) => /\s/.test(s))), 1200)}`;
  return `A: ${claim(r.a)}; B: ${claim(r.b)}; runs ${r.runs.map((x) => `${x.run} (${x.check} on ${x.commit === r.base ? 'the merge base' : 'the snapshot'} for ${x.claim === r.a.claim ? 'A' : x.claim === r.b.claim ? 'B' : x.claim}: ${x.outcome ?? 'running'})`).join(', ') || 'none'}`;
};
