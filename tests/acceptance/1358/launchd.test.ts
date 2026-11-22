// #1358 acceptance, on macOS (README.md): `deep hub start` never kickstarts another home's hub job, still kickstarts
// its own, and hands launchd a plist that carries HOME. Written blind, from the issue, the design and the base commit.
// Each test runs the built CLI as a child process in a home of its own, with a `launchctl` stand-in first on PATH that
// answers as launchd does while com.deepbuild.hub is loaded, logs its calls and starts nothing. A test reads that log,
// the exit code, stderr and the plist the command handed over. A failure on a wrong program is an expect in this file,
// and its message carries the child's command, exit code and output. Off macOS each test is skipped with a note that
// names the platform, which the lanes read as INCONCLUSIVE (platform), never a pass; a test that can't run for any
// other reason throws BLOCKED.
import { afterAll, expect, test } from 'vitest';
import { LABEL, cleanup, deep, homeIn, job, launchctl, loadedFrom, needs, otherPlist, plist, readPlist, standIns, tempFolder } from './helpers.ts';

afterAll(cleanup);
const MACOS = "this criterion is read on macOS, where the login service is launchd's and its command launchctl";

test("#1358.a5dca18a with com.deepbuild.hub already loaded from another home's plist, deep hub start starts nothing, exits 3, and names that plist and the launchctl bootout that frees the label", (ctx) => {
  needs(ctx, 'darwin', MACOS);
  const dir = tempFolder();
  const home = homeIn(dir);
  const bin = standIns(dir);
  const other = otherPlist(homeIn(dir, 'other'));
  loadedFrom(bin, other);
  const r = deep({ home, bin }, 'hub', 'start');
  // The reported failure comes first: the other home's job is kickstarted.
  expect([...launchctl(bin, 'kickstart'), ...launchctl(bin, 'start')], `deep hub start, with ${LABEL} loaded from another home's plist (${other}), starts nothing: no launchctl kickstart, no launchctl start\n${r.shown}`).toEqual([]);
  expect(r.code, `deep hub start, with ${LABEL} loaded from another home's plist, exits 3\n${r.shown}`).toBe(3);
  expect(r.stderr, `deep hub start, with ${LABEL} loaded from another home's plist, names that plist, ${other}, on stderr\n${r.shown}`).toContain(other);
  // The bootout that frees the label, in either form launchctl takes: the job by its name in the user's domain, or
  // the domain and the plist that loaded it.
  const frees = [`launchctl bootout ${job()}`, `launchctl bootout gui/${process.getuid!()} ${other}`];
  expect(frees.filter((command) => r.stderr.includes(command)), `deep hub start, with ${LABEL} loaded from another home's plist, names on stderr the launchctl bootout that frees the label: one of ${frees.map((command) => `\`${command}\``).join(' or ')}\n${r.shown}`).not.toEqual([]);
}, 150_000);

test("#1358.1077c231 with com.deepbuild.hub loaded from this home's own plist, deep hub start kickstarts it as before", (ctx) => {
  needs(ctx, 'darwin', MACOS);
  const dir = tempFolder();
  const home = homeIn(dir);
  const bin = standIns(dir);
  loadedFrom(bin, plist(home));
  const r = deep({ home, bin }, 'hub', 'start');
  expect(launchctl(bin, 'kickstart').filter((call) => call.endsWith(` ${job()}`)), `deep hub start, with ${LABEL} loaded from this home's own plist (${plist(home)}), kickstarts it, once: launchctl kickstart ${job()}\n${r.shown}`).toHaveLength(1);
}, 150_000);

test('#1358.e5fdc397 the plist deep hub start hands launchd carries HOME, the home that set it up', (ctx) => {
  needs(ctx, 'darwin', MACOS);
  const dir = tempFolder();
  const home = homeIn(dir);
  const bin = standIns(dir);
  loadedFrom(bin, plist(home));
  const r = deep({ home, bin }, 'hub', 'start');
  // The definition is the file the command handed to `launchctl bootstrap`, its last argument. With none handed over
  // there is no definition to read, which is no answer about HOME.
  const handed = [...new Set(launchctl(bin, 'bootstrap').map((call) => call.split(' ').at(-1)!))];
  if (handed.length !== 1) throw Error(`BLOCKED: deep hub start handed launchctl bootstrap ${handed.length} definitions, so there is no one plist to read HOME from\n${r.shown}`);
  const read = readPlist(handed[0]!);
  expect(read.ok, `the plist deep hub start handed launchd, ${handed[0]}, is a property list launchd can read; plutil said: ${read.said}\n${r.shown}`).toBe(true);
  const variables = (read.value.EnvironmentVariables ?? {}) as Record<string, unknown>;
  expect(variables.HOME, `the plist deep hub start handed launchd, ${handed[0]}, sets HOME under EnvironmentVariables to the home that set it up, ${home}; it sets ${JSON.stringify(variables)}\n${r.shown}`).toBe(home);
}, 150_000);
