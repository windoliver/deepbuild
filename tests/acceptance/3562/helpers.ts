// Shared test-side tools for #3562's acceptance tests (README): the criterion tags; a world of several Claude Code
// sessions on one hub, each in a repository of its own, with one ask whose definition names a 2 s fast-lane check and
// a 300 s journey; a stop sent without waiting on its reply; each journey's run ended when the test says; and the
// record's readings. The hub (`deep hub run` with two check slots and a stepped clock), the sessions (played through
// the real deep-hook binary), the clock and the record's readers are #965's suite's (../965/helpers.ts), and the home,
// the repository and the handed definitions #29's (../29/h-d.ts): imported, never copied. Nothing here stands in for
// the hub, the gate runner or deep-hook: every reading comes from them.
//
// Safety: folders are under /tmp/dh29-* (made by ../29/h-d.ts's makeWorld) and removed by `cleanup`; no network, no
// model, no real `claude`, no sign-in; every process a test starts is stopped by its PID, never by name or port.

import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { draftFor, makeWorld, req } from '../29/h-d.ts';
import {
  alive, allEvents, CART, cleanup, CLI, Clock, DEEP_HOOK, heldOf, Session, settle, shownHeld, startHub, stopHub,
  type Ev, type Hub, type StopSeen, type World,
} from '../965/helpers.ts';

export { allEvents, cleanup, heldOf, settle, shownHeld, stopHub, type Ev, type Hub, type StopSeen };

// ---- Criterion tags: `#3562.<first 8 hex of the SHA-256 of the criterion's text>`, as scripts/proof-change.mjs computes them.
export const AC1 = 'AC1 #3562.0a154c77';
export const AC2 = 'AC2 #3562.56d682a0';
export const AC3 = 'AC3 #3562.cad82a22';

export const SECOND = 1000;
/** How long a stop may take to reach the record with its fast lane ended: past it the run says nothing (BLOCKED). */
export const JUDGED_WAIT_MS = 180 * SECOND;
/** How long a run may take to start once a slot is free for it, or to end once the test ends it. */
export const START_WAIT_MS = 180 * SECOND;
/** How long after its fast lane ended a stop's reply is waited for before the scenario goes on without it. */
export const REPLY_WAIT_MS = 30 * SECOND;
/** The words a stop's line names one check with while it waits for a slot (README, Surfaces). */
export const QUEUED_LINE = '1 check queued';

/** The sessions, as the criteria count them. */
export type Name = 'first' | 'second' | 'third' | 'fourth';
/** What each session types: an ask for a change, so it opens one task, whose handed definition names the session's two checks. */
const ASKS: Record<Name, { ask: string; unit: string; journey: string }> = {
  first: { ask: 'make the cart total round each line to cents', unit: 'each line of the cart total is rounded to cents', journey: 'checkout shows the rounded total' },
  second: { ask: 'make the cart total show two decimal places', unit: 'the cart total shows two decimal places', journey: 'checkout shows the total with two decimal places' },
  third: { ask: 'add a currency symbol to the cart total', unit: 'the cart total shows a currency symbol', journey: 'checkout shows the total with its currency symbol' },
  fourth: { ask: 'fix the cart total of an empty cart', unit: 'an empty cart totals zero', journey: 'checkout shows zero for an empty cart' },
};
/** A session's checks, by the path its definition names: its 2 s fast-lane check and its 300 s journey. */
const unitOf = (name: Name): string => `.deepbuild/checks/unit-${name}.sh`;
const journeyOf = (name: Name): string => `.deepbuild/checks/journey-${name}.sh`;
/** The file whose appearing in a journey run's folder ends that run. */
const endFile = (check: string): string => `${basename(check, '.sh')}.end`;

/** A setup that can't say anything about the criterion: thrown on, never read as its failure. */
export function blocked(message: string): never {
  throw Error(`BLOCKED: ${message}`);
}
/** Whether the hub still runs, and the end of what it wrote to stderr: what a BLOCKED setup names. */
export const hubState = (hub: Hub): string => `the hub (pid ${hub.pid}) ${alive(hub.pid) ? 'is running' : 'has exited'}; its stderr ends ${JSON.stringify(hub.stderr().slice(-1200))}`;

// ---- The world.
const git = (cwd: string, home: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
  cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' },
}).trim();
/** A drafted check: `sh` runs a node:test suite of one test, so the command check kind counts it (#30). `body` is the test's. */
function writeCheck(repo: string, path: string, body: string): void {
  const suite = path.replace(/\.sh$/, '.test.mjs');
  writeFileSync(join(repo, path), `#!/bin/sh\nnode --test ${suite}\n`);
  chmodSync(join(repo, path), 0o755);
  writeFileSync(join(repo, suite), `import { existsSync } from 'node:fs';\nimport { test } from 'node:test';\ntest('${path}', async () => { ${body} });\n`);
}
/** A requirement of a handed definition with the time its check took when drafted, which the gate runner expects of it. */
const timed = (id: string, text: string, check: string, depth: string, expected_ms: number) => ({ ...req(id, text, { check, on_base: 'passes', depth }), expected_ms }) as ReturnType<typeof req>;
/**
 * The #29 suite's world (a home and a git repository) with `src/cart.ts` and, for each session named, one ask whose
 * handed definition has R1 checked by the session's unit check (unit depth, 2 s when drafted) and R2 by its journey
 * (journey depth, 300 s when drafted), both `on_base: passes`. So the 10 s budget admits the unit check to the fast
 * lane and leaves the journey to the slow lane. The checks are committed. The unit check passes at once; a journey's
 * run goes on until the test ends it (`endRun`). Each session gets a copy of the repository as its own folder.
 */
function world(names: readonly Name[]): { w: World; repos: Map<Name, string> } {
  const w = makeWorld({
    drafts: names.map((name) => draftFor(ASKS[name].ask, {
      requirements: [timed('R1', ASKS[name].unit, unitOf(name), 'unit', 2 * SECOND), timed('R2', ASKS[name].journey, journeyOf(name), 'journey', 300 * SECOND)],
      deliverables: [CART],
    })),
  });
  writeFileSync(join(w.repo, CART), 'export function total(lines: number[]): number {\n  return lines.reduce((a, b) => a + b, 0);\n}\n');
  for (const name of names) {
    writeCheck(w.repo, unitOf(name), '');
    writeCheck(w.repo, journeyOf(name), `while (!existsSync('${endFile(journeyOf(name))}')) await new Promise((done) => setTimeout(done, 50));`);
  }
  git(w.repo, w.tmp, 'add', '-A');
  git(w.repo, w.tmp, 'commit', '-qm', 'the cart and its drafted checks');
  const base = git(w.repo, w.tmp, 'rev-parse', 'HEAD');
  const repos = new Map<Name, string>();
  for (const name of names) {
    const dir = join(w.tmp, name);
    cpSync(w.repo, dir, { recursive: true });
    repos.set(name, realpathSync(dir));
  }
  return { w: { ...w, base }, repos };
}

// ---- The sessions on one hub.
/** One session: its Claude Code (#965's `Session`), its ask and its two checks, and how many turns and stops it has made. */
export interface Player { name: Name; index: number; s: Session; ask: string; unit: string; journey: string; turns: number; stops: number }
export interface Play { w: World; hub: Hub; clock: Clock; players: Player[] }

/** The task the session's typed ask opened, once its definition is locked. */
async function opened(hub: Hub, p: Player): Promise<void> {
  const locked = (e: readonly Ev[]): boolean => {
    const ask = e.find((x) => x.kind === 'user.ask' && x.session === p.s.id && x.data.text === p.ask);
    const ref = Array.isArray(ask?.data.tasks) && ask.data.tasks.length === 1 ? String(ask.data.tasks[0]) : undefined;
    return ref !== undefined && e.some((x) => x.kind === 'definition.locked' && x.data.task_ref === ref);
  };
  if (!locked(await settle(hub, locked, JUDGED_WAIT_MS))) blocked(`the ${p.name} session's typed ask "${p.ask}" opened no task with a locked definition within ${JUDGED_WAIT_MS / SECOND} s; ${hubState(hub)}`);
}
/**
 * A world, its hub (#965's `startHub`: DEEP_HUB_TEST_CORES=4, so two check slots, and DEEP_HUB_TEST_CLOCK_STEPS=1) and
 * one session for each name, in its own folder: each has typed its ask, and its task's definition is locked. A build
 * that isn't there is BLOCKED, naming it.
 */
export async function begin(names: readonly Name[]): Promise<Play> {
  for (const [what, path] of [['the deep CLI (npm run build --workspaces)', CLI], ['deep-hook (cargo build --locked -p deep-hook)', DEEP_HOOK]] as const) {
    if (!existsSync(path)) blocked(`${what} is not built at ${path}`);
  }
  const { w, repos } = world(names);
  const hub = await startHub(w);
  const clock = new Clock(hub);
  const players = names.map((name, index): Player => ({
    name, index, s: new Session({ ...w, repo: repos.get(name)! }, clock), ask: ASKS[name].ask, unit: unitOf(name), journey: journeyOf(name), turns: 0, stops: 0,
  }));
  await Promise.all(players.map(async (p) => {
    await p.s.start();
    await p.s.typed(p.ask);
    await opened(hub, p);
  }));
  return { w, hub, clock, players };
}

/**
 * The session's next turn, up to its stop: the first is the one its ask opened; each later one starts with a
 * question you type, which opens no task, so the turn works the ask already open. Every turn changes src/cart.ts (a
 * line no other turn of any session writes, so each snapshot differs).
 */
export async function turn(p: Player): Promise<void> {
  p.turns += 1;
  if (p.turns > 1) await p.s.typed(`does the cart total still hold after change ${p.turns}?`);
  await p.s.editCart((p.index + 1) * 1000 + p.turns);
}

/** A stop as it was sent: when (on the hub's clock), its Stop hook's run still going or ended, and what the session saw once it ended. */
export interface Sent { p: Player; k: number; at: number; hook: Promise<StopSeen>; seen: StopSeen | undefined }
/** The session's agent says it's done and its Stop hook is sent. Nothing waits on the hook here: `hook` resolves when it returns. */
export function stop(p: Player): Sent {
  p.stops += 1;
  const sent: Sent = { p, k: p.stops, at: p.s.clock.now(), hook: p.s.stop(`Change ${p.stops}: the cart total is right.`), seen: undefined };
  void sent.hook.then((seen) => { sent.seen = seen; });
  return sent;
}

/** A judged stop whose fast lane has ended: its claim, the snapshot its runs name, and its unit check's run from start to end. */
export interface Judged { claim: string; snapshot: string; unit: Ev; ended: Ev }
/**
 * Waits for the stop to be judged and its fast lane to end: the session's k-th `claim.made` of the stop rule (the
 * one carrying the recomputed definition `hash`), its unit check's `run.started` naming that claim, and that run's
 * `run.finished`. A stop the hub doesn't judge in time, a unit check the budget left to the slow lane, or one that
 * didn't pass makes no green stop with a fast lane: BLOCKED, never a pass or a failure of the criterion.
 */
export async function judged(play: Play, sent: Sent): Promise<Judged> {
  const { p, k } = sent;
  const read = (e: readonly Ev[]): { claim: string; unit: Ev | undefined; ended: Ev | undefined } | undefined => {
    const made = e.filter((x) => x.kind === 'claim.made' && x.session === p.s.id && typeof x.data.hash === 'string')[k - 1];
    if (!made) return undefined;
    const claim = `claim:${made.id}`;
    const unit = e.find((x) => x.kind === 'run.started' && x.data.claim === claim && x.data.check === p.unit);
    return { claim, unit, ended: unit && finishedOf(e, unit) };
  };
  const found = read(await settle(play.hub, (e) => read(e)?.ended !== undefined, JUDGED_WAIT_MS));
  const who = `stop ${k} of the ${p.name} session`;
  if (!found?.unit || !found.ended) blocked(`${who} was not judged with its fast lane ended within ${JUDGED_WAIT_MS / SECOND} s (${found ? `its claim ${found.claim} has ${found.unit ? 'a run of' : 'no run of'} ${p.unit}${found.unit ? ' that has not ended' : ''}` : 'no claim.made of the stop'}); its Stop hook: ${sent.seen ? JSON.stringify({ code: sent.seen.ran.code, stdout: sent.seen.ran.stdout.slice(0, 300), stderr: sent.seen.ran.stderr.slice(0, 300) }) : 'still running'}; ${hubState(play.hub)}`);
  if (found.unit.data.lane !== 'fast') blocked(`${who}: its 2 s check ${p.unit} ran in the ${String(found.unit.data.lane)} lane, so the stop had no fast lane. Its snapshot and checkout took too much of the 10 s budget on this machine; this run says nothing`);
  if (found.ended.data.outcome !== 'passed') blocked(`${who}: its fast-lane check ${p.unit} ended ${String(found.ended.data.outcome)}, so the stop is not green`);
  return { claim: found.claim, snapshot: String(found.unit.data.commit), unit: found.unit, ended: found.ended };
}

/**
 * The stop's reply as the session saw it, or undefined where its Stop hook has not returned `ms` after this is asked,
 * which a test asks once the stop's fast lane has ended. A hub that holds the reply until a slot frees must not hold
 * the scenario too: the next thing is sent without it. A reply that sends the agent back ends no turn, so its slow
 * checks take no place: BLOCKED.
 */
export async function replied(sent: Sent, ms = REPLY_WAIT_MS): Promise<StopSeen | undefined> {
  let bound: NodeJS.Timeout | undefined;
  // deadline: the reply is the event waited for; this only lets the scenario go on where a hub holds it back
  const late = new Promise<undefined>((done) => { bound = setTimeout(() => done(undefined), ms); });
  try {
    const seen = await Promise.race([sent.hook, late]);
    if (seen?.block !== undefined) blocked(`stop ${sent.k} of the ${sent.p.name} session was sent back, so its turn did not end: ${seen.block.slice(0, 600)}`);
    return seen;
  } finally {
    clearTimeout(bound);
  }
}
/**
 * Whether a stop's reply came with its line only after the scenario had gone on without it. On a hub that replies when
 * the fast lane ends, that is a machine too slow for the stops to come one after another: the run says nothing.
 */
export const repliedLate = (sent: Sent, inTime: boolean): boolean => !inTime && sent.seen !== undefined && sent.seen.line !== '';

// ---- Reading the record.
/** The runs of a session's journey that started, in log order. */
export const journeysOf = (events: readonly Ev[], p: Player): Ev[] => events.filter((e) => e.kind === 'run.started' && e.data.check === p.journey);
/** The `run.finished` of a run that started, once it has ended. */
export const finishedOf = (events: readonly Ev[], started: Ev): Ev | undefined => events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run);
/** A stop's held time as the record has it: the `stop.held` naming its claim, stamped at its reply on the hub's clock. */
export const heldTimeOf = (events: readonly Ev[], claim: string): Ev | undefined => events.find((e) => e.kind === 'stop.held' && e.data.claim === claim);
/** A run as a failure message and the Proof show it: its check, its snapshot by the name given or its first 7 hex, its lane and its start on the hub's clock. */
export const shown = (run: Ev, snapshots: Record<string, string> = {}): string => {
  const commit = String(run.data.commit);
  return `${String(run.data.check)} on ${Object.entries(snapshots).find(([, c]) => c === commit)?.[0] ?? commit.slice(0, 7)} (${String(run.data.lane)} lane) started at ${run.ts}`;
};

/**
 * Ends a journey's run: its suite goes on until a file appears in the folder it runs in, which its `run.started` names
 * (`cwd`), and passes then. So a slot frees when the test says, never when a clock does.
 */
export function endRun(started: Ev): void {
  const cwd = String(started.data.cwd ?? '');
  if (!cwd.startsWith('/') || !existsSync(cwd)) blocked(`the run.started of ${String(started.data.check)} names no folder this test can reach (cwd ${JSON.stringify(cwd)}), so its run can't be ended`);
  writeFileSync(join(cwd, endFile(String(started.data.check))), 'ended by the test\n');
}

/** A journey that is running: its session, its stop as it was sent and judged, and its run. */
export interface Going { p: Player; sent: Sent; stop: Judged; run: Ev }
/**
 * The session's next turn ends green while a slot is free for its journey, and its journey starts: the run that holds
 * the one slot slow runs may hold (two check slots, one kept for a held stop's quick checks, #907). Its Stop hook has
 * returned. A journey that doesn't start leaves no scenario: BLOCKED.
 */
export async function journeyRunning(play: Play, p: Player): Promise<Going> {
  await turn(p);
  const sent = stop(p);
  const judgedStop = await judged(play, sent);
  const mine = (e: readonly Ev[]): Ev | undefined => journeysOf(e, p).find((x) => x.data.claim === judgedStop.claim);
  const run = mine(await settle(play.hub, (e) => mine(e) !== undefined, START_WAIT_MS));
  if (!run) blocked(`the ${p.name} session's journey ${p.journey} did not start within ${START_WAIT_MS / SECOND} s of its green stop with a check slot free, so no journey is running; ${hubState(play.hub)}`);
  await sent.hook;
  return { p, sent, stop: judgedStop, run };
}
