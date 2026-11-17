// #1851.35ae3eb0 AC1 With `~/.deepbuild/control.token` removed after the hub starts, an answer to an idle Claude Code
//   session is still delivered by the waiter within 2 s; the waiter on the merge base can't connect and fails this
//   test, naming the ask.
// #1851.bbec9b71 AC2 A waiter started for session A that asks to wait on session B is refused, naming the binding, and
//   B's answer never reaches A.
// #1851.c13ec84e AC3 A process that isn't a child of the session's agent, saying hello as that session's waiter, is
//   refused, naming the process.
//
// Every waiter here is the real `deep-hook claude-code waiter`, by the entry `deep setup` wrote under Stop, with a Stop
// payload on stdin; exit 2 with the answer on stderr is the delivery (README, The surface). The sessions are the Claude
// Code delivery suite's (../../25/routes): each its own Claude Code stand-in, whose hooks, `deep mcp` and waiter are
// its children, asking through deep_ask and stopping, so its Stop goes through and it is idle. The merge base's waiter
// says hello as the CLI with the token from the file: it never connects once the file is gone (AC1), and with the
// file there it is served any session's answers from any process (AC2, AC3). BASE-FAILURE.txt holds that run.

import { existsSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import { askingSession, carries, cleanup, makeHome, payload, setup, sleep, startHub } from '../../25/routes/helpers.ts';
import {
  answerFrom, heldToken, idleSession, judgeWithin, markNow, namesPid, outsiderWaiter, refusalsSince, removeToken, runNow, runShown, saidShown,
  settle, stopToIdle, stopWaiter, tokenFile, tookAnswer, waiterUnder, yourHome,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** How long a waiter that is to be refused gets to connect and ask before you answer. */
const ASKED_MS = 3000;
/** The bounded time after your answer is accepted in which an answer that must never arrive would have. */
const NEVER_MS = 5000;
const LAST_WORDS = 'I asked which header colour you want; I will wait for your answer.';

test('#1851.35ae3eb0 AC1 with control.token removed after the hub starts, the answer to an idle Claude Code session is delivered by its waiter within 2 s', async (ctx) => {
  const { home } = makeHome();
  const hub = await startHub(home, { noAskWait: true, shortHold: true });
  await setup(home);
  // The session asks while the file is still there (this suite reads the ask through it), and has not stopped yet.
  const a = await askingSession(hub, home);
  // You hold the token, as the app does from the hub's launch; then the file is gone, before any waiter starts.
  const token = heldToken(home);
  const you = yourHome(hub, token);
  removeToken(home);
  // The session stops: its hold ends with nothing answered, it is idle, and the waiter Claude Code started is running.
  const waiter = await stopToIdle(a);
  expect(existsSync(tokenFile(home)), 'BLOCKED: ~/.deepbuild/control.token must still be removed once the waiter is running').toBe(false);

  const answered = await answerFrom(you, a.handle, a.green.id);
  await settle(async () => (await runNow(a.claude, waiter.pid)).ended !== null, answered.ended, 0, 30_000);
  const run = await runNow(a.claude, waiter.pid);

  const ask = `your answer "${a.green.label}" to ${a.handle} ("${a.question}"), the ask of idle session ${a.s.id}`;
  expect(existsSync(tokenFile(home)), '~/.deepbuild/control.token stays removed: nothing wrote it again').toBe(false);
  expect({ exit: run.code, carriesTheAnswer: carries(run.stderr, a.green) },
    `with ~/.deepbuild/control.token removed after the hub started, ${ask}, is delivered by the session's waiter (process ${waiter.pid}: exit 2 with the answer on stderr); 30 s after the answer was accepted the waiter was ${runShown(run)}`)
    .toEqual({ exit: 2, carriesTheAnswer: true });
  judgeWithin(ctx, `AC1 ${a.handle}: from your answer accepted (deep inbox answer's exit) to the waiter's exit 2`, Math.max(0, run.ended! - answered.ended), 2000);
}, 600_000);

test('#1851.bbec9b71 AC2 a waiter started under session A\'s agent that asks to wait on session B is refused, naming the binding, and B\'s answer never reaches A', async () => {
  const { home } = makeHome();
  const hub = await startHub(home, { noAskWait: true, shortHold: true });
  await setup(home);
  const token = heldToken(home);
  // Two idle sessions, each its own Claude Code with its own waiter running.
  const A = await idleSession(hub, home);
  const B = await idleSession(hub, home);
  const mark = await markNow(hub, token);

  // Session A's Claude Code runs the waiter entry once more, as its own child, with a Stop payload naming session B.
  const asking = await waiterUnder(A.a.claude, stopWaiter(home), payload(B.a.s, 'Stop', { last_assistant_message: LAST_WORDS }));
  await sleep(ASKED_MS);
  const answered = await answerFrom(home, B.a.handle, B.a.green.id);
  // Until B's answer went somewhere (to B's own waiter, or to the one under A), and at least the bounded time.
  await settle(async () => (await runNow(B.a.claude, B.waiter.pid)).code === 2 || tookAnswer(await runNow(A.a.claude, asking.pid), B.a), answered.ended, NEVER_MS, 30_000);

  const under = await runNow(A.a.claude, asking.pid);
  const ownA = await runNow(A.a.claude, A.waiter.pid);
  const ownB = await runNow(B.a.claude, B.waiter.pid);
  const wokenA = A.a.claude.wakes.filter((w) => carries(`${w.stderr}${w.prompt ?? ''}`, B.a.green));
  const who = `the waiter (process ${asking.pid}) session A ${A.a.s.id}'s agent ${A.a.claude.pid} started with a Stop payload naming session B ${B.a.s.id}`;
  const answer = `B's answer "${B.a.green.label}" to ${B.a.handle}`;

  expect({ tookTheAnswer: tookAnswer(under, B.a) }, `${answer} never reaches ${who}: ${NEVER_MS} ms after the answer was accepted it was ${runShown(under)}; B's own waiter was ${runShown(ownB)}`).toEqual({ tookTheAnswer: false });
  expect({ tookTheAnswer: tookAnswer(ownA, B.a), wakes: wokenA.length }, `${answer} never reaches session A's own waiter or wakes A's Claude Code: its waiter was ${runShown(ownA)}`).toEqual({ tookTheAnswer: false, wakes: 0 });

  const said = await refusalsSince(hub, token, mark, under.stderr);
  const naming = said.filter((s) => s.text.includes(A.a.s.id) || namesPid(s.text, A.a.claude.pid));
  expect(naming.map((s) => s.where).slice(0, 1).length,
    `${who} is refused, the refusal naming the binding: session A ${A.a.s.id} or its agent process ${A.a.claude.pid}. What was said since it started:\n${saidShown(said)}`).toBe(1);

  expect({ exit: ownB.code, carriesTheAnswer: carries(ownB.stderr, B.a.green) }, `${answer} is still delivered to B, by B's own waiter (process ${B.waiter.pid}): it was ${runShown(ownB)}`).toEqual({ exit: 2, carriesTheAnswer: true });
}, 600_000);

test('#1851.c13ec84e AC3 a process that isn\'t a child of the session\'s agent, run as that session\'s waiter, is refused, naming the process', async () => {
  const { home } = makeHome();
  const hub = await startHub(home, { noAskWait: true, shortHold: true });
  await setup(home);
  const token = heldToken(home);
  const S = await idleSession(hub, home);
  const mark = await markNow(hub, token);

  // The waiter entry run by this test process with the session's own Stop payload: no agent is above it.
  const outsider = outsiderWaiter(home, stopWaiter(home), S.a.s);
  await sleep(ASKED_MS);
  if (/not found|No such file|Permission denied/.test(outsider.stderr)) throw Error(`BLOCKED: the waiter entry didn't run from this test process: ${runShown(outsider)}`);
  const answered = await answerFrom(home, S.a.handle, S.a.green.id);
  await settle(async () => (await runNow(S.a.claude, S.waiter.pid)).code === 2 || tookAnswer(outsider, S.a), answered.ended, NEVER_MS, 30_000);

  const own = await runNow(S.a.claude, S.waiter.pid);
  const who = `process ${outsider.pid}, a waiter this test started for session ${S.a.s.id} (no child of its agent ${S.a.claude.pid})`;
  const answer = `the answer "${S.a.green.label}" to ${S.a.handle}`;

  expect({ tookTheAnswer: tookAnswer(outsider, S.a) }, `${answer} never reaches ${who}: ${NEVER_MS} ms after the answer was accepted it was ${runShown(outsider)}; the session's own waiter was ${runShown(own)}`).toEqual({ tookTheAnswer: false });

  const said = await refusalsSince(hub, token, mark, outsider.stderr);
  const naming = said.filter((s) => namesPid(s.text, outsider.pid));
  expect(naming.map((s) => s.where).slice(0, 1).length, `${who} is refused, the refusal naming the process ${outsider.pid}. What was said since it started:\n${saidShown(said)}`).toBe(1);

  expect({ exit: own.code, carriesTheAnswer: carries(own.stderr, S.a.green) }, `${answer} is still delivered to the session, by its own waiter (process ${S.waiter.pid}): it was ${runShown(own)}`).toEqual({ exit: 2, carriesTheAnswer: true });
}, 600_000);
