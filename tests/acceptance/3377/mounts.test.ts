// #3377: on Linux a compose service can't read its checkout bind mounts, because ~/.deepbuild's folders are 0700; and a
// database service that exits before it answers is reported only as "never answered on its port".
//
//   AC2 #3377.28c30daf: on Linux, after a stack comes up, <home>/.deepbuild and <home>/.deepbuild/checkouts keep mode
//   0700, and another checkout's folder is not readable by any uid but yours.
//   AC3 #3377.ac962c70: a stack whose database service exits before it answers yields a finding that names the
//   service, its exit code and its last log line.
//
// Both run #580's sample through a real `deep hub run` (tests/acceptance/580/helpers.ts: Bench), on a real daemon. "Not
// readable by any uid but yours" is tried, not read off mode bits: the checkout folder is bind-mounted into a busybox
// container run as another uid, which lists it (the daemon mounts as root, so the folders above it don't guard it, as
// they don't guard a compose service's own mount). A control run as your own uid must list it, or the probe proves
// nothing and the test is BLOCKED.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { Bench, containers, docker, inspect, volumes, type Ev, type Line } from '../580/helpers.ts';

const AC2 = 'AC2 #3377.28c30daf';
const AC3 = 'AC3 #3377.ac962c70';
const TIMEOUT = 1_500_000;
/** What the planted database service says last before it exits, and its exit code; the line holds no digit. */
const LAST_LINE = 'deep-3377: the database gave up before it answered';
const EXIT_CODE = 93;

let bench: Bench | undefined;
afterEach(async () => {
  const b = bench;
  bench = undefined;
  if (!b) return;
  // A stack that never came up has no stack.served, so Bench.close doesn't know its project: the hub's compose lease
  // names it. Removed only when every container of it is this world's (its config names this world's folder).
  const events = await b.events().catch(() => [] as Ev[]);
  const projects = new Set(events.filter((e) => e.kind === 'lease.acquired' && e.data?.resource?.kind === 'compose').map((e) => String(e.data.resource.key)));
  await b.close();
  for (const p of projects) {
    const ids = containers(p);
    if (ids.some((id) => !JSON.stringify(inspect(id)).includes(b.w.tmp))) continue;
    if (ids.length) docker(['rm', '-f', ...ids], 120_000);
    const left = volumes(p);
    if (left.length) docker(['volume', 'rm', '-f', ...left], 120_000);
    docker(['network', 'rm', `${p}_default`]);
  }
}, 300_000);

function linuxOnly(id: string): void {
  if (process.platform !== 'linux') throw Error(`BLOCKED: ${id} needs Linux with a Docker daemon (a daemon that checks the container's uid on bind mounts); this machine is ${process.platform}`);
}

const mode = (path: string): string => (statSync(path).mode & 0o7777).toString(8).padStart(4, '0');

/** Lists the folder in a busybox container as the uid: exit code and the end of what it said. */
function listAs(uid: number, folder: string): { code: number | null; said: string } {
  const r = docker(['run', '--rm', '--network', 'none', '--pull', 'never', '--user', `${uid}:${uid}`, '-v', `${folder}:/probe:ro`, 'busybox:1.36', 'ls', '-a', '/probe'], 120_000);
  return { code: r.code, said: `${r.stdout}${r.stderr}`.trim().split('\n').slice(-1)[0] ?? '' };
}

test(`${AC2} after a stack comes up, <home>/.deepbuild and its checkouts folder keep mode 0700, and another checkout's folder is not readable by any uid but yours`, async () => {
  linuxOnly(AC2);
  const b = bench = await Bench.open({ slot: 2, worktrees: ['wt-a', 'wt-b'] });
  const [a, wb] = await Promise.all([b.session('wt-a'), b.session('wt-b')]);
  // Both journeys hold at /go, so both checkouts stand while both stacks are up.
  b.hold('wt-a');
  b.hold('wt-b');
  const onA = await b.claim(a);
  const servedA = await b.served(onA);
  const onB = await b.claim(wb);
  const servedB = await b.served(onB);

  const root = b.w.root;
  const checkouts = join(root, 'checkouts');
  expect.soft(mode(root), `${root} (<home>/.deepbuild) after the stacks came up`).toBe('0700');
  expect.soft(mode(checkouts), `${checkouts} (<home>/.deepbuild/checkouts) after the stacks came up`).toBe('0700');

  const you = process.getuid!();
  // A uid a compose service runs as (postgres's 999), one no image names, and nobody's.
  const others = [999, 4242, 65534].filter((u) => u !== you);
  // Each checkout is another's: B's beside A's stack, A's beside B's.
  for (const [other, beside] of [[servedB, servedA], [servedA, servedB]] as const) {
    const folder = other.checkout;
    expect.soft(folder.startsWith(`${checkouts}/`), `${other.run}'s checkout ${folder} is under ${checkouts}`).toBe(true);
    const mine = listAs(you, folder);
    if (mine.code !== 0) throw Error(`BLOCKED: ${AC2}: a container run as your own uid ${you} can't list ${folder} (exit ${String(mine.code)}: ${mine.said}), so the daemon maps uids and the probe can't tell who reads it`);
    for (const uid of others) {
      const r = listAs(uid, folder);
      expect.soft(r.code, `uid ${uid} listed ${other.run}'s checkout ${folder} (mode ${mode(folder)}) while ${beside.run}'s stack ${beside.stack} was up: ${r.said}`).not.toBe(0);
    }
  }
  b.release('wt-a');
  b.release('wt-b');
  await b.finished(onA);
  await b.finished(onB);
}, TIMEOUT);

test(`${AC3} a stack whose database service exits before it answers yields a finding that names the service, its exit code and its last log line`, async () => {
  linuxOnly(AC3);
  const b = bench = await Bench.open();
  // The sample's db service, made to say two lines and exit 93 before Postgres ever starts.
  const file = join(b.w.repo, 'docker-compose.yml');
  const compose = readFileSync(file, 'utf8');
  const image = '  db:\n    image: postgres:16\n';
  if (!compose.includes(image)) throw Error(`BLOCKED: ${AC3}: the sample's compose file has no db service on postgres:16 to plant the exit in`);
  writeFileSync(file, compose.replace(image, `${image}    entrypoint: ["sh", "-c", "echo 'deep-3377: starting' >&2; echo '${LAST_LINE}' >&2; exit ${EXIT_CODE}"]\n`));
  execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qam', 'the db service exits before it answers'], {
    cwd: b.w.repo, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: b.w.home, GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'ignore',
  });

  const s = await b.session();
  const p = await b.claim(s);
  const finished = await b.finished(p);
  const findings = ((finished.findings ?? []) as unknown[]).map(String);
  const shown = JSON.stringify(findings).slice(0, 1200);
  expect(finished.outcome, `the run's outcome (findings: ${shown})`).not.toBe('passed');
  const db = containers(String((await b.events()).find((e: Line) => e.kind === 'lease.acquired' && e.data?.resource?.kind === 'compose')?.data.resource.key), 'db')[0];
  if (db) {
    // The scenario formed as planted: the db container exited 93 and its log ends with the line.
    const state = inspect(db).State as Line | undefined;
    expect(state?.ExitCode, 'the db container\'s own exit code').toBe(EXIT_CODE);
  }
  // The one finding that names the service: it must hold the exit code and the last log line too.
  const named = findings.find((f) => /\bdb\b/.test(f)) ?? '';
  expect.soft(named, `a finding names the service db (findings: ${shown})`).not.toBe('');
  expect.soft(named, `the finding naming db names its exit code ${EXIT_CODE}`).toMatch(new RegExp(`\\b${EXIT_CODE}\\b`));
  expect.soft(named, 'the finding naming db names its last log line').toContain(LAST_LINE);
}, TIMEOUT);
