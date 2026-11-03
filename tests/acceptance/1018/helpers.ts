// Shared test-side tools for issue #1018's acceptance tests (README): a hub world under /tmp/dh1018-* holding #31's
// sample repo on `main` with linked worktrees cut from one commit, each with Vitest cloned in; Claude Code sessions,
// one per worktree, driven through the real hub (`deep hub run`), deep-hook and #29's Claude Code stand-in; and the
// readings taken back from the record through the hub's socket. Nothing here stands in for DeepBuild: every reading
// comes from the real hub, deep-hook, the real Vitest runs and the record.
//
// Safety: every folder is under /tmp/dh1018-* (#31's and #875's helpers, imported for the sample repo and the Vitest
// clone, make their own temp home under /tmp/dh31-home-* and remove it); no network and no model; processes are stopped
// by PID only (#29's `cleanup` and `stopHub`).

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { git, SEEDED } from '../31/helpers.ts';
import { built, installVitest } from '../875/helpers.ts';
import {
  allEvents, askNamed, control, DEFAULT_RULES, failureOf, lockedFor, req, said, SETTINGS, Session, settle, shown, sleep, startHub, stopHub, taskOf,
  type Draft, type Ev, type Hub, type Line, type Requirement, type World,
} from '../29/h-d.ts';

export { sleep, startHub, stopHub };
export type { Hub };

// ---- Temp folders under /tmp/dh1018-*, removed by `removeTemp` (the test files call it after each test).
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1018-'));
  made.push(dir);
  return dir;
}
export function removeTemp(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- The sample repo and its worktrees.
/** #31's sample repo: `src/cart.ts`'s total ignores the discount. */
export const SAMPLE: Record<string, string> = { ...SEEDED };
/** A drafted check file: one command line, which the command check kind runs as it is (#875's form). */
export const vitestCheck = (test: string): string => `node_modules/.bin/vitest run ${test}\n`;

/** A requirement of a handed definition; `extra` holds the fields this issue adds (README, The surface under test). */
export const requirement = (id: string, text: string, check: string, o: Partial<Requirement> & Line = {}): Requirement => req(id, text, { check, on_base: 'passes', ...o });
/** A definition handed for `prompt` (DEEP_HUB_TEST_DRAFTS). */
export const draft = (prompt: string, requirements: Requirement[]): Draft => ({ ask: prompt, requirements, deliverables: ['src/cart.ts'], budget: null });

/** A world: a home and #29's layout, a repo on `main` with one commit (`base`), and `trees` linked worktrees cut from it. */
export interface Trees extends World { trees: string[] }
/**
 * Makes a world as #29's `makeWorld` lays one out (the shipped default guards, your ask settings, the OS-confirmation
 * stub, DEEP_HUB_TEST_DRAFTS, DEEP_HUB_TEST_WORK) under /tmp/dh1018-*: its repo holds `files` in one commit on `main`
 * (`base`), and `trees` worktrees are added from that commit, each on a branch of its own, each with Vitest cloned into
 * its node_modules (ignored), as each session's checkout would have its install.
 */
export function makeTrees(files: Record<string, string>, drafts: Draft[], trees: number): Trees {
  built();
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
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), bytes);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'the sample repo and its drafted checks']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  const paths: string[] = [];
  for (let i = 1; i <= trees; i++) {
    const tree = join(tmp, `w${i}`);
    git(repo, ['worktree', 'add', '-q', '-b', `session-${i}`, tree, 'main']);
    installVitest(tree);
    paths.push(realpathSync(tree));
  }
  const draftsFile = join(tmp, 'drafts.json');
  writeFileSync(draftsFile, `${JSON.stringify({ drafts }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: [] }, null, 2)}\n`);
  return { tmp, home, root, repo: realpathSync(repo), confirm, drafts: draftsFile, work, base, trees: paths };
}

// ---- Sessions, one per worktree.
/** A Claude Code session working in one worktree, with the task its prompt opened. */
export interface Worker { s: Session; tree: string; ref: string }
/**
 * Opens a session in `tree`: SessionStart, the typed prompt, and the wait for its task's definition to lock. A prompt that
 * opens no task with a locked definition is BLOCKED (thrown): the scenario never reached the claim.
 */
export async function open(hub: Hub, w: World, tree: string, prompt: string): Promise<Worker> {
  const s = new Session({ ...w, repo: tree });
  await s.start();
  await s.typed(prompt);
  const events = await settle(hub, (e) => { const ref = taskOf(askNamed(e, s, prompt)); return ref !== undefined && lockedFor(e, ref).length > 0; }, 180_000);
  const ref = taskOf(askNamed(events, s, prompt));
  if (!ref || !lockedFor(events, ref).length) throw Error(`BLOCKED: the prompt in ${tree} opened no task with a locked definition: ${events.filter((e) => e.kind.startsWith('definition.') || e.kind === 'user.ask').map(said).join('; ')}`);
  return { s, tree, ref };
}
/** The session reads src/cart.ts, then writes each file: an Edit of the whole file when it's there, a Write when it's new. */
export async function writes(k: Worker, files: Record<string, string>): Promise<void> {
  await k.s.read('src/cart.ts');
  for (const [file, bytes] of Object.entries(files)) {
    const path = join(k.tree, file);
    if (existsSync(path)) {
      await k.s.edit(file, readFileSync(path, 'utf8'), bytes);
      continue;
    }
    const r = await k.s.call('Write', { file_path: path, content: bytes }, {
      response: { type: 'create', filePath: path, content: bytes, structuredPatch: [] },
      effect: () => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, bytes); },
    });
    if (!r.allowed) throw Error(`BLOCKED: the Write of ${file} must be allowed: ${shown(r.before)}`);
  }
}
/** The session stops: the stop makes its claim. */
export async function stop(k: Worker): Promise<void> {
  await k.s.stop('Done.');
}

// ---- Readings from the record.
/** One run as run.started and run.finished record it. */
export interface RunRead { run: string; check: string; claim: string; commit: string; outcome: string | null; started: Ev; finished: Ev | null }
export function runsIn(events: readonly Ev[]): RunRead[] {
  const finished = new Map(events.filter((e) => e.kind === 'run.finished').map((e) => [String(e.data.run), e]));
  return events.filter((e) => e.kind === 'run.started').map((e) => {
    const f = finished.get(String(e.data.run)) ?? null;
    return { run: String(e.data.run), check: String(e.data.check), claim: String(e.data.claim), commit: String(e.data.commit), outcome: f ? String(f.data.outcome) : null, started: e, finished: f };
  });
}
/** The claim a task's stop made (its claim.made), or undefined. */
export const claimMade = (events: readonly Ev[], ref: string): Ev | undefined => events.find((e) => e.kind === 'claim.made' && e.data.task_ref === ref);
export const claimId = (e: Ev): string => `claim:${e.id}`;
/** Every verdict.made about a claim, in log order. */
export const verdictsAbout = (events: readonly Ev[], claim: string): Ev[] => events.filter((e) => e.kind === 'verdict.made' && e.subject === claim);

/** What the record shows of one session's claim once the scenario settled. */
export interface ClaimRead {
  /** The session's worktree. */
  tree: string;
  session: string;
  /** claim:<id>, or '' when the stop made none (the scenario is BLOCKED then). */
  claim: string;
  made: Ev | null;
  verdicts: Ev[];
  /** The latest verdict.made's outcome, or null. */
  outcome: string | null;
  /** The claim's line and second line as `changes.read` gives them (what the chat and the receipt show). */
  line: string;
  /** Every hook deep-hook ran for the session, with what it told Claude Code: the session's tool output. */
  hooks: string[];
}
/** What the record shows once a scenario settled; `root` is the hub's root, where its evidence store keeps the bytes. */
export interface Reading { base: string; root: string; events: Ev[]; runs: RunRead[]; claims: ClaimRead[]; stderr: string }

/** Reads the record once the scenario settled, and each claim's line through `changes.read`. */
export async function readBack(hub: Hub, w: World, workers: Worker[]): Promise<Reading> {
  const events = await allEvents(hub);
  const claims: ClaimRead[] = [];
  for (const k of workers) {
    const made = claimMade(events, k.ref) ?? null;
    const claim = made ? claimId(made) : '';
    let line = '';
    if (claim) {
      try {
        const read = await control(hub, 'changes.read', { id: claim });
        const change = read.change as Line | undefined;
        line = `${String(change?.line ?? '')}\n${String(change?.second ?? '')}`;
      } catch (error) {
        line = `changes.read failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const verdicts = claim ? verdictsAbout(events, claim) : [];
    claims.push({
      tree: k.tree, session: k.s.id, claim, made, verdicts, outcome: verdicts.length ? String(verdicts[verdicts.length - 1]!.data.outcome) : null, line,
      hooks: k.s.hooks.map((h) => `${h.event}: ${h.ran.stdout}\n${h.ran.stderr}`),
    });
  }
  return { base: w.base, root: w.root, events, runs: runsIn(events), claims, stderr: hub.stderr().slice(-2000) };
}

/**
 * Waits until every worker's stop made its claim and no run in the record is still going, and then until no run or
 * verdict event has come for 3 s once each claim has a verdict.made, or for 30 s while one still has none (a claim left
 * waiting for runs that no one starts); at most `timeoutMs`. The judgements say what is missing. A stop that made no
 * claim is BLOCKED (thrown).
 */
export async function settled(hub: Hub, w: World, workers: Worker[], timeoutMs = 600_000): Promise<Reading> {
  const deadline = Date.now() + timeoutMs;
  let seen = -1;
  let quiet = Date.now();
  for (;;) {
    const events = await allEvents(hub);
    const made = workers.map((k) => claimMade(events, k.ref));
    const idle = made.every((c) => c !== undefined) && runsIn(events).every((r) => r.finished !== null);
    const moved = events.filter((e) => e.kind.startsWith('run.') || e.kind === 'verdict.made').length;
    if (moved !== seen || !idle) { seen = moved; quiet = Date.now(); }
    const judged = idle && made.every((c) => verdictsAbout(events, claimId(c!)).length > 0);
    if ((idle && Date.now() - quiet >= (judged ? 3000 : 30_000)) || Date.now() > deadline) break;
    await sleep(500);
  }
  const r = await readBack(hub, w, workers);
  for (const c of r.claims) if (!c.claim) throw Error(`BLOCKED: the stop in ${c.tree} made no claim: the record holds ${r.events.map((e) => e.kind).join(', ')}; hub stderr ${JSON.stringify(r.stderr.slice(-800))}`);
  return r;
}

// ---- What a reading shows, for failure messages.
export const shownRun = (x: RunRead, base: string): string => `${x.run} (${x.check} ${x.commit === base ? 'on the merge base' : 'on the snapshot'} for ${x.claim}: ${x.outcome ?? 'running'})`;
export const shownReading = (r: Reading): string =>
  `claims ${JSON.stringify(r.claims.map((c) => ({ tree: c.tree.split('/').pop(), claim: c.claim, outcome: c.outcome, verdicts: c.verdicts.map((v) => ({ outcome: v.data.outcome, reasons: v.data.reasons, ts: v.ts })), line: c.line })))}; runs ${r.runs.map((x) => shownRun(x, r.base)).join('; ') || 'none'}`;
/** Everything a claim's verdict says, in the record and on its line: where `carried` and the runs it names are read. */
export const verdictText = (c: ClaimRead): string => `${c.verdicts.map((v) => JSON.stringify(v.data)).join('\n')}\n${c.line}`;

/**
 * The claim reads a result as carried, naming the run it carried: its verdict (verdict.made, or its line from
 * changes.read) says `carried` and names that run by its handle.
 */
export function readsCarried(r: Reading, c: ClaimRead, run: string, what: string): void {
  const text = verdictText(c);
  expect(text.includes(run) && /\bcarried\b/i.test(text), `${what}: ${c.claim} (${c.tree}) must read ${run} as carried, its verdict naming that run and marked carried; it says ${JSON.stringify(text.slice(0, 1500))}; ${shownReading(r)}`).toBe(true);
}

/**
 * Asserts a judgement that holds on the right program fails on the planted one, and that its failure names each of
 * `names`; BLOCKED and INCONCLUSIVE are rethrown (#29's `failureOf`). The judgement passing on the plant fails here,
 * at an `expect`.
 */
export async function mustFail(what: string, judge: () => void, names: string[] = []): Promise<void> {
  const message = await failureOf(judge);
  expect(message, `${what}: the planted wrong program passed the judgement, so it proves nothing`).not.toBeNull();
  for (const n of names) expect(message, `${what}: the failure must name ${n}`).toContain(n);
}
