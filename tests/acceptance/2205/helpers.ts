// Shared by the #2205 acceptance tests (README): the criteria's IDs, the repo's specs as the issue writes them, the
// handed definition, and one scenario, a trusted fixture repo in which a Claude Code session makes a fix and stops, read
// back from the record. The world is #322's (../322/helpers.ts): a temp home, a git repo with `.deepbuild/done.yaml`,
// the project trusted by #348's decision, the real hub (`deep hub run`), and a session whose hooks run through the real
// deep-hook. Nothing here stands in for DeepBuild, and no file of the code under test is imported or read.
import { existsSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import {
  BEHAVIOR, CLI, DEEP_HOOK, FIX, Inconclusive, Session, allEvents, askNamed, claimsOf, lastPos, loadReading, lockedFor, makeWorld, req, settle, shown, sleep, startHub,
  taskOf, trustRepo, verdictsOf, type Draft, type Ev, type Hub,
} from '../322/helpers.ts';

/** Each criterion's ID: `#2205.` and the first 8 hex of SHA-256 of its text, trimmed, white space collapsed (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #2205.a7438bd1';
export const AC2 = 'AC2 #2205.df00835d';
export const AC3 = 'AC3 #2205.e7406ea9';
export const AC4 = 'AC4 #2205.98714b31';
/** The issue's Scope, for the shapes its first sentence covers that no criterion's fixture has, and for its owner. Not a criterion's tag. */
export const SCOPE = 'Scope #2205';

// ---- The repo's specs, `.deepbuild/done.yaml`. `unit` is #322's check, written with `min_tests` as the design's
// example and this repo's own spec write it, a key the issue leaves out of this task; `typecheck` is a second node:test
// run the hermetic runner counts. Both pass once the session's fix is made.
const UNIT = 'unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }';
const TYPECHECK = 'typecheck: { type: command, run: "node --test tests/types.test.js" }';
/** A journey as the design's example writes it: a type and a file, no run line. */
export const JOURNEY_FILE = '.deepbuild/journeys/checkout.yaml';
const CHECKOUT = `checkout: {type: journey, file: ${JOURNEY_FILE}}`;
/** The journey file the entry names, in the journey kind's form, so the file itself is there to be run. */
export const JOURNEY_YAML = [
  '# Paying: /cart, Pay, then the confirmation.', 'journey: checkout', 'feature: checkout', 'depth: journey', 'masks: []', 'steps:',
  '  - id: open', '    deadline: 10000', '    goto: /cart', '  - id: pay', '    deadline: 5000', '    click: { role: button, name: Pay }',
  'end_state:', '  - id: order-placed', '    oracle: code', '    locator: { role: status, name: Order }', '    visible: true', '',
].join('\n');

/** AC1: the done claim names `typechek`; `checks` defines `unit` and `typecheck`. */
export const MISSPELLED = `claims: {done: {checks: [unit, typechek]}}\nchecks:\n  ${UNIT}\n  ${TYPECHECK}\n`;
/** AC2: the done claim names `checkout`, an entry with a type and a file and no run line. */
export const JOURNEY = `claims: {done: {checks: [unit, checkout]}}\nchecks:\n  ${UNIT}\n  ${CHECKOUT}\n`;
/** AC3: a done.yaml that ends inside an open `checks: [`, with no line break after it, so the file's last line is the only line a parser can stop on. */
export const UNCLOSED = [
  '# .deepbuild/done.yaml: what a claim of done must pass in this repo.',
  '# unit runs the unit tests and typecheck the type tests.',
  '# Drafted once and approved; a change to it comes as a proposal.',
  'checks:',
  `  ${UNIT}`,
  `  ${TYPECHECK}`,
  'claims:',
  '  # What an agent says when a task is finished.',
  '  done:',
  '    # Every check a claim of done runs, by its name under checks.',
  '    # The list is written on one line.',
  '    checks: [',
].join('\n');
/** The line UNCLOSED ends on, counted from 1: the open `checks: [`, where the file ends and a parser stops. */
export const STOP_LINE = UNCLOSED.split('\n').length;
/** AC4, the twin: the done claim names only checks `checks` defines, each with a run line. */
export const DEFINED = `claims: {done: {checks: [unit, typecheck]}}\nchecks:\n  ${UNIT}\n  ${TYPECHECK}\n`;
/** Scope: no `claims` block, so the claim takes every check `checks` holds (the base's rule), and `checkout` has no run line. */
export const NO_CLAIMS = `checks:\n  ${UNIT}\n  ${CHECKOUT}\n`;
/** Scope: the done claim names `typecheck`, an entry of the command kind with no run line. */
export const NO_RUN = `claims: {done: {checks: [unit, typecheck]}}\nchecks:\n  ${UNIT}\n  typecheck: { type: command }\n`;
/** Scope: the done claim names `typecheck` and the spec has no `checks` block, so no check of the spec can run. */
export const NO_CHECKS = 'claims: {done: {checks: [typecheck]}}\n';

// ---- The task and its handed definition: #322's prompt, and one requirement, R1, judged by a drafted node:test check
// that fails on the base commit (`checkToken` takes any token whose exp is above 0) and passes once the session makes
// #322's FIX, which makes the spec's unit test pass too.
export const R1_CHECK = '.deepbuild/checks/expired-rejected.sh';
const R1_TEST = '.deepbuild/checks/expired-rejected.test.js';
const FILES: Record<string, string> = {
  [R1_CHECK]: `#!/bin/sh\n# Drafted check: a token whose exp has passed is rejected.\nnode --test ${R1_TEST}\n`,
  [R1_TEST]: "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../../src/auth.js');\ntest('a token whose exp has passed is rejected', () => {\n  assert.strictEqual(auth.checkToken({ exp: 1 }), false);\n});\n",
  'tests/types.test.js': "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\ntest('checkToken is a function that answers a boolean', () => {\n  assert.strictEqual(typeof auth.checkToken, 'function');\n  assert.strictEqual(typeof auth.checkToken({ exp: 4102444800 }), 'boolean');\n});\n",
};
const DRAFT: Draft = {
  ask: BEHAVIOR, requirements: [req('R1', 'A token whose exp has passed is rejected', { check: R1_CHECK, asserts: [`${R1_TEST}:5`] })], deliverables: [FIX.file], budget: null,
};

/** How long the handed definition may take to lock, and a claim's checks to settle, on a machine other sessions load. */
const LOCK_MS = 180_000;
const SETTLE_MS = 900_000;
/** How long the record must stay still, every started run finished, before a verdict that isn't PASS or FAIL is read as the claim's. */
const QUIET_MS = 30_000;

// ---- The record: one claim's verdicts and runs.
export interface RunRead { run: string; check: string; outcome: string | null }
export interface ClaimRead {
  /** claim:<id> */
  claim: string;
  /** Every verdict.made about it, in log order. */
  verdicts: Ev[];
  /** The latest verdict's outcome, or null with none. */
  outcome: string | null;
  /** What the latest verdict says: each string its data holds, and each map in it as one line of its own fields. */
  says: string[];
  /** The runs started for it, each with how it ended, or null while it hasn't. */
  runs: RunRead[];
}
/**
 * What a verdict's data says, as lines to search: every string in it (its reasons, and what each requirement and
 * reason code says), and every map in it as one line, `key: value, ...`, of the texts and numbers it holds itself. So
 * a cause written as a sentence and one written as fields (a check, a file, a line, an owner) are read alike.
 */
function sayings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) sayings(v, out);
  else if (value !== null && typeof value === 'object') {
    const own = Object.entries(value).filter(([, v]) => typeof v === 'string' || typeof v === 'number');
    if (own.length > 1) out.push(own.map(([k, v]) => `${k}: ${String(v)}`).join(', '));
    for (const v of Object.values(value)) sayings(v, out);
  }
  return out;
}
function readClaim(events: readonly Ev[], made: Ev): ClaimRead {
  const claim = `claim:${made.id}`;
  const finished = new Map(events.filter((e) => e.kind === 'run.finished').map((e) => [String(e.data.run), e]));
  const verdicts = verdictsOf(events, claim);
  const last = verdicts.at(-1);
  return {
    claim, verdicts,
    outcome: last ? String(last.data.outcome) : null,
    says: last ? sayings(last.data) : [],
    runs: events.filter((e) => e.kind === 'run.started' && e.data.claim === claim).map((e) => {
      const f = finished.get(String(e.data.run));
      return { run: String(e.data.run), check: String(e.data.check), outcome: f ? String(f.data.outcome) : null };
    }),
  };
}
/** How the runs of one check on the claim ended, by the name the spec gives it or the definition's file. */
export const outcomesOf = (c: ClaimRead, check: string): (string | null)[] => c.runs.filter((r) => r.check === check).map((r) => r.outcome);
/** The claim in one line, for failure messages: each verdict with its reasons, and each run with how it ended. */
export const shownClaim = (c: ClaimRead): string => `${c.claim}: ${c.verdicts.map((v) => `verdict ${String(v.data.outcome)} ${JSON.stringify(v.data.reasons ?? [])}`).join(', then ') || 'no verdict'}; `
  + `its runs: ${c.runs.map((r) => `${r.check} ${r.outcome ?? 'unfinished'}`).join(', ') || 'none'}`;

// ---- What a verdict names.
const literal = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** What the claim's verdict says that names a check by its name in the spec, as a word of its own (`checks.checkout` too): never as part of a longer name or of a file's path. */
export const naming = (c: ClaimRead, check: string): string[] => {
  const word = new RegExp(`(?<![\\w/-])${literal(check)}(?![\\w/-]|\\.[A-Za-z])`);
  return c.says.filter((text) => word.test(text));
};
/** What the claim's verdict says that names a file by its path. */
export const namingFile = (c: ClaimRead, path: string): string[] => c.says.filter((text) => text.includes(path));
/** Whether a line gives you as the owner, as the design writes a BLOCKED, (cause, owner: you), and as the base words a check missing something outside the code, `owner you`. */
export const ownedByYou = (text: string): boolean => /\bown(?:er|ed by)\b\W{0,3}\byou\b/i.test(text);
/** Whether a line names a line of a file: `line 12` (or `line: 12`), `12:14` (line and column) or `:12`. */
export const namesLine = (text: string, line: number): boolean => new RegExp(`\\bline\\W{0,3}${line}\\b|(?<![\\w.])${line}:\\d+\\b|:${line}\\b`, 'i').test(text);

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
 * is pending and FAIL outranks every verdict, so either is read at once. Any other verdict is made while runs may
 * still come (design: "any other verdict is made at once, and a verdict only rises as pending results land"), so it is
 * read once every run started for the claim has finished, each check in `waitsFor` has a finished run, and no run or
 * verdict of the claim has come for QUIET_MS. Resolves with the last read either way.
 */
async function judged(hub: Hub, ref: string, since: number, waitsFor: readonly string[]): Promise<Ev[]> {
  const deadline = Date.now() + SETTLE_MS;
  let seen = '';
  let still = Date.now();
  for (;;) {
    const events = await allEvents(hub);
    const made = claimsOf(events, ref, since)[0];
    const c = made ? readClaim(events, made) : undefined;
    if (c?.outcome === 'PASS' || c?.outcome === 'FAIL') return events;
    const idle = c !== undefined && c.verdicts.length > 0 && c.runs.every((r) => r.outcome !== null) && waitsFor.every((check) => outcomesOf(c, check).some((o) => o !== null));
    const now = c ? `${c.verdicts.length} ${c.runs.map((r) => `${r.run}${r.outcome ?? ''}`).join(' ')}` : '';
    if (now !== seen || !idle) { seen = now; still = Date.now(); }
    if ((idle && Date.now() - still >= QUIET_MS) || Date.now() > deadline) return events;
    await sleep(500);
  }
}

/**
 * One world and one claim. The repo holds `spec` as its `.deepbuild/done.yaml` (null: no such file) and is trusted by
 * the core's decision. A Claude Code session types #322's prompt, its handed definition locks, it Reads and Edits
 * src/auth.js (#322's FIX: checkToken rejects a token whose exp has passed) and stops, which makes the claim. Resolves
 * once the claim is judged, with what the record holds of it. `waitsFor` names the checks the scenario expects to run
 * on the claim. A hub that can't start is BLOCKED (thrown); a definition that never locks, a stop that makes no claim
 * and a claim with no verdict are BLOCKED too, or INCONCLUSIVE under load.
 */
export async function claimOn(spec: string | null, o: { files?: Record<string, string>; waitsFor?: readonly string[] } = {}): Promise<ClaimRead> {
  for (const [built, how] of [[CLI, 'npm run build --workspaces'], [DEEP_HOOK, 'cargo build --locked -p deep-hook']] as const) {
    if (!existsSync(built)) throw Error(`BLOCKED: the suite starts ${built}, which isn't built: ${how}`);
  }
  const w = makeWorld({ drafts: [DRAFT], spec, files: { ...FILES, ...o.files } });
  await trustRepo(w, true);
  const hub = await startHub(w);
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read(FIX.file);
  const opened = await settle(hub, (all) => lockedTask(all, s) !== undefined, LOCK_MS);
  const ref = lockedTask(opened, s);
  if (ref === undefined) throw unsettled(`the prompt "${BEHAVIOR}" opened no task with a locked definition within ${LOCK_MS / 1000} s: the record holds ${opened.map((e) => e.kind).join(', ')}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
  const since = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  const stop = await s.stop('Done.');
  const events = await judged(hub, ref, since, o.waitsFor ?? []);
  const made = claimsOf(events, ref, since)[0];
  if (!made) throw unsettled(`the stop after the fix made no claim for ${ref}: the Stop hook: ${shown(stop)}; since the fix the record holds ${events.filter((e) => e.log_pos > since).map((e) => e.kind).join(', ')}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
  const claim = readClaim(events, made);
  if (!claim.verdicts.length) throw unsettled(`the claim had no verdict ${SETTLE_MS / 1000} s after its stop: ${shownClaim(claim)}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
  return claim;
}
