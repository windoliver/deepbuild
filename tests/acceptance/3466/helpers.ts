// Shared by the #3466 acceptance tests (README): one fixture repository, `shop`, whose committed `.deepbuild/done.yaml`
// lists `lint`, `typecheck` and `unit` in the `done` claim; your approval of "stop checking lint in shop" on its card;
// a second worktree of the repo; the hub stopped and started again; writes no hook sees; commits of the spec; and "the
// next claim", a new Claude Code session's first stop, read back from the record once it is judged.
//
// The world is #322's (../322/helpers.ts): a temp home, a git repository, the project's trust decision as #348 records
// it, the real hub (`deep hub run`), a session whose hooks run through the real deep-hook, and your answer on the
// trusted path (`deep inbox answer`). The box is reached as #1998's suite reaches it: its one method, `box.say`, with
// your words and the checkout they are about. A claim's runs are read in the shape #1864's helpers read them
// (../1864/helpers.ts: `ClaimRead`, `runsOf`, `shownClaim`); that suite's own reader of the record and its wait aren't
// exported, and its scenario makes one world and one claim, so this suite keeps a reader and a wait of its own, after
// theirs (same repo, same license). Nothing here stands in for DeepBuild, and no file of the code under test is
// imported or read.
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { basename, join } from 'node:path';
import {
  BEHAVIOR, CLI, DEEP_HOOK, FLAG, Session, alive, allEvents, answer, askNamed, claimsOf, control, git, lastPos, loadReading, lockedFor, makeWorld, proposalsNaming, req, settle, shown, startHub,
  stopHub, taskOf, trustRepo, verdictsOf, type Draft, type Ev, type Hub, type Line, type World,
} from '../322/helpers.ts';
import { SPEC_FILE, shownClaim, type ClaimRead } from '../1864/helpers.ts';

export { SPEC_FILE };

// ---- The fixture repository and its spec.
/** Your words to the box, as the issue writes them. */
export const WORDS = 'stop checking lint in shop';
/** The name the words give the repo: its checkout's top folder (#1998). */
const SHOP = 'shop';
/** The second worktree's folder, beside the checkout, and its branch. */
const SECOND = 'second';
/** The three checks the committed spec lists in the `done` claim, in its order; each is a node:test run that passes on the base commit and on every session's work. */
const RUN = { lint: 'node --test tests/lint.test.js', typecheck: 'node --test tests/types.test.js', unit: 'node --test tests/unit.test.js' } as const;
/** `.deepbuild/done.yaml` as the repo's first commit holds it. */
export const COMMITTED = ['claims:', '  done:', '    checks: [lint, typecheck, unit]', 'checks:', ...Object.entries(RUN).map(([name, run]) => `  ${name}: { type: command, run: "${run}" }`), ''].join('\n');
/** The same spec with `lint` out of the `done` claim's list: what criterion 5's write puts on disk, with nobody's approval. */
export const WITHOUT_LINT = COMMITTED.replace('[lint, typecheck, unit]', '[typecheck, unit]');
/**
 * The checks a spec's text lists in its `done` claim, read from the one line that holds them (`checks: [a, b]`, as the
 * committed spec writes it and as the box writes it back); null for a text with no such line.
 */
export function listedOnDone(text: string): string[] | null {
  const list = /^claims:[ \t]*\n[ \t]+done:[ \t]*\n[ \t]+checks:[ \t]*\[([^\]\n]*)\]/m.exec(text);
  return list ? list[1]!.split(',').map((name) => name.trim()).filter(Boolean) : null;
}

// Every check's test loads src/auth.js, so a run's result is keyed by what that file holds (design: Carried across
// sessions) and each claim, whose session leaves the file as no claim before it had it, starts runs of its own.
const LOADS = "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../src/auth.js');\n";
const R1_CHECK = '.deepbuild/checks/says-rejects.sh';
const R1_TEST = '.deepbuild/checks/says-rejects.test.js';
const FILES: Record<string, string> = {
  'tests/lint.test.js': `${LOADS}test('every name the module exports is in camel case', () => {\n  assert.deepStrictEqual(Object.keys(auth).filter((name) => !/^[a-z][A-Za-z0-9]*$/.test(name)), []);\n});\n`,
  'tests/types.test.js': `${LOADS}test('checkToken is a function that answers a boolean', () => {\n  assert.strictEqual(typeof auth.checkToken, 'function');\n  assert.strictEqual(typeof auth.checkToken({ exp: 4102444800 }), 'boolean');\n});\n`,
  'tests/unit.test.js': `${LOADS}test('checkToken takes a token that expires far ahead and none that expired at 0', () => {\n  assert.strictEqual(auth.checkToken({ exp: 4102444800 }), true);\n  assert.strictEqual(auth.checkToken({ exp: 0 }), false);\n});\n`,
  [R1_CHECK]: `#!/bin/sh\n# Drafted check: the middleware says it rejects expired tokens.\nnode --test ${R1_TEST}\n`,
  [R1_TEST]: "const test = require('node:test');\nconst assert = require('node:assert');\nconst auth = require('../../src/auth.js');\ntest('the middleware says it rejects expired tokens', () => {\n  assert.strictEqual(auth.rejectsExpired, true);\n});\n",
};
/**
 * The definition handed for #322's prompt, in every session that types it: one requirement, R1, judged by a drafted
 * node:test check that fails on the base commit (`rejectsExpired` is false there) and passes once #322's FLAG is made.
 * So the definition's own check passes on every claim, and which spec checks run is the spec's alone.
 */
const DRAFT: Draft = {
  ask: BEHAVIOR, requirements: [req('R1', 'The middleware says it rejects expired tokens', { check: R1_CHECK, asserts: [`${R1_TEST}:5`] })], deliverables: [FLAG.file], budget: null,
};

/** How long the handed definition may take to lock, a claim's checks to end, the box's approved change to reach the disk, and a difference to become a proposal, on a machine other sessions load. */
const LOCK_MS = 180_000;
const SETTLE_MS = 900_000;
const APPLY_MS = 120_000;
const PROPOSAL_MS = 60_000;

const loaded = (): boolean => loadavg()[0]! > availableParallelism();
/** A step that didn't happen inside its wait, or a reading that can't be made: INCONCLUSIVE when other work loads the machine past its cores, else BLOCKED. Never a pass. */
export const unsettled = (why: string): Error => Error(`${loaded() ? 'INCONCLUSIVE' : 'BLOCKED'}: ${why}; ${loadReading()}`);
const blocked = (why: string): Error => Error(`BLOCKED: ${why}`);
const head = (w: World, folder: string): string => git(w.tmp, folder, ['rev-parse', 'HEAD']);
/** The spec a commit of the repo holds, as git prints it. */
export const specAt = (w: World, commit: string): string => git(w.tmp, w.repo, ['show', `${commit}:${SPEC_FILE}`]);
/** The spec a folder holds on disk now. */
export const specOnDisk = (folder: string): string => readFileSync(join(folder, SPEC_FILE), 'utf8');
/** Whether the checkout's spec differs from the one its HEAD holds: written, not committed. */
export const uncommitted = (w: World): boolean => git(w.tmp, w.repo, ['diff', '--name-only', 'HEAD', '--', SPEC_FILE]) === SPEC_FILE;

// ---- The world.
export interface Shop {
  w: World;
  /** The hub now running on the world's home; `restart` puts the new one here. */
  hub: Hub;
  /** The second worktree's folder, when the world has one. */
  second: string | undefined;
}
/**
 * #322's world with its repository's folder named `shop`, the name your words give it: one commit on main holding the
 * spec, the three checks' tests and the drafted check. With `second`, a second worktree of the repo on a branch of its
 * own, from the same commit. Each folder is trusted by the core's decision (#348), made before the hub starts, as
 * that decision is one for each project folder; then the hub starts. A build that is missing, a repo that isn't as
 * described and a worktree that isn't one of the same repository are BLOCKED.
 */
export async function openShop(o: { second?: boolean } = {}): Promise<Shop> {
  for (const [built, how] of [[CLI, 'npm run build --workspaces'], [DEEP_HOOK, 'cargo build --locked -p deep-hook']] as const) {
    if (!existsSync(built)) throw blocked(`the suite starts ${built}, which isn't built: ${how}`);
  }
  const made = makeWorld({ drafts: [DRAFT], spec: COMMITTED, files: FILES });
  // #322's world calls the folder `repo`. It is renamed before anything reads it: no worktree, trust decision or hub yet.
  renameSync(made.repo, join(made.tmp, SHOP));
  const w: World = { ...made, repo: realpathSync(join(made.tmp, SHOP)) };
  const top = git(w.tmp, w.repo, ['rev-parse', '--show-toplevel']);
  if (basename(top) !== SHOP || realpathSync(top) !== w.repo) throw blocked(`the fixture repo's top folder must be named ${SHOP}, the name "${WORDS}" gives it: git says ${top}`);
  if (head(w, w.repo) !== w.base || specAt(w, w.base) !== COMMITTED.trim() || listedOnDone(specAt(w, w.base))?.join() !== 'lint,typecheck,unit') {
    throw blocked(`the repo's one commit ${w.base} must hold the spec that lists lint, typecheck and unit in the done claim as ${SPEC_FILE}: it holds ${JSON.stringify(specAt(w, w.base))}`);
  }
  let second: string | undefined;
  if (o.second) {
    git(w.tmp, w.repo, ['worktree', 'add', '-q', '-b', SECOND, join(w.tmp, SECOND), w.base]);
    second = realpathSync(join(w.tmp, SECOND));
    const common = (folder: string): string => realpathSync(git(w.tmp, folder, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
    if (second === w.repo || realpathSync(git(w.tmp, second, ['rev-parse', '--show-toplevel'])) !== second || common(second) !== common(w.repo)) {
      throw blocked(`${second} must be a second worktree of the repository at ${w.repo}: its git folder is ${common(second)}, the checkout's ${common(w.repo)}`);
    }
    if (head(w, second) !== w.base || specOnDisk(second) !== COMMITTED) throw blocked(`the second worktree must start from the commit ${w.base}, with the spec it holds on disk: it is at ${head(w, second)} with ${JSON.stringify(specOnDisk(second))}`);
  }
  await trustRepo(w, true);
  if (second !== undefined) await trustRepo({ ...w, repo: second }, true);
  return { w, hub: await startHub(w), second };
}

/**
 * The hub stopped and another started on the same home: the record and the evidence store are what the first left.
 * Returns the two processes' IDs. A first hub still alive, or a second with the first's ID, is BLOCKED: the hub that
 * judges the next claim must be a new process.
 */
export async function restart(shop: Shop): Promise<{ stopped: number; started: number }> {
  const stopped = shop.hub.pid;
  await stopHub(shop.hub);
  if (alive(stopped)) throw blocked(`the hub (pid ${stopped}) must have stopped before another starts on its home: it is still alive`);
  shop.hub = await startHub(shop.w);
  if (shop.hub.pid === stopped || !alive(shop.hub.pid)) throw blocked(`the hub started after the stop must be a new, running process: it has pid ${shop.hub.pid}, the stopped one had ${stopped}`);
  return { stopped, started: shop.hub.pid };
}

// ---- The approval.
export interface Approval {
  /** The proposed change's ask, as `box.say` returned it. */
  ask: string;
  /** The spec the approval wrote into the checkout. */
  written: string;
  /** The log's last position once the written file was on disk: every proposal after it comes after the approval. */
  at: number;
}
/**
 * "stop checking lint in shop" said to the box with the checkout it is about, and approved on its card: `deep inbox
 * answer <ask> apply`, the OS confirming you. Resolves once the checkout's spec no longer lists `lint` in the done
 * claim and still lists `typecheck` and `unit`. BLOCKED when the box drafts no change, writes before your answer,
 * the answer is refused, or the written file is already committed; a file not written within APPLY_MS is BLOCKED, or
 * INCONCLUSIVE under load.
 */
export async function approve(shop: Shop): Promise<Approval> {
  const { w, hub } = shop;
  let said: Line;
  try {
    said = await control(hub, 'box.say', { words: WORDS, repo: w.repo }, APPLY_MS);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw (why.startsWith('no reply') ? unsettled : blocked)(`the box must take "${WORDS}" for the checkout ${w.repo} as a proposed change: ${why}`);
  }
  const ask = typeof said.ask === 'string' ? said.ask : undefined;
  const card = ask === undefined ? undefined : (await allEvents(hub)).find((e) => e.kind === 'ask.created' && `ask:${e.id}` === ask);
  if (ask === undefined || card === undefined) throw blocked(`box.say "${WORDS}" must come back as a proposed change whose ask the record holds: it returned ${JSON.stringify(said).slice(0, 600)}`);
  if (specOnDisk(w.repo) !== COMMITTED) throw blocked(`nothing changes before your answer, yet ${SPEC_FILE} already holds ${JSON.stringify(specOnDisk(w.repo))}`);
  const answered = await answer(w, card, 'apply');
  if (answered.code !== 0) throw blocked(`\`deep inbox answer ${ask} apply\` must approve the change on the trusted path: ${shown(answered)}`);
  const applied = (): boolean => {
    let now: string[] | null = null;
    try { now = listedOnDone(specOnDisk(w.repo)); } catch { /* between two writes */ }
    return now !== null && !now.includes('lint') && now.includes('typecheck') && now.includes('unit');
  };
  await settle(hub, applied, APPLY_MS);
  if (!applied()) throw unsettled(`the approved change must be written to ${SPEC_FILE} in the checkout, without lint in the done claim and with typecheck and unit, within ${APPLY_MS / 1000} s of ${ask}'s answer: the file holds ${JSON.stringify(specOnDisk(w.repo))}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
  const written = specOnDisk(w.repo);
  if (!uncommitted(w) || specAt(w, 'HEAD') !== COMMITTED.trim()) throw blocked(`the written file is left for you to commit: HEAD must still hold the spec that lists lint, and ${SPEC_FILE} must differ from it on disk`);
  return { ask, written, at: await lastPos(hub) };
}

// ---- Writes and commits.
/** A change to the checkout's spec made on disk with no hook fired for it, as a command's child makes one (design: What a command's children do). One that doesn't land is BLOCKED. */
export function writeBehindHooks(shop: Shop, text: string): void {
  const file = join(shop.w.repo, SPEC_FILE);
  const was = readFileSync(file, 'utf8');
  writeFileSync(file, text);
  if (was === text || readFileSync(file, 'utf8') !== text) throw blocked(`the write to ${SPEC_FILE} didn't land: it held ${JSON.stringify(was)} and holds ${JSON.stringify(readFileSync(file, 'utf8'))}`);
}
/** Commits the checkout's spec as the disk holds it, and nothing else, on the checkout's branch. Returns the commit. One that doesn't land so is BLOCKED. */
export function commitSpec(shop: Shop, message: string): string {
  const { w } = shop;
  const was = head(w, w.repo);
  try {
    git(w.tmp, w.repo, ['add', '--', SPEC_FILE]);
    git(w.tmp, w.repo, ['commit', '-q', '-m', message, '--', SPEC_FILE]);
  } catch (error) {
    throw blocked(`the commit of ${SPEC_FILE} ("${message}") didn't land: ${error instanceof Error ? error.message.slice(0, 600) : String(error)}`);
  }
  const now = head(w, w.repo);
  const changed = git(w.tmp, w.repo, ['show', '--name-only', '--format=', now]);
  if (now === was || changed !== SPEC_FILE || specAt(w, now) !== specOnDisk(w.repo).trim() || uncommitted(w)) {
    throw blocked(`the commit "${message}" must hold ${SPEC_FILE} as the disk has it, and nothing else: ${now} changes ${JSON.stringify(changed)} and holds ${JSON.stringify(specAt(w, now))}`);
  }
  return now;
}

// ---- The record: one claim's verdicts and runs, in the shape #1864's helpers read (`runsOf`, `shownClaim`).
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
/**
 * Whether the task's first claim after `since` is judged. A PASS is made only once nothing is pending, so it is read
 * at once. Any other verdict is made while runs may still come, so it is read once every run started for the claim
 * has ended. Both are events of the record: no time is waited for.
 */
function judged(events: readonly Ev[], task: string, since: number): boolean {
  const made = claimsOf(events, task, since)[0];
  if (!made) return false;
  const c = readClaim(events, made);
  return c.outcome === 'PASS' || (c.verdicts.length > 0 && c.runs.every((r) => r.outcome !== null));
}
/**
 * Throws unless the claim passed. Nothing passes while a check is pending, and a check that never started on a claim
 * leaves no run (design: How runs become one of five verdicts). So only on a claim that passed is a check with no run
 * a check the claim was not judged on, and only there has every check it was judged on a run. A run that is there
 * needs no such reading. A claim that didn't pass is BLOCKED, or INCONCLUSIVE under load, never read as a pass.
 */
export function whole(c: ClaimRead): void {
  if (c.outcome !== 'PASS') throw unsettled(`the claim didn't pass, so the checks it was judged on can't be read from its runs: a check still to start, or one that never starts once another failed, leaves no run: ${shownClaim(c)}`);
}

// ---- The next claim.
/** The task the session's prompt opened, once its handed definition locked. */
function lockedTask(events: readonly Ev[], s: Session): string | undefined {
  const ref = taskOf(askNamed(events, s, BEHAVIOR));
  return ref !== undefined && lockedFor(events, ref).length > 0 ? ref : undefined;
}
/**
 * The session's work, each edit through its hooks: #322's FLAG where the folder's file doesn't hold it yet, which
 * R1's check needs, and `checkToken`'s bound set to `turn`, a number no claim before it had, so the file every check
 * loads is one no earlier run read.
 */
async function work(s: Session, turn: number): Promise<void> {
  const path = join(s.cwd, FLAG.file);
  if (readFileSync(path, 'utf8').includes(FLAG.from)) await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const from = /token\.exp > \d+/.exec(readFileSync(path, 'utf8'))?.[0];
  const to = `token.exp > ${turn}`;
  if (from === undefined || from === to) throw blocked(`${FLAG.file} in ${s.cwd} must hold checkToken's bound, and one other than ${turn}: it holds ${JSON.stringify(readFileSync(path, 'utf8'))}`);
  await s.edit(FLAG.file, from, to);
  const now = readFileSync(path, 'utf8');
  if (!now.includes(FLAG.to) || !now.includes(`${to},`)) throw blocked(`the session's edits of ${FLAG.file} didn't land: it holds ${JSON.stringify(now)}`);
}
export interface Next {
  session: Session;
  /** The task the session's prompt opened. */
  task: string;
  /** The claim's base commit: its task's definition's, which the hub read at the folder's HEAD when the definition locked. */
  base: string;
  /** The record as last read, once the claim was judged. */
  events: Ev[];
  claim: ClaimRead;
}
/**
 * The next claim in `folder`: a new Claude Code session there types #322's prompt, Reads src/auth.js, its handed
 * definition locks, it makes its work through its hooks and stops saying "Done.". The claim that stop makes is read
 * from the record once judged (`judged`). A definition that never locks, one whose base commit isn't the folder's
 * HEAD, a stop that makes no claim and a claim with no verdict are BLOCKED, or INCONCLUSIVE under load.
 */
export async function nextClaim(shop: Shop, folder: string, turn: number): Promise<Next> {
  const { w, hub } = shop;
  const s = new Session(w, folder);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read(FLAG.file);
  const opened = await settle(hub, (all) => lockedTask(all, s) !== undefined, LOCK_MS);
  const task = lockedTask(opened, s);
  if (task === undefined) throw unsettled(`the prompt "${BEHAVIOR}" typed in ${folder} opened no task with a locked definition within ${LOCK_MS / 1000} s: the record holds ${opened.map((e) => e.kind).join(', ')}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
  const base = String(lockedFor(opened, task)[0]!.data.base_commit ?? '');
  if (base !== head(w, folder)) throw blocked(`the claim's base commit is its task's definition's, read at the folder's HEAD: ${task}'s definition holds ${JSON.stringify(base)}, and ${folder} is at ${head(w, folder)}`);
  await work(s, turn);
  const since = await lastPos(hub);
  const stop = await s.stop('Done.');
  const events = await settle(hub, (all) => judged(all, task, since), SETTLE_MS);
  const made = claimsOf(events, task, since)[0];
  if (!made) throw unsettled(`the session's stop in ${folder} made no claim for ${task}: the Stop hook: ${shown(stop)}; since the stop the record holds ${events.filter((e) => e.log_pos > since).map((e) => e.kind).join(', ')}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
  const claim = readClaim(events, made);
  if (!claim.verdicts.length) throw unsettled(`the claim had no verdict ${SETTLE_MS / 1000} s after its stop: ${shownClaim(claim)}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
  return { session: s, task, base, events, claim };
}

// ---- Proposals: #322's reader, any event whose kind ends in `.proposed` and whose data holds the file's path.
/** The proposals naming `.deepbuild/done.yaml` recorded after `since`. */
export const proposalsSince = (events: readonly Ev[], since: number): Ev[] => proposalsNaming(events, since, SPEC_FILE);
/** The same, read from the record for at most PROPOSAL_MS more, until there is one. */
export async function proposalsOnceOne(shop: Shop, since: number): Promise<Ev[]> {
  return proposalsSince(await settle(shop.hub, (all) => proposalsSince(all, since).length > 0, PROPOSAL_MS), since);
}
