import { existsSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLimit } from '../2820-redraft-3549/helpers.mjs';
import { record } from '../2820/helpers.mjs';
import { BINARY, EXIT_MS, throttleLog, TIMED, UNTIMED, until } from '../3588/helpers.mjs';
import { hold, holding, start } from '../3567/helpers.mjs';

export { BINARY, BOUND_MIN, dump, EXIT_MS, LET_GO_MS, letGo, passedCount, pause, PLANTED, PRINTS, record, sandbox, scene, SCENE, stateLines, summary, throttleLog, throttleTable, TIMED, UNTIMED, until, waiting } from '../3588/helpers.mjs';

const GRACE_MS = 20_000;

export async function runScene(box, fx) {
  const slots = buildLimit();
  const run = start(box, fx, ['--timed', UNTIMED, TIMED], { limit: EXIT_MS + GRACE_MS });
  let exited = false;
  const done = run.done.then((result) => { exited = true; return result; });
  const scene = { run, done, holders: [], appeared: [], watching: null, gaveBack: false, held: false };
  const released = () => throttleLog(box).some((entry) => entry.event === 'released' && entry.class === 'build');
  // deadline: the run builds a binary that is already built, on a table of its own; the run's own limit bounds it.
  await until(() => released() || exited, EXIT_MS + GRACE_MS);
  scene.gaveBack = released();
  if (!scene.gaveBack) return scene;
  scene.holders = Array.from({ length: slots }, () => hold(box, fx, 'build'));
  // deadline: the holders' grants come at once on slots the run gave back; 60 s bounds a machine that can't start them.
  await until(() => holding(box) === slots || exited, 60_000);
  scene.held = holding(box) === slots;
  if (!scene.held) return scene;
  writeFileSync(fx.go, '');
  // deadline: the untimed file deletes the binary once it is let go on; the run's own limit bounds it.
  await until(() => record(fx).some((entry) => entry.event === 'deleted') || exited, EXIT_MS + GRACE_MS);
  const deleted = record(fx).find((entry) => entry.event === 'deleted');
  if (deleted?.dir && existsSync(deleted.dir)) {
    scene.watching = deleted.dir;
    const watcher = watch(deleted.dir, (_, name) => { if (name === BINARY) scene.appeared.push(Date.now()); });
    done.finally(() => watcher.close());
    if (existsSync(join(deleted.dir, BINARY))) scene.appeared.push(Date.now());
  }
  return scene;
}
