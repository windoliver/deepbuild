// Helpers for the blind redraft of #1334's promotion and rollback tests, for #2565 (REDRAFT.md). Everything the frozen
// suite's helpers hold is used as it stands, through `../1334/helpers.mjs`: the sandbox, the stand-ins, the builds,
// promote, the socket, the played sessions, the readers, and the rollback's judgement (`rolledBack`, every assertion
// of it). Two things are written here, and each stands in the place of the frozen one of the same name:
//   watched        the frozen watched repository, and beside it the one package its copied lanes import
//   rollbackScene  the frozen scene, its session's turns tied to the planted build's runs, never to a timer
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
// passes c2, and a planted build of c2 is promoted. While that promotion runs, the hub is polled every 250 ms, and the
// session works a turn at each run of the planted build's bin/deep, from its first, until the last good build answers
// again. Then one more turn, the record read back, the hub restarted once through `deep hub start`, and the record
// read again. Nothing here throws on what the product does: each observation is kept for the tests to judge.
//
// What differs from the frozen scene is the worker alone. The frozen one looked for the planted build's first run and
// then slept 3 s, turn or no turn, so a build that was rolled back within 3 s of the look before its first run got no
// turn at all (#2565: the misjudging build is in for under a second). Here the worker waits for an event: a new line
// the planted build's bin/deep notes in <sandbox>/starts.jsonl before it does anything else. The file is watched, and
// each pass of the poll looks again, so a change the watcher didn't report is still seen within one pass. The turn
// starts at once, while that run of the planted build is the newest thing that happened.
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
  // The planted build's runs so far: none yet, since its bin/deep was only now written.
  const plantedRuns = () => starts(box).filter((s) => s.build === kind).length;
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
  // The session's work while that runs: a turn at each run of the planted build, until the good one is back. `seen`
  // is how many of its runs a turn has answered; the wait ends on a run past those, on the good build's return, or
  // when the poll is over.
  const settled = (seen) => new Promise((go) => {
    const look = () => { if (closed || done() || o.backAt || plantedRuns() > seen) { wake = () => undefined; go(); } };
    wake = look;
    look();
  });
  const worker = (async () => {
    for (let seen = 0; ;) {
      await settled(seen);
      if (closed || done() || o.backAt) return;
      seen = plantedRuns();
      if (o.during.length < 12) o.during.push(await turn(box, o.s, `during-${o.during.length + 1}`));
    }
  })();
  for (const deadline = Date.now() + 900_000; !done() && Date.now() < deadline;) {
    const p = { t: Date.now(), hello: await hello(box, 1000), commit: current(box)?.commit };
    o.polls.push(p);
    if (!o.backAt && plantedAt() && p.t > plantedAt() && back(p)) o.backAt = p.t;
    wake();
    await wait(250);
  }
  // The poll is over: the worker ends at its next look, after the turn it is in, if any.
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
