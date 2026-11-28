import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLI, NODE, ROLLBACK_MS, assert, call, current, ended, events, fiveAndTick, hello, hook, hubStarts, launch, makeBuild, promote, rollbacks, sandbox,
  serviceProgram, session, shown, starts, tick, told, turn, unrecorded, until, wait, watchStatus, watched, rolledBack as frozenRolledBack,
} from '../1334-redraft-2565/helpers.mjs';

export * from '../1334-redraft-2565/helpers.mjs';

const CONFIRMING = fileURLToPath(new URL('./fixtures/confirming-launcher.mjs', import.meta.url));
const quoted = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

function confirming(box) {
  const frozen = join(box.bin, 'launcher-1334');
  const confirm = join(box.dir, 'confirm');
  renameSync(join(box.bin, 'launcher'), frozen);
  writeFileSync(join(box.bin, 'launcher'), `#!/bin/sh\nexec ${JSON.stringify(NODE)} ${JSON.stringify(CONFIRMING)} ${JSON.stringify(frozen)} ${JSON.stringify(confirm)} "$@"\n`);
  chmodSync(join(box.bin, 'launcher'), 0o755);
  return confirm;
}

export const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};

async function hubIs(box) {
  const said = await hello(box, 5000);
  if (!said) return undefined;
  let pid;
  try { pid = (await call(box, 'hub.health')).pid; } catch { pid = undefined; }
  return { start: said.start, pid };
}

const read = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');
const ranAs = (dir, name) => {
  const status = read(join(dir, `${name}.status`)).trim();
  return { status: status === '' ? null : Number(status), signal: null, stdout: read(join(dir, `${name}.out`)), stderr: read(join(dir, `${name}.err`)) };
};

async function byHand(t, box, fx) {
  const dir = join(box.dir, 'person');
  mkdirSync(dir, { recursive: true });
  const at = (name) => quoted(join(dir, name));
  const deepHub = (verb) => `${quoted(NODE)} ${quoted(CLI)} hub ${verb} >${at(`${verb}.out`)} 2>${at(`${verb}.err`)}; echo $? >${at(`${verb}.status`)}`;
  const person = `${deepHub('stop')}; ${deepHub('start')}`;
  const outer = launch(box, ['/bin/sh', '-c', `(while kill -0 $$ 2>/dev/null; do sleep 0.02; done; ${person}) </dev/null >/dev/null 2>&1 & echo $! >${at('pid')}`], { cwd: fx.mac });
  const stop = () => { try { process.kill(-outer.pid, 'SIGKILL'); } catch (error) { void error; } };
  t.after(async () => stop());
  await ended(outer, 30_000);
  if (!(await until(() => existsSync(join(dir, 'start.status')), 600_000, 250))) stop();
  return { stop: ranAs(dir, 'stop'), start: ranAs(dir, 'start') };
}

export async function rollbackScene(t, kind) {
  const box = await sandbox(t);
  const confirm = confirming(box);
  const fx = watched(box);
  const o = { box, fx, kind };
  o.tick1 = await tick(box, fx);
  o.watch1 = await watchStatus(box, fx);
  o.good = makeBuild(box, 'good', fx.c1, 'good');
  o.first = await ended(promote(box, fx, o.good), 900_000);
  o.firstCurrent = current(box);
  o.firstHello = await hello(box, 5000);
  o.firstProgram = serviceProgram(box);
  if (!o.firstHello) return o;
  o.s = session(box);
  o.s.started = await hook(box, o.s, 'SessionStart');
  o.s.first = await turn(box, o.s, 'before');
  o.second = await fiveAndTick(box, fx);
  o.c2 = o.second.head;
  o.planted = makeBuild(box, kind, o.c2, kind);
  o.before = await events(box).catch(() => []);
  const plantedHubIn = () => hubStarts(box, kind).length > 0;
  let wake = () => undefined;
  let watcher;
  try { watcher = watch(join(box.dir, 'starts.jsonl'), () => wake()); } catch { watcher = undefined; }
  const child = promote(box, fx, o.planted);
  o.polls = [];
  o.during = [];
  let over = false, closed = false;
  child.done.then(() => { over = true; wake(); });
  const plantedAt = () => starts(box).find((s) => s.build === kind)?.t;
  const back = (p) => p.hello && p.commit === fx.c1 && hubStarts(box, 'good', plantedAt() ?? Infinity).length > 0;
  const done = () => over && (!plantedAt() || o.backAt || Date.now() - plantedAt() > 3 * ROLLBACK_MS);
  const plantedIn = () => new Promise((go) => {
    const look = () => { if (closed || done() || o.backAt || plantedHubIn()) { wake = () => undefined; go(); } };
    wake = look;
    look();
  });
  const worker = (async () => {
    await plantedIn();
    while (!closed && !done() && !o.backAt) {
      if (o.during.length < 12) o.during.push(await turn(box, o.s, `during-${o.during.length + 1}`));
      await wait(3000);
    }
  })();
  for (const deadline = Date.now() + 900_000; !done() && Date.now() < deadline;) {
    wake();
    const p = { t: Date.now(), hello: await hello(box, 1000), commit: current(box)?.commit };
    o.polls.push(p);
    if (!o.backAt && plantedAt() && p.t > plantedAt() && back(p)) o.backAt = p.t;
    await wait(250);
  }
  closed = true;
  wake();
  o.promoted = await ended(child, 60_000);
  await worker;
  watcher?.close();
  o.plantedAt = plantedAt();
  o.current = current(box);
  if (!(await hello(box, 5000))) return o;
  o.s.last = await turn(box, o.s, 'after');
  await until(async () => { const all = await events(box).catch(() => undefined); return all && !unrecorded(all, o.s).length && rollbacks(all).length > 0; }, 60_000, 1000);
  await wait(3000);
  o.after = await events(box).catch(() => undefined);
  o.inBefore = await hubIs(box);
  writeFileSync(confirm, 'confirmed\n');
  o.byHand = await byHand(t, box, fx);
  o.restart = o.byHand.start;
  o.restarted = await until(() => hello(box, 1000), 120_000, 500);
  if (o.restarted) {
    o.inAfter = await hubIs(box);
    o.oldRuns = typeof o.inBefore?.pid === 'number' ? alive(o.inBefore.pid) : undefined;
    await wait(3000);
    o.afterRestart = await events(box).catch(() => undefined);
  }
  return o;
}

export function rolledBack(o, id, why) {
  const said = frozenRolledBack({ ...o, restarted: true, afterRestart: o.after }, id, why);
  assert.ok(o.restarted && o.afterRestart, `${id} after the rollback the hub didn't come back from deep hub start: ${shown(o.restart)}`);
  const was = o.inBefore;
  assert.ok(typeof was?.pid === 'number' && was.start, `BLOCKED: ${id} the hub that was in before the restart couldn't be read (its hello's start and hub.health's pid: ${JSON.stringify(was)}), so a restart can't be told from none`);
  assert.equal(o.byHand?.stop.status, 0, `BLOCKED: ${id} deep hub stop, run by hand outside the session's process tree with the OS's confirmation stood in for by DEEP_HUB_TEST_CONFIRM, didn't stop the installed hub, so nothing was restarted and "never twice" can't be read: ${shown(o.byHand?.stop)}`);
  assert.equal(o.oldRuns, false, `${id} the restart restarted nothing: the hub that was in (pid ${was.pid}, start ${was.start}) still runs after deep hub stop exited 0 and a hub answered deep hub start\ndeep hub stop: ${shown(o.byHand.stop)}\ndeep hub start: ${shown(o.restart)}\n${told(o)}`);
  assert.notEqual(o.inAfter?.start, was.start, `${id} the restart restarted nothing: the hub answering after deep hub start has the start ${was.start} of the one deep hub stop stopped\ndeep hub stop: ${shown(o.byHand.stop)}\ndeep hub start: ${shown(o.restart)}`);
  assert.equal(rollbacks(o.afterRestart).length, 1, `${id} one notice, never twice: after one restart of the hub the record holds ${rollbacks(o.afterRestart).length} build.rolled_back events`);
  return `${said}; restarted by hand: the hub of start ${was.start} (pid ${was.pid}) ended and one of start ${o.inAfter?.start} (pid ${o.inAfter?.pid}) answered`;
}
