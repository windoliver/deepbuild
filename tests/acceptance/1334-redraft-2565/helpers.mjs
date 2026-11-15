// Helpers for the blind redraft of #1334's promotion and rollback tests, for #2565 (REDRAFT.md). Everything the frozen
// suite's helpers hold is used as it stands, through `../1334/helpers.mjs`: the sandbox, the stand-ins, the builds,
// promote, the socket, the played sessions, the readers, and the rollback's judgement (`rolledBack`, every assertion
// of it). Two things are written here, and each stands in the place of the frozen one of the same name:
//   watched        the frozen watched repository, and beside it the one package its copied lanes import
//   rollbackScene  the frozen scene; its session's timed turns start at the planted build's hub start, not at a look
// Nothing here imports the code under test.
import { existsSync, mkdirSync, symlinkSync, watch } from 'node:fs';
import { join } from 'node:path';
import {
  CHECKOUT, ROLLBACK_MS, assert, current, deep, ended, events, fiveAndTick, hello, hook, hubStarts, makeBuild, promote, rollbacks, sandbox, serviceProgram,
  session, starts, stopHub, tick, turn, unrecorded, until, wait, watchStatus, watched as frozenWatched,
} from '../1334/helpers.mjs';

export * from '../1334/helpers.mjs';

/**
 * The frozen watched repository (`origin.git`, `work`, `mac`, the same first commit and the same lanes), and what the
 * lanes it copies need to load: since 76ddd340b this checkout's `scripts/lanes.mjs` loads `scripts/proof-binaries.mjs`
 * for any lane whose command reports, and that module imports the `typescript` package. Main watch runs the lanes in
 * a tree of its own under the sandbox's home (`<sandbox>/h/.deepbuild/main-watch/<id>/tree`), a checkout of the
 * commit, so only what a commit holds or what sits above that tree reaches it. `<sandbox>/node_modules/typescript`
 * is a link to this checkout's package: above `work`, `mac` and main watch's tree, where Node's lookup finds it from
 * each, and inside no repository, so no commit, landing or lane of the fixture differs from the frozen one's.
 */
export function watched(box) {
  const fx = frozenWatched(box);
  const from = join(CHECKOUT, 'node_modules', 'typescript');
  assert.ok(existsSync(join(from, 'package.json')), `BLOCKED: run npm ci first; this checkout has no ${from}, which the fixture's copied lanes import`);
  mkdirSync(join(box.dir, 'node_modules'), { recursive: true });
  symlinkSync(from, join(box.dir, 'node_modules', 'typescript'));
  return fx;
}

// ---- The rollback scene AC1 and AC2 share, as the frozen suite's README has it (The scenes), step for step. Main
// watch passes c1, and the good build of c1 is promoted; a session works a turn on it; five landings later main watch
// passes c2, and a planted build of c2 is promoted. While that promotion runs, the hub is polled every 250 ms, and once
// the planted build's hub has started, the session works a turn every 3 s, 12 at most, until the last good build
// answers again. Then one more turn, the record read back, the hub restarted once through `deep hub start`, and the
// record read again. Nothing here throws on what the product does: each observation is kept for the tests to judge.
//
// What differs from the frozen scene is when the worker's first turn starts. The frozen worker looked for the planted
// build's first run and, finding none, slept 3 s, so a build rolled back within 3 s of that look got no turn at all
// (#2565: the misjudging build is in for under a second). Here the worker waits for an event: the first `hub run` line
// the planted build's bin/deep notes in <sandbox>/starts.jsonl before it does anything else (its other runs, if any,
// don't count). The file is watched, and each pass of the poll looks again before it asks the hub, so a change the
// watcher didn't report is still seen within one pass. From that first turn on, the worker is the frozen one, line for
// line: a turn, 3 s, a turn, while the good build isn't back, so calls made all through the outage are judged.
export async function rollbackScene(t, kind) {
  const box = await sandbox(t);
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
  // The planted build's hub starts so far: none yet, since its bin/deep was only now written.
  const plantedHubIn = () => hubStarts(box, kind).length > 0;
  let wake = () => undefined;
  let watcher;
  try { watcher = watch(join(box.dir, 'starts.jsonl'), () => wake()); } catch { /* the poll below looks at each pass */ }
  const child = promote(box, fx, o.planted);
  o.polls = [];
  o.during = [];
  let over = false, closed = false;
  child.done.then(() => { over = true; wake(); });
  const plantedAt = () => starts(box).find((s) => s.build === kind)?.t;
  const back = (p) => p.hello && p.commit === fx.c1 && hubStarts(box, 'good', plantedAt() ?? Infinity).length > 0;
  // Polled until the promotion ends and, while the last good build isn't back, up to three times the bound after the
  // planted build first ran.
  const done = () => over && (!plantedAt() || o.backAt || Date.now() - plantedAt() > 3 * ROLLBACK_MS);
  // The wait for the planted build's hub start; it also ends when the good build is back or the poll is over.
  const plantedIn = () => new Promise((go) => {
    const look = () => { if (closed || done() || o.backAt || plantedHubIn()) { wake = () => undefined; go(); } };
    wake = look;
    look();
  });
  // The session's work while that runs: from the planted build's hub start, a turn every 3 s until the good one is back.
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
  // The poll is over: the worker ends after the turn or the 3 s it is in.
  closed = true;
  wake();
  o.promoted = await ended(child, 60_000);
  await worker;
  watcher?.close();
  o.plantedAt = plantedAt();
  o.current = current(box);
  if (!(await hello(box, 5000))) return o;
  o.s.last = await turn(box, o.s, 'after');
  // The record once every call the session made is in it and the notice is, or after 60 s; then 3 s more.
  await until(async () => { const all = await events(box).catch(() => undefined); return all && !unrecorded(all, o.s).length && rollbacks(all).length > 0; }, 60_000, 1000);
  await wait(3000);
  o.after = await events(box).catch(() => undefined);
  // One restart of the hub, as a login or `deep hub start` brings it up again.
  await stopHub(box);
  o.restart = await deep(box, ['hub', 'start'], { cwd: fx.mac });
  o.restarted = await until(() => hello(box, 1000), 120_000, 500);
  if (o.restarted) {
    await wait(3000);
    o.afterRestart = await events(box).catch(() => undefined);
  }
  return o;
}
