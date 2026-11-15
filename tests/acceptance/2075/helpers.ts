// #2075: a real hub (`deep hub run`), deep-hook and a Claude Code stand-in, as tests/acceptance/29 drive them; the only
// addition is the hub's test-only stop hold (DEEP_HUB_TEST_STOP_HOLD_MS), so a fast check can run past the reply's
// deadline in seconds, not minutes. Nothing is mocked: the checks are real scripts run by the real gate runner.
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  allEvents, askNamed, BEHAVIOR, childEnv, CLI, draftFor, lockedFor, makeWorld, NODE, own, parseObject, QUESTION, req, Session, settle, sleep, taskOf,
  type Ev, type Hub, type World,
} from '../29/h-d.ts';

export { allEvents, BEHAVIOR, cleanup, QUESTION, Session, settle, sleep, stopHub, type Ev, type Hub } from '../29/h-d.ts';

/** The stop's reply deadline in the core. The gate runner's own hold stays 60 s from its claim's setup, so it outlasts it. */
export const HOLD_MS = 3000;
/** How long the fast check runs: past the reply's deadline (the checkout and the stop's judging come first), well inside the runner's hold. */
export const FAST_MS = 9000;
export const FAST = '.deepbuild/checks/fast.sh';
export const SLOW = '.deepbuild/checks/slow.sh';

export async function startHub(w: World): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_TEST_STOP_HOLD_MS: String(HOLD_MS) });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: join(w.repo, '..'), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Record<string, unknown> | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!)); });
    }),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), clock: undefined, plant: undefined, stderr: () => err };
}

export interface Play { hub: Hub; s: Session; ref: string }

/**
 * A world with one task whose definition has two requirements: R1 is checked by FAST, a script that runs FAST_MS and then
 * passes or fails; R2 by SLOW, a script that passes at once but whose expected time (20 s) is past the 10 s fast-lane
 * budget, so it is a slow-lane check. FAST has no clean run on record, so its expected time is 0 and it is admitted to the
 * fast lane whatever it takes. The session has asked, its definition is locked, and it has made an edit.
 */
export async function play(fastEnds: 'pass' | 'fail'): Promise<Play> {
  const w = makeWorld({
    drafts: [
      draftFor(BEHAVIOR, {
        requirements: [
          req('R1', 'an expired token is rejected', { check: FAST, on_base: 'passes' }),
          { ...req('R2', 'the rejection is logged', { check: SLOW, on_base: 'passes' }), expected_ms: 20_000 } as ReturnType<typeof req>,
        ],
        deliverables: ['src/auth.ts'],
      }),
      draftFor(QUESTION),
    ],
  });
  writeFileSync(join(w.repo, FAST), `#!/bin/sh\nnode -e "setTimeout(() => process.exit(${fastEnds === 'pass' ? 0 : 1}), ${FAST_MS})"\n`);
  writeFileSync(join(w.repo, SLOW), '#!/bin/sh\nnode -e "process.exit(0)"\n');
  chmodSync(join(w.repo, FAST), 0o755);
  chmodSync(join(w.repo, SLOW), 0o755);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: w.repo });
  git('add', '-A');
  git('commit', '-qm', 'the checks');
  const hub = await startHub(w);
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  const events = await settle(hub, (e) => { const r = taskOf(askNamed(e, s, BEHAVIOR)); return r !== undefined && lockedFor(e, r).length > 0; });
  const ref = taskOf(askNamed(events, s, BEHAVIOR));
  if (ref === undefined) throw Error('BLOCKED: the ask opened no task');
  await s.read('src/auth.ts');
  await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now()');
  return { hub, s, ref };
}

/** The stop that goes through: Stop's reply comes at the hold's end, with the fast check still running. */
export async function stopPastHold(p: Play): Promise<{ claim: string; repliedAt: number; stdout: string }> {
  const r = await p.s.stop('checkToken now compares `src/auth.ts:2` with the clock.');
  const repliedAt = Date.now();
  const events = await allEvents(p.hub);
  const made = events.find((e) => e.kind === 'claim.made' && e.data.task_ref === p.ref);
  if (!made) throw Error(`BLOCKED: the stop made no claim: ${r.stdout}`);
  const claim = `claim:${made.id}`;
  // Prerequisites of every scenario: the fast check has started and not ended when the stop is let through, and the stop was not sent back.
  const fast = runsOf(events, claim, FAST);
  if (fast.started.length !== 1) throw Error(`BLOCKED: the fast check must have started once in the stop's hold: ${JSON.stringify(fast.started.map((e) => e.data))}`);
  if (fast.finished.length) throw Error(`BLOCKED: the fast check ended before the stop's reply (${fast.finished[0]!.data.outcome}); it must run past the hold`);
  if (fast.started[0]!.data.lane !== 'fast') throw Error(`BLOCKED: ${FAST} must run in the fast lane: ${fast.started[0]!.data.lane}`);
  if (JSON.parse(r.stdout || '{}').decision === 'block') throw Error(`BLOCKED: the stop was sent back, so the turn did not end: ${r.stdout}`);
  return { claim, repliedAt, stdout: r.stdout };
}

export const runsOf = (events: readonly Ev[], claim: string, check: string) => {
  const started = events.filter((e) => e.kind === 'run.started' && e.data.claim === claim && e.data.check === check);
  const ids = new Set(started.map((e) => e.data.run));
  return { started, finished: events.filter((e) => e.kind === 'run.finished' && ids.has(e.data.run)) };
};
export const verdictsOf = (events: readonly Ev[], claim: string) => events.filter((e) => e.kind === 'verdict.made' && e.subject === claim);
