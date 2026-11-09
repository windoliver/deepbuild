// #1334 AC3 on two scenes (README: The scenes): main red, where nothing may be promoted, and a turn running, where a
// promotion waits for the drain; and the Scope line that only a commit main watch passed is promoted.
import { after, before, describe, test } from 'node:test';
import {
  LANDINGS, LONG, assert, current, ended, fiveAndTick, hello, hook, hubStarts, land, launchd, makeBuild, promote, sandbox, session, sha7, shown, starts,
  tick, toolCall, turn, typed, unrecorded, until, events, wait, watchStatus, watched,
} from './helpers.mjs';

const refusal = (run) => run.status === 1 || run.status === 3;
const said = (run) => `${run.stdout}\n${run.stderr}`;

describe('main is red', () => {
  let o;
  const cleanups = [];
  after(async () => { for (const cleanup of cleanups) await cleanup(); });
  before(async () => {
    const box = await sandbox({ after: (cleanup) => cleanups.push(cleanup) });
    const fx = watched(box);
    o = { box, fx };
    o.tick1 = await tick(box, fx);
    o.watch1 = await watchStatus(box, fx);
    // A landing main watch hasn't run on yet, while main is clean.
    o.x = land(box, fx);
    o.unwatched = makeBuild(box, 'unwatched', o.x, 'good');
    o.refusedX = await ended(promote(box, fx, o.unwatched), 600_000);
    o.afterX = { current: current(box), launched: launchd(box).filter((e) => e.event === 'start').length };
    // Four more, the last breaking the fixture's test: main watch's next run finds main red, and it stays red.
    for (let k = 2; k <= LANDINGS; k++) land(box, fx, { broken: k === LANDINGS });
    o.tick2 = await tick(box, fx);
    o.watch2 = await watchStatus(box, fx);
    // A build of c1, the commit of main watch's last clean run.
    o.again = makeBuild(box, 'again', fx.c1, 'good');
    o.refusedRed = await ended(promote(box, fx, o.again), 600_000);
    o.afterRed = { current: current(box), launched: launchd(box).filter((e) => e.event === 'start').length };
  }, LONG);

  test('#1334.a6dc45e5 no promotion happens while main is red', LONG, () => {
    const { fx } = o;
    assert.ok(o.tick1.status === 0 && o.watch1.state === 'open', `main watch didn't pass c1 ${sha7(fx.c1)}: ${shown(o.tick1)}`);
    assert.equal(o.watch2.state, 'paused', `main watch's run after the breaking landing must read main red (landings paused): ${o.watch2.line}\n${shown(o.tick2)}`);
    assert.ok(refusal(o.refusedRed), `deep hub promote of a build of ${sha7(fx.c1)}, main watch's last clean commit, must be refused while main is red (exit 1 or 3): ${shown(o.refusedRed)}`);
    assert.match(said(o.refusedRed), /\bred\b/i, 'the refusal must say main is red');
    assert.deepEqual(starts(o.box).filter((s) => s.build === 'again'), [], 'no program of the refused build may run');
    assert.equal(o.afterRed.current, undefined, 'nothing is promoted: ~/.deepbuild/versions/current must not appear');
    assert.equal(o.afterRed.launched, 0, 'nothing is promoted: the login service must start no hub');
  });

  test('a build is promoted only from a commit main watch passed: one of a landing it hasn\'t run on is refused, naming the commit', LONG, () => {
    const { fx } = o;
    assert.ok(o.tick1.status === 0 && o.watch1.state === 'open', `main watch didn't pass c1 ${sha7(fx.c1)}: ${shown(o.tick1)}`);
    assert.ok(refusal(o.refusedX), `deep hub promote of a build of ${sha7(o.x)}, a landing main watch hasn't run on, must be refused (exit 1 or 3): ${shown(o.refusedX)}`);
    assert.ok(said(o.refusedX).includes(sha7(o.x)), `the refusal must name the commit ${sha7(o.x)}`);
    assert.deepEqual(starts(o.box).filter((s) => s.build === 'unwatched'), [], 'no program of the refused build may run');
    assert.equal(o.afterX.current, undefined, 'nothing is promoted: ~/.deepbuild/versions/current must not appear');
    assert.equal(o.afterX.launched, 0, 'nothing is promoted: the login service must start no hub');
  });
});

describe('a turn is running', () => {
  test('#1334.a6dc45e5 no promotion happens while a turn is running: it waits for the drain, the hub serving the turn, then promotes and the run resumes', LONG, async (t) => {
    const box = await sandbox(t);
    const fx = watched(box);
    const tick1 = await tick(box, fx);
    const watch1 = await watchStatus(box, fx);
    assert.ok(tick1.status === 0 && watch1.state === 'open', `main watch didn't pass c1 ${sha7(fx.c1)}: ${shown(tick1)}`);
    const first = await ended(promote(box, fx, makeBuild(box, 'good', fx.c1, 'good')), 900_000);
    assert.ok(first.status === 0 && current(box)?.commit === fx.c1 && (await hello(box, 5000)),
      `the first promotion, of a build of ${sha7(fx.c1)} that main watch passed, must leave versions/current on it and the hub answering: ${shown(first)}`);
    const second = await fiveAndTick(box, fx);
    assert.equal(second.status.state, 'open', `main watch didn't pass c2 ${sha7(second.head)}: ${shown(second.run)}`);

    // A session's turn starts on the good build, and runs while the promotion of c2's build is asked for.
    const s = session(box);
    await hook(box, s, 'SessionStart');
    // A prompt you typed, with its transcript entry, as Claude Code writes it: the turn runs from here to its Stop.
    await typed(box, s, 'work through the promotion');
    const was = await hello(box, 5000);
    const child = promote(box, fx, makeBuild(box, 'next', second.head, 'good'));
    const polls = [];
    const from = Date.now();
    let inTurn;
    while (Date.now() - from < 20_000) {
      polls.push({ t: Date.now(), hello: await hello(box, 1500), commit: current(box)?.commit });
      if (!inTurn && Date.now() - from > 10_000) inTurn = await toolCall(box, s, 'echo still working');
      await wait(500);
    }
    const stopAt = Date.now();
    await hook(box, s, 'Stop');
    const promoted = await ended(child, 900_000);

    const early = hubStarts(box, 'next').filter((x) => x.t < stopAt);
    assert.deepEqual(early, [], `the build of ${sha7(second.head)} started as the installed hub ${early.map((x) => `${((x.t - from) / 1000).toFixed(1)} s`).join(', ')} after the promotion was asked for, while the session's turn ran (its Stop came at ${((stopAt - from) / 1000).toFixed(1)} s)`);
    assert.ok(promoted.ended > stopAt, `deep hub promote ended ${((promoted.ended - from) / 1000).toFixed(1)} s in, while the turn ran: a promotion waits for the drain\n${shown(promoted)}`);
    const answered = polls.filter((p) => p.hello);
    assert.ok(answered.length >= polls.length / 2 && polls.slice(-6).some((p) => p.hello), `the hub must keep serving the running turn while the promotion waits: it answered ${answered.length} of ${polls.length} polls`);
    assert.deepEqual([...new Set(answered.map((p) => p.hello.start))], [was.start], 'the hub must not restart while the turn runs');
    assert.deepEqual([...new Set(polls.map((p) => p.commit))], [fx.c1], 'versions/current must stay on the good build while the turn runs');
    assert.equal(promoted.status, 0, `once the turn ended, the promotion of ${sha7(second.head)} must go through: ${shown(promoted)}`);
    assert.equal(current(box)?.commit, second.head, 'versions/current must name the promoted build');
    assert.ok(hubStarts(box, 'next', stopAt).length > 0, 'the installed hub must run the promoted build');
    const now = await until(() => hello(box, 1000), 60_000, 500);
    assert.ok(now && now.start !== was.start, 'the hub must have restarted on the promoted build and answer');
    // The run resumes: the turn's own call and the session's next turn are in the record.
    const next = await turn(box, s, 'after the promotion');
    const recorded = await until(async () => { const all = await events(box).catch(() => undefined); return all && !unrecorded(all, s, [inTurn.id, next.call.id]).length ? all : undefined; }, 60_000, 1000);
    assert.ok(recorded, 'the call the running turn made, and the next turn\'s call, must be in the record');
  });
});
