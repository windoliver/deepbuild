// Shared by the #1864 acceptance tests (README): the repo's specs, the handed definition, the three writes no hook
// sees, and one scenario, a trusted fixture repo in which a Claude Code session works, `.deepbuild/done.yaml` is changed
// on disk behind every hook, and the session stops; the claim that stop makes is read back from the record. The world
// is #322's (../322/helpers.ts): a temp home, a git repo whose base commit holds `.deepbuild/done.yaml`, the project
// trusted by #348's decision, the real hub (`deep hub run`), and a session whose hooks run through the real deep-hook.
// The claim's reader and its wait are after tests/acceptance/2205/helpers.ts (same repo, same license); this suite
// keeps its own so a redraft of theirs never moves these tests. Nothing here stands in for DeepBuild, and no file of
// the code under test is imported or read.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';
import {
  BEHAVIOR, CLI, DEEP_HOOK, FIX, FLAG, Inconclusive, Session, allEvents, askNamed, claimsOf, git, lastPos, loadReading, lockedFor, makeWorld, proposalsNaming, req, settle,
  shown, sleep, startHub, taskOf, tempDir, trustRepo, verdictsOf, type Draft, type Ev, type Hub, type World,
} from '../322/helpers.ts';

/** The file the issue is about, as the criteria name it. */
export const SPEC_FILE = '.deepbuild/done.yaml';

// ---- The repo's specs, `.deepbuild/done.yaml`, as the base commit holds them: the revision that stands in for the
// approved one until the repo has one (issue, Scope: "the revision its claim's base commit holds stands in, never the
// worktree's"). `unit` is #322's unit test, a node:test run; it fails at the base commit's code and passes once #322's
// FIX is made. `typecheck` is a second node:test run, which passes on the base commit's code and after either edit.
/** The run line the base commit holds for `unit`. */
export const UNIT_RUN = 'node --test tests/unit.test.js';
export const TYPECHECK_RUN = 'node --test tests/types.test.js';
const UNIT = `unit: { type: command, run: "${UNIT_RUN}" }`;
const TYPECHECK = `typecheck: { type: command, run: "${TYPECHECK_RUN}" }`;
/** One spec check, `unit`. */
export const UNIT_ONLY = `claims: {done: {checks: [unit]}}\nchecks:\n  ${UNIT}\n`;
/** Two spec checks, `unit` and `typecheck`, the design's example names. */
export const UNIT_AND_TYPECHECK = `claims: {done: {checks: [unit, typecheck]}}\nchecks:\n  ${UNIT}\n  ${TYPECHECK}\n`;
const TYPES_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\ntest('checkToken is a function that answers a boolean', () => {\n  assert.strictEqual(typeof auth.checkToken, 'function');\n  assert.strictEqual(typeof auth.checkToken({ exp: 4102444800 }), 'boolean');\n});\n";

// ---- The task and its handed definition: #322's prompt, and one requirement, R1, judged by a drafted node:test check
// that fails on the base commit (`rejectsExpired` is false there) and passes once the session makes #322's FLAG. So in
// every scenario the definition's own check passes on the claim, and what the claim's spec checks do is the spec's.
export const R1_CHECK = '.deepbuild/checks/says-rejects.sh';
const R1_TEST = '.deepbuild/checks/says-rejects.test.js';
const FILES: Record<string, string> = {
  [R1_CHECK]: `#!/bin/sh\n# Drafted check: the middleware says it rejects expired tokens.\nnode --test ${R1_TEST}\n`,
  [R1_TEST]: "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../../src/auth.js');\ntest('the middleware says it rejects expired tokens', () => {\n  assert.strictEqual(auth.rejectsExpired, true);\n});\n",
  'tests/types.test.js': TYPES_TEST,
};
const DRAFT: Draft = {
  ask: BEHAVIOR, requirements: [req('R1', 'The middleware says it rejects expired tokens', { check: R1_CHECK, asserts: [`${R1_TEST}:5`] })], deliverables: [FLAG.file], budget: null,
};

// ---- The three writes. Each changes `.deepbuild/done.yaml` in the session's worktree directly, as a child of a
// command the agent ran would (design: Threats, What a command's children do): no PreToolUse and no PostToolUse is
// fired for it, so no guard sees it. A write that doesn't land is BLOCKED: the criterion's situation never arose.
export interface Write { how: string; make(w: World): void }
const specPath = (w: World): string => join(w.repo, SPEC_FILE);
const landed = (ok: boolean, what: string): void => { if (!ok) throw Error(`BLOCKED: the write to ${SPEC_FILE} didn't land: ${what}`); };
/** Criterion 1: `unit`'s run line becomes the command `true`, which exits 0 whatever the code does. */
export const RUN_TO_TRUE: Write = {
  how: 'unit\'s run line rewritten on disk to "true"',
  make(w) {
    const now = readFileSync(specPath(w), 'utf8');
    writeFileSync(specPath(w), now.replace(`run: "${UNIT_RUN}"`, 'run: "true"'));
    const after = readFileSync(specPath(w), 'utf8');
    landed(after !== now && after.includes('unit: { type: command, run: "true" }') && !after.includes(UNIT_RUN), `it holds ${JSON.stringify(after)}`);
  },
};
/** Criterion 2: the file is deleted. */
export const DELETED: Write = {
  how: `${SPEC_FILE} deleted on disk`,
  make(w) {
    rmSync(specPath(w));
    landed(!existsSync(specPath(w)), 'the file is still there');
  },
};
/** A folder outside every world, where only a process outside the gate's sandbox can write. */
export interface Outside { built: string; reached: string }
export function outsideFolder(): Outside {
  const dir = tempDir();
  return { built: join(dir, 'built'), reached: join(dir, 'reached') };
}
/**
 * Criterion 3: an `outside` entry, in the form this repo's own spec writes one (`outside: {checks, build}`, #33), is
 * added. It names `unit` as a check to run outside the sandbox, and its build writes the file `built`.
 */
export const outsideAdded = (o: Outside): Write => ({
  how: `an outside entry naming unit, with a build, added on disk to ${SPEC_FILE}`,
  make(w) {
    const now = readFileSync(specPath(w), 'utf8');
    writeFileSync(specPath(w), `${now}outside:\n  checks: [unit]\n  build: "echo built > ${o.built}"\n`);
    landed(readFileSync(specPath(w), 'utf8').startsWith(now) && readFileSync(specPath(w), 'utf8').includes(`build: "echo built > ${o.built}"`), `it holds ${JSON.stringify(readFileSync(specPath(w), 'utf8'))}`);
  },
});
/**
 * Criterion 3's unit test: #322's test, and one more that tries to write the file `reached`, which lies outside the
 * run's checkout. The gate's sandbox refuses that write, so the test passes in it; a run outside the sandbox writes
 * the file, and the test fails.
 */
export const unitTestReaching = (o: Outside): string => [
  "const test = require('node:test');", "const assert = require('node:assert');", "const fs = require('node:fs');", "const auth = require('../src/auth.js');",
  "test('checkToken rejects an expired token', () => {", '  assert.strictEqual(auth.checkToken({ exp: 1 }), false);', '});',
  "test('a write outside the checkout is refused', () => {", `  assert.throws(() => fs.writeFileSync(${JSON.stringify(o.reached)}, 'reached'));`, '});', '',
].join('\n');

/** How long the handed definition may take to lock, and a claim's checks to settle, on a machine other sessions load. */
const LOCK_MS = 180_000;
const SETTLE_MS = 900_000;
/** How long the record must stay still, every started run finished, before a verdict that is neither PASS nor FAIL is read as the claim's. */
const QUIET_MS = 30_000;
/** The same, when a check the scenario waits for has no run at all: read then as never run. */
const STALL_MS = 180_000;
/** How long the difference may take to become a proposal after the claim is judged. */
const PROPOSAL_MS = 60_000;
/** How long the sandbox's refusal of a run's write may take to reach the record after the claim is judged. */
const DENIED_MS = 60_000;

// ---- The record: one claim's verdicts and runs.
export interface RunRead { run: string; check: string; outcome: string | null; started: Ev; finished: Ev | undefined }
export interface ClaimRead {
  /** claim:<id> */
  claim: string;
  /** Every verdict.made about it, in log order. */
  verdicts: Ev[];
  /** The latest verdict's outcome, or null with none. */
  outcome: string | null;
  /** The runs started for it, each with how it ended, or null while it hasn't. */
  runs: RunRead[];
}
function readClaim(events: readonly Ev[], made: Ev): ClaimRead {
  const claim = `claim:${made.id}`;
  const finished = new Map(events.filter((e) => e.kind === 'run.finished').map((e) => [String(e.data.run), e]));
  const verdicts = verdictsOf(events, claim);
  return {
    claim, verdicts,
    outcome: verdicts.length ? String(verdicts.at(-1)!.data.outcome) : null,
    runs: events.filter((e) => e.kind === 'run.started' && e.data.claim === claim).map((e) => {
      const f = finished.get(String(e.data.run));
      return { run: String(e.data.run), check: String(e.data.check), outcome: f ? String(f.data.outcome) : null, started: e, finished: f };
    }),
  };
}
/** The runs of one check on the claim, by the name the spec gives it or the definition's file. */
export const runsOf = (c: ClaimRead, check: string): RunRead[] => c.runs.filter((r) => r.check === check);
/** How the runs of one check on the claim that ended did end. */
export const endedOf = (c: ClaimRead, check: string): string[] => runsOf(c, check).flatMap((r) => (r.outcome === null ? [] : [r.outcome]));
/** The claim in one line, for failure messages: each verdict with its reasons, and each run with the command it ran and how it ended. */
export const shownClaim = (c: ClaimRead): string => `${c.claim}: ${c.verdicts.map((v) => `verdict ${String(v.data.outcome)} ${JSON.stringify(v.data.reasons ?? [])}`).join(', then ') || 'no verdict'}; `
  + `its runs: ${c.runs.map((r) => `${r.check} (${JSON.stringify(r.started.data.command ?? null)}) ${r.outcome ?? 'unfinished'}`).join(', ') || 'none'}`;

// ---- The scenario.
const loaded = (): boolean => loadavg()[0]! > availableParallelism();
/** A step of the setup that didn't happen inside its wait: INCONCLUSIVE (a skip, never a pass) when other work loads the machine past its cores, else BLOCKED. */
const unsettled = (why: string): Error => (loaded() ? new Inconclusive(`${why}; ${loadReading()}`) : Error(`BLOCKED: ${why}`));
/** The task the prompt opened, once its handed definition locked. */
function lockedTask(events: readonly Ev[], s: Session): string | undefined {
  const ref = taskOf(askNamed(events, s, BEHAVIOR));
  return ref !== undefined && lockedFor(events, ref).length > 0 ? ref : undefined;
}
/**
 * Reads the record until the task's claim after `since` is judged, at most SETTLE_MS. PASS is made only once nothing
 * is pending, so it is read at once. FAIL outranks every verdict, so it is read once each check in `waitsFor` has a
 * finished run. Any other verdict is made while runs may still come (design: "any other verdict is made at once, and a
 * verdict only rises as pending results land"), so it is read once every run started for the claim has finished, each
 * check in `waitsFor` has a finished run, and no run or verdict of the claim has come for QUIET_MS. A claim on which a
 * check in `waitsFor` has no run is read once nothing has come for STALL_MS. Resolves with the last read either way.
 */
async function judged(hub: Hub, ref: string, since: number, waitsFor: readonly string[]): Promise<Ev[]> {
  const deadline = Date.now() + SETTLE_MS;
  let seen = '';
  let still = Date.now();
  for (;;) {
    const events = await allEvents(hub);
    const made = claimsOf(events, ref, since)[0];
    const c = made ? readClaim(events, made) : undefined;
    const now = c ? `${c.verdicts.length} ${c.runs.map((r) => `${r.run}${r.outcome ?? ''}`).join(' ')}` : '';
    if (now !== seen) { seen = now; still = Date.now(); }
    if (c?.outcome === 'PASS') return events;
    const ended = c !== undefined && c.verdicts.length > 0 && c.runs.every((r) => r.outcome !== null);
    const waited = c !== undefined && waitsFor.every((check) => endedOf(c, check).length > 0);
    const quiet = Date.now() - still;
    if (ended && waited && (c.outcome === 'FAIL' || quiet >= QUIET_MS)) return events;
    if ((ended && quiet >= STALL_MS) || Date.now() > deadline) return events;
    await sleep(500);
  }
}

export interface Scene {
  /** The repo's `.deepbuild/done.yaml` at its base commit. */
  spec: string;
  /** Files the base commit holds beside the world's, path to bytes. */
  files?: Record<string, string>;
  /** The session's own edits, each through its hooks: #322's FLAG, which R1's check needs, and FIX, which `unit` needs. */
  edits: readonly { file: string; from: string; to: string }[];
  /** The write no hook sees, made after the session's edits and before its stop. */
  write: Write;
  /** The checks the scenario expects to run on the claim. */
  waitsFor: readonly string[];
}
export interface Scenario {
  hub: Hub;
  /** The log's last position before the write: the claim and every proposal the write leads to come after it. */
  wrote: number;
  /** The record as last read, once the claim was judged. */
  events: Ev[];
  /** The next claim after the write. */
  claim: ClaimRead;
}
/**
 * One world and one claim. The repo's base commit holds `spec` as its `.deepbuild/done.yaml`, and the repo is trusted
 * by the core's decision. A Claude Code session types #322's prompt, Reads src/auth.js, its handed definition locks,
 * and it makes the scene's edits through its hooks. Then the scene's write changes `.deepbuild/done.yaml` on disk with
 * no hook fired, and the session stops, which makes the next claim. Resolves once that claim is judged, with what the
 * record holds of it. A hub that can't start is BLOCKED (thrown); a base commit that doesn't hold the spec, a write
 * that doesn't land, a definition that never locks, a stop that makes no claim and a claim with no verdict are BLOCKED
 * too, or INCONCLUSIVE under load.
 */
export async function claimAfter(scene: Scene): Promise<Scenario> {
  for (const [built, how] of [[CLI, 'npm run build --workspaces'], [DEEP_HOOK, 'cargo build --locked -p deep-hook']] as const) {
    if (!existsSync(built)) throw Error(`BLOCKED: the suite starts ${built}, which isn't built: ${how}`);
  }
  const w = makeWorld({ drafts: [DRAFT], spec: scene.spec, files: { ...FILES, ...scene.files } });
  const committed = git(w.tmp, w.repo, ['show', `${w.base}:${SPEC_FILE}`]);
  if (committed !== scene.spec.trim()) throw Error(`BLOCKED: the base commit ${w.base} must hold the spec as ${SPEC_FILE}: it holds ${JSON.stringify(committed)}`);
  await trustRepo(w, true);
  const hub = await startHub(w);
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read(FLAG.file);
  const opened = await settle(hub, (all) => lockedTask(all, s) !== undefined, LOCK_MS);
  const ref = lockedTask(opened, s);
  if (ref === undefined) throw unsettled(`the prompt "${BEHAVIOR}" opened no task with a locked definition within ${LOCK_MS / 1000} s: the record holds ${opened.map((e) => e.kind).join(', ')}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
  for (const e of scene.edits) await s.edit(e.file, e.from, e.to);
  const wrote = await lastPos(hub);
  scene.write.make(w);
  const stop = await s.stop('Done.');
  const events = await judged(hub, ref, wrote, scene.waitsFor);
  const made = claimsOf(events, ref, wrote)[0];
  if (!made) throw unsettled(`the stop after the write made no claim for ${ref}: the Stop hook: ${shown(stop)}; since the write the record holds ${events.filter((e) => e.log_pos > wrote).map((e) => e.kind).join(', ')}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
  const claim = readClaim(events, made);
  if (!claim.verdicts.length) throw unsettled(`the claim had no verdict ${SETTLE_MS / 1000} s after its stop: ${shownClaim(claim)}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
  return { hub, wrote, events, claim };
}
/** The edits a scene makes: FLAG alone leaves `unit` failing; FLAG and FIX make it pass. */
export const FLAG_ONLY = [FLAG] as const;
export const FLAG_AND_FIX = [FLAG, FIX] as const;

/** The proposals (`*.proposed`) whose data names `.deepbuild/done.yaml`, recorded up to the write. */
export const proposedBefore = (r: Scenario): Ev[] => proposalsNaming(r.events, 0, SPEC_FILE).filter((e) => e.log_pos <= r.wrote);
/** The proposals whose data names `.deepbuild/done.yaml`, recorded after the write: read for at most PROPOSAL_MS more. */
export async function proposedAfter(r: Scenario): Promise<{ naming: Ev[]; all: Ev[] }> {
  const events = await settle(r.hub, (all) => proposalsNaming(all, r.wrote, SPEC_FILE).length > 0, PROPOSAL_MS);
  return { naming: proposalsNaming(events, r.wrote, SPEC_FILE), all: events.filter((e) => e.log_pos > r.wrote && /\.proposed$/.test(e.kind)) };
}
/**
 * What the sandbox refused the given runs (`sandbox.denied`, which the supervisor records for a run in its sandbox),
 * and which of those name `target`: read for at most DENIED_MS more, since the system log hands a refusal over after
 * the fact.
 */
export async function deniedAfter(r: Scenario, runs: readonly RunRead[], target: string): Promise<{ naming: Ev[]; all: Ev[] }> {
  const of = (all: readonly Ev[]): Ev[] => all.filter((e) => e.kind === 'sandbox.denied' && runs.some((run) => run.run === String(e.data.run)));
  const names = (e: Ev): boolean => String(e.data.target) === target;
  const events = await settle(r.hub, (all) => of(all).some(names), DENIED_MS);
  return { naming: of(events).filter(names), all: of(events) };
}
