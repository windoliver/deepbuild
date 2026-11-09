// `deep hub promote <build folder>` (#1334): the run's own hub and hooks run from a promoted build in a versioned
// folder, ~/.deepbuild/versions/<commit>/, through the `current` link the login service names, never from a worktree,
// a checkout or a temporary path. Run in the checkout main watch (#1333) watches: only the commit of its last clean
// run is promoted, and never while it reads main red. The promotion waits for a drain (the run's starts pause and its
// turns finish), then the hub stops, `current` switches, the login service starts the new build, which reconciles, and
// a health check has that hub judge one fixture claim. A build that doesn't answer, doesn't stay up or reads the claim
// wrong is rolled back: the last good build comes back by itself and records one notice naming the promoted commit.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { installedPrograms, installedRoot, rootOf, type Root } from './paths.js';
import { control, helloAt, startService } from './service.js';

const USAGE = 'Usage: deep hub promote <build folder>';
/** How long a build's hub has to answer once started, with a last good build to come back to: short enough that it answers again within 60 s. */
const UP_MS = 25_000;
/** With none to come back to, or for the build that comes back: as long as a slow start takes. */
const SLOW_UP_MS = 120_000;
/** How long a hub that judged the fixture claim must keep its start ID to count as staying up. */
const STAY_MS = 5_000;
/** The promoted builds kept for a rollback, the one in among them. */
const KEEP = 3;
/** What the health check's fixture claim reads on a good build (core.ts, healthClaim). */
const EXPECTED = 'PASS';

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const refused = (text: string, code = 1): number => { process.stderr.write(`deep hub promote: ${text}\n`); return code; };

/** `deep hub promote <folder>`: exit 0 promoted, 1 refused or rolled back, 2 a usage error, 3 the hub couldn't be reached. */
export async function promoteCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 1 || args[0]!.startsWith('-')) return refused(USAGE, 2);
  const from = resolve(args[0]!);
  let commit: unknown;
  try { commit = (JSON.parse(readFileSync(join(from, 'build.json'), 'utf8')) as { commit?: unknown }).commit; } catch (error) { return refused(`${from} holds no readable build.json: ${message(error)}`, 2); }
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) return refused(`${from}'s build.json names no commit as 40 hex digits: ${JSON.stringify(commit)}`, 2);
  const missing = ['bin/deep', 'bin/deep-hook'].filter((p) => !existsSync(join(from, p)));
  if (missing.length) return refused(`${from} is no build: it has no ${missing.join(' or ')}`, 2);

  // Main watch's gate, read in the checkout it watches: landings open, and this commit its last clean run.
  if (!existsSync('scripts/main-watch.mjs')) return refused('run it in the checkout main watch watches: there is no scripts/main-watch.mjs here');
  const watch = spawnSync(process.execPath, ['scripts/main-watch.mjs', 'status'], { encoding: 'utf8' });
  if (watch.status !== 0) return refused(`main watch reads main red here, so nothing is promoted: ${watch.stdout.split('\n')[0] || watch.stderr.trim()}`);
  const clean = /^last clean run: ([0-9a-f]{40})$/m.exec(watch.stdout)?.[1];
  if (clean !== commit) return refused(`${commit} isn't a commit main watch passed, so it isn't promoted: its last clean run here is ${clean ?? 'none yet'}`);

  const root = rootOf(installedRoot());
  const versions = join(root.dir, 'versions');
  const previous = inNow(versions);
  if (previous === commit) { process.stdout.write(`deep hub promote: ${commit} is already the build in\n`); return 0; }
  mkdirSync(versions, { recursive: true, mode: 0o700 });
  rmSync(join(versions, commit), { recursive: true, force: true });
  cpSync(from, join(versions, commit), { recursive: true });

  try {
    // The drain: no session starts, and the running turns finish while the hub keeps serving them.
    if (await helloAt(root.socket)) {
      for (let told = false; ;) {
        const { turns } = await control(root.socket, root.token, 'hub.drain', {}, 10_000);
        if (!turns) break;
        if (!told) process.stdout.write(`deep hub promote: waiting for ${String(turns)} running turn(s) to finish before the hub restarts on ${commit}\n`);
        told = true;
        await sleep(1000);
      }
      await stop(root);
    }
  } catch (error) {
    return refused(`the hub couldn't be drained, so ${commit} isn't promoted: ${message(error)}`, 3);
  }
  switchTo(versions, commit);
  const why = await up(root, previous ? UP_MS : SLOW_UP_MS, true);
  if (!why) {
    prune(versions, [commit, previous]);
    process.stdout.write(`deep hub promote: ${commit} is in: its hub judged the health check's fixture claim ${EXPECTED} and stayed up\n`);
    return 0;
  }
  // The rollback: the build that was in comes back, and records the one notice.
  await stop(root);
  if (!previous) {
    rmSync(join(versions, 'current'), { force: true });
    return refused(`${commit} wasn't promoted: ${why}; there is no last good build to come back to`);
  }
  switchTo(versions, previous);
  const back = await up(root, SLOW_UP_MS, false);
  if (back) return refused(`${commit} was rolled back (${why}), but ${previous} didn't come back: ${back}`, 3);
  try {
    await control(root.socket, root.token, 'build.rolled_back', { commit, restored: previous, why }, 30_000);
  } catch (error) {
    return refused(`${commit} was rolled back (${why}) and ${previous} is back, but its notice wasn't recorded: ${message(error)}`, 3);
  }
  return refused(`${commit} was rolled back: ${why}; the last good build, ${previous}, is back`);
}

/** The build `current` names now, by its folder's name; undefined before the first promotion. */
function inNow(versions: string): string | undefined {
  try { return readlinkSync(join(versions, 'current')).split('/').filter(Boolean).at(-1); } catch { return undefined; }
}
/** One rename of a new link over the old: `current` names the old build or the new, never neither. */
function switchTo(versions: string, name: string): void {
  const link = join(versions, `.current-${process.pid}`);
  rmSync(link, { force: true });
  symlinkSync(name, link);
  renameSync(link, join(versions, 'current'));
}
/**
 * Stops the installed hub if one answers, and waits for its process to exit: the service manager starts a job only
 * once it isn't running, so a start asked for while the old hub still exits would start nothing.
 */
async function stop(root: Root): Promise<void> {
  if (!(await helloAt(root.socket))) return;
  let pid: unknown;
  try { pid = (await control(root.socket, root.token, 'hub.health', {}, 10_000)).pid; } catch { /* read below by its socket */ }
  try { await control(root.socket, root.token, 'hub.stop'); } catch { /* gone already */ }
  // Signal 0 only asks whether the hub's process still runs.
  const runs = () => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
  for (const deadline = Date.now() + 30_000; Date.now() < deadline && (typeof pid === 'number' ? runs() : await helloAt(root.socket));) await sleep(250);
}
/**
 * The login service starts the build `current` names; why it isn't up, or undefined once its hub answers, judges the
 * health check's fixture claim as a good build does (`judge`) and keeps its start ID for STAY_MS.
 */
async function up(root: Root, ms: number, judge: boolean): Promise<string | undefined> {
  const failed = startService([installedPrograms(root.dir)!.deep, 'hub', 'run'], root.logs);
  if (failed) return `the login service didn't start it: ${failed}`;
  let hello: Record<string, unknown> | undefined;
  for (const deadline = Date.now() + ms; !(hello = await helloAt(root.socket)) && Date.now() < deadline;) await sleep(250);
  if (!hello) return `its hub didn't answer within ${ms / 1000} s`;
  if (!judge) return undefined;
  let check: Record<string, unknown>;
  try { check = await control(root.socket, root.token, 'hub.check', {}, 30_000); } catch (error) { return `its hub didn't judge the health check's fixture claim: ${message(error)}`; }
  if (check.outcome !== EXPECTED) return `its hub judged the health check's fixture claim ${String(check.claim)} ${String(check.outcome)}, where a good build reads ${EXPECTED}`;
  await sleep(STAY_MS);
  const still = await helloAt(root.socket);
  return still?.start === hello.start ? undefined : `its hub didn't stay up: its start ${String(hello.start)} ${still ? `became ${String(still.start)}` : 'stopped answering'} within ${STAY_MS / 1000} s`;
}
/** Keeps the newest KEEP promoted builds, the one in and the one before it always among them. */
function prune(versions: string, keep: (string | undefined)[]): void {
  const builds = readdirSync(versions).filter((n) => /^[0-9a-f]{40}$/.test(n)).sort((a, b) => statSync(join(versions, b)).mtimeMs - statSync(join(versions, a)).mtimeMs);
  const kept = new Set(keep.filter((n): n is string => !!n));
  for (const name of builds) if (kept.size < KEEP) kept.add(name);
  for (const name of builds) if (!kept.has(name)) rmSync(join(versions, name), { recursive: true, force: true });
}
