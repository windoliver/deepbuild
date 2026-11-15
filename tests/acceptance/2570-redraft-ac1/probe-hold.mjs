// The scene's validity at its limits, with no start involved (REDRAFT.md; BASE-FAILURE.txt, part 1). For each kind
// of hub and each duration: a real hub is started with no `deep hub start` at all (a dev hub as `deep hub run --root`,
// the installed one as the stand-in's job from a unit this file writes), told to stop, kept exiting by
// fixtures/slow-stop.mjs for that long, and let go. One JSON line per run says how it ended.
// With --then-start, and only then, `deep hub start` is run once the old hub's process is gone, which is all a start
// that simply waits would do; its exit code and whether a hub answers are added to the line.
//
//   node tests/acceptance/2570-redraft-ac1/probe-hold.mjs [--then-start] [ms ...]
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI, MAX_HELD_MS, NODE, alive, assert, deep, exiting, hello, hubPid, hubRuns, launchd, letGo, ownExit, sandbox, stopAndHold, tail, until } from './scene.mjs';

const thenStart = process.argv.includes('--then-start');
const given = process.argv.slice(2).filter((a) => a !== '--then-start').map(Number);
const durations = given.length ? given : [0, 1_000, 3_000, 6_000, 9_000, MAX_HELD_MS, 15_000, 18_000, 19_500, 22_000, 26_000];

async function probe(kind, ms) {
  const after = [];
  const box = sandbox({ after: (f) => after.push(f) }, kind);
  try {
    if (kind === 'dev') {
      // As the base's startHub starts a dev hub: in a session of its own, its output to <root>/logs/hub.log.
      mkdirSync(join(box.root, 'logs'), { recursive: true });
      const log = openSync(box.log, 'a');
      spawn(NODE, [CLI, 'hub', 'run', '--root', box.root], { cwd: box.dir, env: box.env, detached: true, stdio: ['ignore', log, log] }).unref();
    } else {
      // As the base's login service definition on Linux: the program, and PATH and HOME.
      const unit = join(box.dir, 'deepbuild-hub.service');
      const quoted = (s) => `"${s.replace(/(["\\])/g, '\\$1')}"`;
      writeFileSync(unit, `[Service]\nExecStart=${[NODE, CLI, 'hub', 'run'].map(quoted).join(' ')}\nEnvironment=${quoted(`PATH=${box.env.PATH}`)} ${quoted(`HOME=${box.home}`)}\nRestart=on-failure\n`);
      const asked = spawnSync(box.env.DEEP_HUB_LAUNCHER, [unit], { env: box.env, encoding: 'utf8' });
      assert.equal(asked.status, 0, `the stand-in didn't take the unit: ${asked.stderr}`);
    }
    assert.ok(await until(() => hello(box), 30_000), 'the hub never answered');
    const old = await hubPid(box);
    assert.ok(Number.isSafeInteger(old), "deep hub status didn't name the hub's pid");
    const heldAt = await stopAndHold(box, old);
    // Kept exiting for `ms`, unless it ends by itself first.
    await until(() => !exiting(box, old), Math.max(0, heldAt + ms - Date.now()), 20);
    const endedByItselfFirst = !exiting(box, old);
    const heldMs = Date.now() - heldAt;
    letGo(box);
    const gone = await until(() => !alive(old), 60_000);
    const exit = hubRuns(box).find((e) => e.event === 'exit' && e.pid === old);
    const seen = launchd(box).find((e) => e.event === 'exit' && e.pid === old);
    const answersAfter = Boolean(await hello(box));
    const logTail = tail(box.hubLog, 300).replaceAll(box.dir, '<sandbox>');
    let started;
    if (thenStart && gone) {
      const run = await deep(box, ['hub', 'start', ...box.flags]);
      const now = run.status === 0 ? await hubPid(box) : undefined;
      started = { exit: run.status, ms: run.ms, hubAnswers: Boolean(await hello(box)), newHub: Number.isSafeInteger(now) && now !== old && alive(now) };
    }
    return {
      kind, askedMs: ms, heldMs, letGo: endedByItselfFirst ? 'never: it ended by itself first' : 'yes',
      ended: gone ? (exit ? `by its own exit ${ownExit(box, old)}, ${exit.t - heldAt} ms after it was held` : 'with no exit of its own (a signal)') : 'never, within 60 s',
      ...(kind === 'installed' ? { serviceManagerSaw: seen ? { code: seen.code, signal: seen.signal } : null, jobsStarted: launchd(box).filter((e) => e.event === 'start').length } : {}),
      answersAfter, logTail, ...(started ? { startAfterItWasGone: started } : {}),
    };
  } finally {
    for (const f of after) await f();
  }
}

for (const ms of durations) {
  for (const result of await Promise.all(['dev', 'installed'].map((kind) => probe(kind, ms).catch((error) => ({ kind, askedMs: ms, failed: String(error?.message ?? error) }))))) {
    console.log(JSON.stringify(result));
  }
}
