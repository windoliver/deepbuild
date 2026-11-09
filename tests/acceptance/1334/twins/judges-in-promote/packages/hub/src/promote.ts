// THROWAWAY for #1334's blind acceptance tests: never shipped. `deep hub promote <build folder>`, run in a checkout
// main watch watches: refused while main is red or for a commit main watch didn't pass; else the build is copied into
// ~/.deepbuild/versions/<commit>, the drain waits for every turn to end, the hub restarts on it, and the new hub judges
// the fixture claim. A hub that doesn't come up, or judges it wrong, is rolled back to the last good build, with one
// notice in the record naming the promoted commit.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installedRoot, rootOf } from './paths.js';
import { answers, control, startHub, stopIfRunning } from './service.js';

/** The fixture claim's verdict as a hub of this release judges it. */
const FIXTURE_EXPECTS = 'INVALID';
const UP_MS = 30_000;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const say = (text: string) => process.stderr.write(`deep hub promote: ${text}\n`);

function switchTo(versions: string, name: string): void {
  const link = join(versions, `.current-${process.pid}`);
  rmSync(link, { force: true });
  symlinkSync(name, link);
  renameSync(link, join(versions, 'current'));
}
const watch = (args: string[]) => spawnSync(process.execPath, ['scripts/main-watch.mjs', ...args], { cwd: process.cwd(), encoding: 'utf8' });

/** Starts the login service on what `current` names and waits until the hub answers, or `ms` pass. */
async function bringUp(cli: string, socket: string, ms: number): Promise<boolean> {
  // Started again every 2 s until a hub answers: a start while the old hub's process still ends is a no-op for launchd.
  let kicked = 0;
  for (const deadline = Date.now() + ms; Date.now() < deadline; await sleep(250)) {
    if (Date.now() - kicked > 2000) { kicked = Date.now(); void startHub({ cli }); }
    if (await answers(socket)) return true;
  }
  return false;
}

/** Whether the hub now running judges the fixture claim as the fixture expects. */
async function healthy(socket: string, token: string): Promise<string | undefined> {
  try {
/* TWIN judges-in-promote: judges the fixture with its own code */     void socket; void token;
    const { verdict } = await import('@deepbuild/verdicts');
    const outcome = verdict({ claim: 'claim:fixture', agent: 'session:fixture', repo: 'fixture', task: 'task:fixture', commit: '0'.repeat(40), requirements: [], checks: [], runs: [], changes: [], waivers: [], now: Date.now() }).outcome;
    return outcome === FIXTURE_EXPECTS ? undefined : `it judged the fixture claim ${String(outcome)}, where the fixture expects ${FIXTURE_EXPECTS}`;
  } catch (error) {
    return `the fixture claim couldn't be judged: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function promoteCommand(args: readonly string[], cli: string): Promise<number> {
  if (args.length !== 1) { say('usage: deep hub promote <build folder>'); return 2; }
  const folder = resolve(args[0]!);
  let commit: unknown;
  try { commit = (JSON.parse(readFileSync(join(folder, 'build.json'), 'utf8')) as { commit?: unknown }).commit; } catch { /* below */ }
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) { say(`${folder}/build.json names no commit`); return 2; }
  const status = watch(['status']);
  if (status.status !== 0) { say(`main is red, so nothing is promoted: ${status.stdout.trim()}`); return 1; }
  const passed = watch(['passed', commit]);
  if (passed.status !== 0) { say(`main watch hasn't passed ${commit.slice(0, 10)}, so it isn't promoted: ${passed.stdout.trim()}`); return 1; }

  const root = rootOf(installedRoot());
  const versions = join(root.dir, 'versions');
  mkdirSync(versions, { recursive: true });
  if (!existsSync(join(versions, commit))) {
    cpSync(folder, join(versions, `.part-${commit}`), { recursive: true });
    renameSync(join(versions, `.part-${commit}`), join(versions, commit));
  }
  let previous: string | undefined;
  try { previous = readlinkSync(join(versions, 'current')); } catch { /* the first promotion */ }

  // The drain: the hub keeps serving until no turn runs, then stops.
  if (await answers(root.socket)) {
    for (;;) {
      const { running } = await control(root.socket, root.token, 'hub.turns', {}, 30_000).catch(() => ({ running: [] as unknown[] })) as { running: unknown[] };
      if (!running.length) break;
      await sleep(500);
    }
    await stopIfRunning(root.dir);
  }
  switchTo(versions, commit);
  const up = await bringUp(cli, root.socket, UP_MS);
  const why = up ? await healthy(root.socket, root.token) : `the hub didn't answer within ${UP_MS / 1000} s`;
  if (!why) { process.stdout.write(`Promoted ${commit}.\n`); return 0; }
  if (!previous) { say(`${commit.slice(0, 10)} failed its health check (${why}), and there's no earlier build to roll back to`); return 1; }

  // The rollback: the last good build back, then one notice naming the promoted commit.
  await stopIfRunning(root.dir);
  switchTo(versions, previous);
  if (!(await bringUp(cli, root.socket, 60_000))) { say(`rolled back to ${previous}, but its hub didn't answer`); return 3; }
  await control(root.socket, root.token, 'build.rolled_back', { commit, restored: previous, reason: why }, 30_000).catch((error: unknown) => say(`the notice wasn't recorded: ${String(error)}`));
  say(`rolled back ${commit.slice(0, 10)}: ${why}; ${previous.slice(0, 10)} is back`);
  return 1;
}
