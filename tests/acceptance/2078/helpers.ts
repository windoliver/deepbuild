// Shared test-side tools for issue #2078's acceptance tests (README): one Claude Code session on #31's sample repo,
// driven through the real hub (`deep hub run`), the real deep-hook and #82's Claude Code stand-in. Its first stop makes
// a claim whose check, a real Vitest run, passes, so its verdict is PASS; something then happens in its worktree that no
// hook saw; and it stops again after one Read. Every reading comes from the record (`events.read` on the hub's socket)
// and from DeepBuild's object store, `<home>/.deepbuild/objects`, read with git. Nothing here stands in for DeepBuild.
//
// Safety: every folder is under /tmp/dh875-* (#875's `tempDir`, removed by its `removeTemp`) or /tmp/dh31-home-*
// (#31's helpers' own); HOME is the world's for every process started; no network and no model; processes are stopped
// by PID only (#82's `cleanup`).

import { closeSync, ftruncateSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXED_CART, git, inStore, REGRESSION_TEST, SEEDED } from '../31/helpers.ts';
import { allEvents, DEFAULT_RULES, Inconclusive, itemTask, loaded, loadReading, lockedFor, said, Session, settle, SETTINGS, shown, sleep, startHub, type Ev, type Hub, type Ran, type World } from '../82/helpers.ts';
import { built, CHECK, CHECK_BYTES, draftOf, installVitest, PROMPT, REAL, tempDir, TEST } from '../875/helpers.ts';

export { CHECK };

/** Each criterion's ID: `#2078.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #2078.f33c092f';
export const AC2 = 'AC2 #2078.f4160036';
/** The Scope's first line, which neither criterion reaches for HEAD or for the budget. */
export const SCOPE = 'Scope #2078';

/** The tracked file the process no hook saw changes. HEAD holds it (the seeded bug); the session's fix edits it. */
export const FILE = 'src/cart.ts';
/** The session's fix of it, which the first claim's snapshot holds: the total takes the discount off. */
export const FIXED = FIXED_CART;
/** What the process no hook saw writes: a line of its own over the seeded total, which leaves the discount on, so the claim's check fails on it (100, not 90). */
export const UNHOOKED = `// rewritten by a process no hook saw\n${SEEDED[FILE]}`;
/** An untracked file no snapshot takes inside its budget (#31: 8 s of git work): 32 GiB that git must read to add, kept sparse so it fills no disk. */
export const BIG = 'big.bin';
const BIG_BYTES = 32 * 1024 ** 3;

/** How long a claim's checks may take to settle on a loaded machine: a Vitest run on its snapshot and one on the merge base, each in a checkout of its own. */
const SETTLE_MS = 900_000;

/** One run of a claim's check, as run.started and run.finished record it. */
export interface RunRead { run: string; check: string; commit: string; outcome: string | null }
/** What the record shows of one claim once its checks settled. */
export interface ClaimRead {
  /** claim:<id> */
  claim: string;
  made: Ev;
  /** Every verdict.made about it, in log order. */
  verdicts: Ev[];
  /** The latest verdict's outcome, or null with none. */
  outcome: string | null;
  /** The commit the latest verdict covers (verdict.made's `commit`; design: Pinned to a commit): the claim's snapshot. Null with no verdict. */
  commit: string | null;
  /** The latest verdict's reasons. */
  reasons: string[];
  /** The runs started for it. */
  runs: RunRead[];
}
/** The session after its first claim settled. */
export interface Scene { w: World; hub: Hub; s: Session; ref: string; store: string; first: ClaimRead; stop: Ran }
/** The second stop: its claim, or null when the stop made none, and the log position it came after. */
export interface Again { second: ClaimRead | null; stop: Ran; since: number; events: Ev[] }

const claimsOf = (events: readonly Ev[], ref: string): Ev[] => events.filter((e) => e.kind === 'claim.made' && e.data.task_ref === ref);
function readClaim(events: readonly Ev[], made: Ev): ClaimRead {
  const claim = `claim:${made.id}`;
  const finished = new Map(events.filter((e) => e.kind === 'run.finished').map((e) => [String(e.data.run), e]));
  const verdicts = events.filter((e) => e.kind === 'verdict.made' && e.subject === claim);
  const last = verdicts.at(-1);
  return {
    claim, made, verdicts,
    outcome: last ? String(last.data.outcome) : null,
    commit: last && typeof last.data.commit === 'string' ? last.data.commit : null,
    reasons: last && Array.isArray(last.data.reasons) ? last.data.reasons.map(String) : [],
    runs: events.filter((e) => e.kind === 'run.started' && e.data.claim === claim).map((e) => {
      const f = finished.get(String(e.data.run));
      return { run: String(e.data.run), check: String(e.data.check), commit: String(e.data.commit), outcome: f ? String(f.data.outcome) : null };
    }),
  };
}
/**
 * Waits until the task's `n`th claim is made, has a verdict, every run in the record has finished, and no run or
 * verdict event has come for 3 s; at most SETTLE_MS. Resolves with the last read either way: the judgements say what
 * is missing.
 */
async function settled(hub: Hub, ref: string, n: number): Promise<Ev[]> {
  const deadline = Date.now() + SETTLE_MS;
  let seen = -1;
  let quiet = Date.now();
  for (;;) {
    const events = await allEvents(hub);
    const made = claimsOf(events, ref)[n - 1];
    const started = events.filter((e) => e.kind === 'run.started');
    const ended = new Set(events.filter((e) => e.kind === 'run.finished').map((e) => String(e.data.run)));
    const judged = made !== undefined && events.some((e) => e.kind === 'verdict.made' && e.subject === `claim:${made.id}`);
    const idle = judged && started.every((e) => ended.has(String(e.data.run)));
    const moved = events.filter((e) => e.kind.startsWith('run.') || e.kind === 'verdict.made').length;
    if (moved !== seen || !idle) { seen = moved; quiet = Date.now(); }
    if ((idle && Date.now() - quiet >= 3000) || Date.now() > deadline) return events;
    await sleep(500);
  }
}

/** The claim in one line, for failure messages. */
export const shownClaim = (c: ClaimRead | null): string => (c
  ? `${c.claim}: verdicts ${JSON.stringify(c.verdicts.map((v) => ({ outcome: v.data.outcome, commit: v.data.commit, reasons: v.data.reasons })))}; runs ${JSON.stringify(c.runs.map((r) => ({ run: r.run, check: r.check, commit: r.commit, outcome: r.outcome })))}`
  : 'no claim');

/**
 * A world as #875's `makeWorld` lays it out (a home with the shipped default guards and your ask settings, the
 * OS-confirmation stub, DEEP_HUB_TEST_DRAFTS and DEEP_HUB_TEST_WORK), under /tmp/dh875-*: its repo is #31's sample on
 * `main`, one commit (`base`) holding the seeded bug, the drafted check and, unlike #875's, the check's test file, so
 * the session's fix changes none of the check's own files (design: Whose checks count) and its claim can pass. Vitest
 * is cloned into the ignored node_modules. The handed definition is #875's: R1, a fix check (`on_base: fails`)
 * asserting test/cart.test.ts:5.
 */
function makeWorld(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main']);
  for (const [path, bytes] of Object.entries({ ...SEEDED, [TEST]: REGRESSION_TEST, [CHECK]: CHECK_BYTES })) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), bytes);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'the seeded bug, the drafted check and its test']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  installVitest(repo);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: [draftOf(REAL)] }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: [] }, null, 2)}\n`);
  return { tmp, home, root, repo: realpathSync(repo), confirm, drafts, work, base };
}

/**
 * A session's first claim, whose check passes: it types the prompt, its definition locks with the drafted check, it
 * Reads src/cart.ts, Edits it to #31's fix (left uncommitted, so the claim covers a snapshot on HEAD) and stops.
 * Resolves once the claim's checks settled. A hub that can't start, a task that never locks or a stop that makes no
 * claim is BLOCKED (thrown), or INCONCLUSIVE when other work loads the machine past its core count.
 */
export async function passingClaim(): Promise<Scene> {
  built();
  const w = makeWorld();
  const hub = await startHub(w, { hold: null });
  const s = new Session(w);
  await s.start();
  await s.typed(PROMPT);
  const opened = await settle(hub, (e) => { const ref = itemTask(e, s, PROMPT); return ref !== undefined && lockedFor(e, ref).length > 0; }, 180_000);
  const ref = itemTask(opened, s, PROMPT);
  if (!ref || !lockedFor(opened, ref).length) {
    const why = `the prompt opened no task with a locked definition within 180 s: ${opened.filter((e) => e.kind.startsWith('definition.') || e.kind === 'user.ask').map(said).join('; ')}`;
    throw loaded() ? new Inconclusive(`${why}, ${loadReading()}`) : Error(`BLOCKED: ${why}`);
  }
  await s.read(FILE);
  await s.edit(FILE, SEEDED[FILE], FIXED);
  const stop = await s.stop('Done.');
  const events = await settled(hub, ref, 1);
  const made = claimsOf(events, ref)[0];
  if (!made) throw Error(`BLOCKED: the first stop made no claim for ${ref}: the Stop hook: ${shown(stop)}; the record holds ${events.map((e) => e.kind).join(', ')}; hub stderr ${JSON.stringify(hub.stderr().slice(-800))}`);
  const first = readClaim(events, made);
  if (!first.verdicts.length && loaded()) throw new Inconclusive(`the first claim's checks had not settled ${SETTLE_MS / 1000} s after its stop (${shownClaim(first)}), ${loadReading()}`);
  return { w, hub, s, ref, store: join(w.root, 'objects'), first, stop };
}

/**
 * The session stops again with only a read in its turn: it Reads src/cart.ts, the one call its hooks see since the
 * first claim, and stops. Resolves once the claim that stop made settled; `second` is null when it made none.
 */
export async function stopsAgain(scene: Scene): Promise<Again> {
  const before = await allEvents(scene.hub);
  const since = before.length ? before[before.length - 1]!.log_pos : 0;
  await scene.s.read(FILE);
  const stop = await scene.s.stop('Done.');
  const events = await settled(scene.hub, scene.ref, 2);
  const made = claimsOf(events, scene.ref)[1];
  const second = made ? readClaim(events, made) : null;
  if (second && !second.verdicts.length && loaded()) throw new Inconclusive(`the second claim's checks had not settled ${SETTLE_MS / 1000} s after its stop (${shownClaim(second)}), ${loadReading()}`);
  return { second, stop, since, events };
}
/** The second stop's claim; a stop that made none is BLOCKED (thrown): the scenario never reached the criterion. */
export function claimOf(again: Again, scene: Scene): ClaimRead {
  if (!again.second) throw Error(`BLOCKED: the second stop, after one Read, made no claim for ${scene.ref}: the Stop hook: ${shown(again.stop)}; since the first claim the record holds ${again.events.filter((e) => e.log_pos > again.since).map((e) => e.kind).join(', ')}; hub stderr ${JSON.stringify(scene.hub.stderr().slice(-800))}`);
  return again.second;
}

// ---- What a process no hook saw does in the session's worktree: the test's own process, with no hook fired.
/** It rewrites the tracked file src/cart.ts. */
export function rewritesFile(scene: Scene): void {
  writeFileSync(join(scene.w.repo, FILE), UNHOOKED);
}
/** It commits the worktree as it stands, so HEAD moves and the tree stays the first snapshot's. Answers the new HEAD. */
export function commits(scene: Scene): string {
  git(scene.w.repo, ['add', '-A']);
  git(scene.w.repo, ['commit', '-q', '-m', 'committed by a process no hook saw']);
  return git(scene.w.repo, ['rev-parse', 'HEAD']);
}
/** It leaves BIG, untracked, in the worktree. A file system that keeps no sparse file is BLOCKED (thrown), the file removed. */
export function leavesBigFile(scene: Scene): void {
  const path = join(scene.w.repo, BIG);
  const fd = openSync(path, 'w');
  try { ftruncateSync(fd, BIG_BYTES); } finally { closeSync(fd); }
  if (statSync(path).blocks * 512 > 1024 ** 2) {
    rmSync(path, { force: true });
    throw Error(`BLOCKED: this file system keeps no sparse file, so ${BIG} would take ${BIG_BYTES} bytes of disk`);
  }
}

// ---- DeepBuild's object store, `<home>/.deepbuild/objects`, read with git.
/** A file's bytes at a commit, read from the store with the repo's objects as alternates, as the hub reads it; or why it can't be read. */
export function fileAt(scene: Scene, commit: string, file: string): string {
  try {
    return `${inStore(scene.store, scene.w.repo, ['show', `${commit}:${file}`])}\n`;
  } catch (error) {
    return `(${commit}:${file} can't be read from ${scene.store}: ${(error instanceof Error ? error.message : String(error)).split('\n').slice(0, 3).join(' ')})`;
  }
}
/** The parent of a commit, read the same way; or why it can't be read. */
export function parentOf(scene: Scene, commit: string): string {
  try {
    return inStore(scene.store, scene.w.repo, ['rev-parse', `${commit}^`]);
  } catch (error) {
    return `(${commit}^ can't be read: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]})`;
  }
}
/**
 * What the store's own object folder holds, by file: each loose object (`ab/cdef…`) and each pack (`pack/pack-….pack`).
 * A write to the store adds one; git's temporary files, which it removes, and the repo's objects, which the store only
 * reads as alternates, are left out.
 */
export function storeObjects(scene: Scene): Set<string> {
  const objects = join(scene.store, 'objects');
  const held = new Set<string>();
  for (const folder of readdirSync(objects)) {
    if (/^[0-9a-f]{2}$/.test(folder)) for (const name of readdirSync(join(objects, folder))) { if (/^[0-9a-f]{38,}$/.test(name)) held.add(`${folder}/${name}`); }
    if (folder === 'pack') for (const name of readdirSync(join(objects, folder))) { if (/^pack-[0-9a-f]+\.pack$/.test(name)) held.add(`pack/${name}`); }
  }
  return held;
}
