// #2973 AC1, AC2 and AC3 on one installed hub, in this order (README: The scenes): a token holder's 7 restarts, the
// 7th refused; then the hub's clock moved past 60 minutes after the first, and one more restart going through; then,
// the budget spent again, a confirmed `deep hub stop` and `deep hub start`. Each test checks the budget is spent before
// it acts, by what the hub answers, so none passes on what an earlier one only assumed.
import { after, test } from 'node:test';
import {
  BACK_MS, BUDGET, LONG, STAYS_MS, WINDOW_MS, assert, backAfter, call, clockAhead, confirming, crash, deep, hello, iso, launchd, namesBudget, namesTimeIn,
  refusedReply, restart, restarted, runs, sandbox, shown, staysUp, startInstalled, text, until, upNow,
} from './helpers.mjs';

const cleanups = [];
after(async () => { for (const cleanup of cleanups) await cleanup(); });
const scene = {};

test('#2973.6813ca11 a token holder\'s 7 restarts of the installed hub, each once it is back: the first 6 restart it, the 7th is refused naming the budget, when the next frees up, deep hub stop and deep hub start, and the hub stays up', LONG, async () => {
  const box = await sandbox((cleanup) => cleanups.push(cleanup));
  scene.box = box;
  await startInstalled(box);
  scene.restarts = [];
  for (let k = 1; k <= BUDGET; k++) {
    const r = await restart(box);
    scene.restarts.push(r);
    assert.ok(restarted(r), `restart ${k} of ${BUDGET}, within the budget, must restart the installed hub: the login service starting it again on exit 75. It got ${text(r.reply, box)}; ${r.back ? `a hub came back after ${Math.round((r.back.t - r.asked) / 1000)} s` : `no hub came back with a new start ID within ${BACK_MS / 1000} s`}; the old hub's exit: ${JSON.stringify(r.exit)}`);
    assert.equal(r.exit?.code, 75, `restart ${k}'s hub must exit 75 for the login service to start it again; its exit: ${JSON.stringify(r.exit)}`);
  }
  const first = scene.restarts[0];
  const reply = await restart(box);
  const { before: answered, pid, asked } = reply;
  scene.seventh = reply;
  assert.ok(refusedReply(reply.reply), `the 7th hub.restart within 60 minutes must be refused: 6 restarts in any 60 minutes are the budget. It got ${text(reply.reply, box)}${reply.back ? `, and the hub went down again: a new hub (start ${reply.back.hello.start}) answered ${Math.round((reply.back.t - asked) / 1000)} s later` : ''}`);
  scene.refused = true;
  const words = text(reply.reply.error, box);
  const budget = namesBudget(words);
  assert.ok(!budget, `the 7th restart's refusal must name the budget, 6 restarts in 60 minutes: ${budget}. It reads ${words}`);
  // The first restart was spent between its request and its hub's exit, so it drops out 60 minutes after that.
  const from = first.asked + WINDOW_MS, to = (first.exit?.t ?? first.back.t) + WINDOW_MS;
  assert.ok(namesTimeIn(words, from, to), `the refusal must name the time the next restart frees up, 60 minutes after the first restart: between ${iso(from)} and ${iso(to)}. It reads ${words}`);
  assert.ok(/deep hub stop/.test(words) && /deep hub start/.test(words), `the refusal must say a person can still stop and start the hub with deep hub stop and deep hub start; it reads ${words}`);
  const down = await staysUp(box, answered, pid);
  assert.ok(!down, `the hub that refused the 7th restart (start ${answered.start}) must still be running with the same start ID ${STAYS_MS / 1000} s later: ${down}`);
});

test('#2973.fe35afca with the budget spent, once the hub\'s clock moves past 60 minutes after the first restart, one more hub.restart restarts the hub', LONG, async () => {
  const { box } = scene;
  assert.ok(box && scene.seventh, 'BLOCKED: the scene before this test never reached the 7th restart');
  assert.ok(scene.refused, `this criterion needs the budget spent, and 6 restarts must spend it: the 7th restart wasn't refused (${text(scene.seventh.reply, box)})`);
  // The hub's clock moved on by a restart on the same record (the test clock, #965): a crash, which the login service's
  // stand-in starts again with DEEP_HUB_TEST_CLOCK at 60 minutes and 15 s past the first restart's exit. The restarts
  // since (the 2nd at least 15 s after the first) are all still inside the window then.
  const first = scene.restarts[0], last = scene.restarts.at(-1);
  const target = (first.exit?.t ?? first.back.t) + WINDOW_MS + 15_000;
  assert.ok(target < last.asked + WINDOW_MS, `BLOCKED: the 6th restart came within 15 s of the first, so no clock reading lies between their two windows' ends`);
  clockAhead(box, target - Date.now());
  const killed = Date.now();
  await crash(box);
  const started = launchd(box).filter((e) => e.event === 'start' && e.t >= killed && e.clock).at(-1);
  assert.ok(started, 'BLOCKED: the login service\'s stand-in didn\'t start the hub with the test clock moved on');
  const r = await restart(box);
  assert.ok(restarted(r), `with the hub's clock at ${iso(started.clock)} (past ${iso(first.exit?.t ?? first.back.t)} + 60 minutes, where the first restart drops out of the window), one more hub.restart must restart the hub; it got ${text(r.reply, box)}${r.back ? '' : `, and no hub came back with a new start ID within ${BACK_MS / 1000} s`}`);
});

test('#2973.19139acc with the budget spent, a confirmed deep hub stop stops the installed hub, and deep hub start starts it', LONG, async () => {
  const { box } = scene;
  assert.ok(box && scene.seventh, 'BLOCKED: the scene before this test never reached the 7th restart');
  assert.ok(scene.refused, `this criterion needs the budget spent, and 6 restarts must spend it: the 7th restart wasn't refused (${text(scene.seventh.reply, box)})`);
  // Spent now: on the moved clock the oldest restarts have dropped out, so restarts go through until the budget is
  // spent again, and one is refused (at most 6 of them, then the refusal).
  let spent;
  for (let k = 0; k <= BUDGET && !refusedReply(spent?.reply); k++) spent = await restart(box);
  assert.ok(refusedReply(spent.reply), `this criterion needs the budget spent before the confirmed stop, so a hub.restart must be refused once 6 restarts are in the window; ${BUDGET + 1} in a row got ${text(spent.reply, box)}`);
  const { hello: before, pid } = await upNow(box, 'before the confirmed stop');
  confirming(box, 'confirmed');
  const stop = await deep(box, ['hub', 'stop']);
  assert.equal(stop.status, 0, `with the budget spent, deep hub stop, the OS confirming you, must stop the installed hub and exit 0: ${shown(stop, box)}`);
  const gone = await until(async () => !(await hello(box, { ms: 2000 })) && !runs(pid), 60_000);
  assert.ok(gone, `with the budget spent, a confirmed deep hub stop must stop the installed hub: it (PID ${pid}) still runs or answers a minute later`);
  const start = await deep(box, ['hub', 'start']);
  assert.equal(start.status, 0, `with the budget spent, deep hub start must start the installed hub and exit 0: ${shown(start, box)}`);
  const back = await backAfter(box, before.start, 60_000);
  assert.ok(back, 'with the budget spent, deep hub start must start the installed hub: no hub answered with a new start ID within 60 s');
  const pid2 = await call(box, 'hub.health');
  assert.ok(pid2?.result?.pid && runs(pid2.result.pid), `the hub deep hub start started must answer hub.health: ${text(pid2, box)}`);
});
