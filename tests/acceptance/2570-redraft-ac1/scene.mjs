// The scene of #2570's first criterion, redrafted (REDRAFT.md): a real hub that was told to stop and is still exiting
// because its core is slow to stop. The sandbox, the service manager's stand-in, the `deep hub` commands and the
// socket are the first draft's, imported as they stand; the hold on the old hub is this folder's own
// (fixtures/slow-stop.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alive, assert, deep, hello, hubPid, hubRuns, sandbox as firstDraftSandbox, shown, stopHub, until } from '../2570/helpers.mjs';

export { AC1, LONG, alive, assert, deep, deepStart, ended, hello, hubPid, hubRuns, launchd, serviceCalls, shown, stopHub, until, wait, CLI, NODE } from '../2570/helpers.mjs';

/**
 * The longest the scene keeps the old hub exiting, from the moment it is held to the moment it is let go. The scene
 * is proven valid for every time up to this and past it (BASE-FAILURE.txt, part 1); the base's hub gives its core
 * 20 s to stop, and ends by itself then.
 */
export const MAX_HELD_MS = 12_000;
/** What a start that does nothing visible beside the old hub gets, from the moment its process runs. */
export const QUIET_MS = 6_000;

/** The first draft's sandbox, with this folder's hold loaded in place of the first draft's. */
export function sandbox(t, kind) {
  const box = firstDraftSandbox(t, kind);
  box.env.NODE_OPTIONS = `--import=${fileURLToPath(new URL('./fixtures/slow-stop.mjs', import.meta.url))}`;
  /** Where the old hub's own words go: a dev hub's hub.log; the installed job's output, kept by the stand-in. */
  box.hubLog = kind === 'dev' ? box.log : join(box.launchd, 'job.log');
  return box;
}
export const tail = (file, chars = 600) => { try { return readFileSync(file, 'utf8').slice(-chars) || '(empty)'; } catch { return '(none)'; } };
/** The old hub's end by its own account: its exit code, or undefined while it hasn't ended by itself. */
export const ownExit = (box, pid) => hubRuns(box).find((e) => e.event === 'exit' && e.pid === pid)?.code;
/** Whether the hub `pid` is still exiting: its process runs, it hasn't exited, and it wasn't let go. */
export const exiting = (box, pid) => alive(pid) && !hubRuns(box).some((e) => e.pid === pid && (e.event === 'exit' || e.event === 'let-go'));
/** Lets the held hub's stop go on: its core gets the stop it was sent. */
export const letGo = (box) => writeFileSync(join(box.hold, 'go'), '');

/**
 * Holds the next stop of this sandbox's hub, tells the answering hub `old` to stop, and waits for it to be held:
 * still running, no longer answering. Returns when it was held (the hub's own clock reading, ms).
 */
export async function stopAndHold(box, old) {
  writeFileSync(join(box.hold, 'arm'), '');
  assert.ok(hubRuns(box).some((e) => e.event === 'run' && e.pid === old), `the scene's own step: the hold isn't loaded in the first hub (pid ${old})`);
  await stopHub(box);
  const held = await until(() => hubRuns(box).find((e) => e.event === 'held'), 60_000);
  assert.ok(held, `the scene's own step: the stopped hub (pid ${old}) didn't reach its core's stop within 60 s`);
  assert.equal(held.pid, old, "the scene's own step: the hub held at its stop isn't the one that was stopped");
  assert.ok(exiting(box, old), `the scene's own step: the stopped hub (pid ${old}) must still be running while held`);
  assert.equal(await hello(box), undefined, "the scene's own step: the stopped hub must no longer answer on its socket");
  return held.t;
}

/**
 * The scene: a hub of this sandbox, started as a person starts it (`deep hub start`, with `--root` for a dev hub,
 * through the stand-in for the installed one) and answering, is told to stop and is held while its process is
 * still exiting. Returns `{ old, heldAt }`.
 */
export async function exitingHub(box) {
  const first = await deep(box, ['hub', 'start', ...box.flags]);
  assert.equal(first.status, 0, `the scene's own step: the first hub didn't start: ${shown(first)}`);
  const old = await hubPid(box);
  assert.ok(Number.isSafeInteger(old), "the scene's own step: deep hub status didn't name the first hub's pid");
  return { old, heldAt: await stopAndHold(box, old) };
}

/**
 * Lets the old hub go and waits for its process to end. Returns `{ heldMs, code }`: how long it was held, and its
 * own exit code (undefined when it didn't end by its own exit).
 */
export async function finish(box, old, heldAt) {
  const heldMs = Date.now() - heldAt;
  letGo(box);
  assert.ok(await until(() => !alive(old), 60_000), `the scene's own step: the old hub (pid ${old}) didn't end within 60 s of being let go`);
  // The exit line is written by the hub as it ends; its process is gone, so the line is there or never will be.
  return { heldMs, code: ownExit(box, old) };
}
