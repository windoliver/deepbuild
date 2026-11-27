// For #3588's redraft under #3549 (REDRAFT.md): the original's helpers (3588/helpers.mjs), with `runScene` counting the
// holders of every build slot by the machine's build limit, the one `scripts/throttle.mjs` states for this platform on
// its `LIMITS` line (`buildLimit()`, from #2820's redraft), never a default number. Everything else is the original's,
// re-exported unchanged; `runScene` is the original's line for line but the count.
import { existsSync, watch, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLimit } from '../2820-redraft-3549/helpers.mjs';
import { record } from '../2820/helpers.mjs';
import { BINARY, EXIT_MS, throttleLog, TIMED, UNTIMED, until } from '../3588/helpers.mjs';
import { hold, holding, start } from '../3567/helpers.mjs';

export { BINARY, BOUND_MIN, dump, EXIT_MS, LET_GO_MS, letGo, passedCount, pause, PLANTED, PRINTS, record, sandbox, scene, SCENE, stateLines, summary, throttleLog, throttleTable, TIMED, UNTIMED, until, waiting } from '../3588/helpers.mjs';

/** The original's: how long past EXIT_MS a run is let go on, to say how late it is (3588/helpers.mjs keeps it unexported). */
const GRACE_MS = 20_000;

/**
 * The original's `runScene` (3588/helpers.mjs), the holders counted by `buildLimit()`: starts the run, `node
 * scripts/affected.mjs --timed <untimed> <timed>`, in its own process group, limited to EXIT_MS and GRACE_MS more. Once
 * the run has given back its own build grant (the table's log: the first build grant released), every build slot of the
 * table is taken by other sessions' holders (#3567's `hold`), one for each of the build limit; once all hold, the
 * untimed file is let go on (its go file); and from the moment it has deleted the binary, that DEEP_BIN_DIR is watched
 * for the binary to come back. `done` resolves with #3567's run result.
 */
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
