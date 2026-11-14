// #2203 acceptance (README.md): a `deep` command in a home under a temp folder never loads a hub into the real service
// manager. Written first and blind, from the issue, the design and the base commit. Each test runs the built CLI as a
// child process with a `launchctl` stand-in first on PATH, which logs its calls and loads nothing, and reads that log,
// the exit code and stderr. A failure on a wrong program is an expect in this file, and its message carries the
// child's command, exit code and output. A test that can't run here throws BLOCKED: it never passes and never skips.
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { bootstraps, calls, cleanup, deep, homeIn, needHook, needs, plist, realFolder, standIn, standIns, tempFolder } from './helpers.ts';

afterAll(cleanup);

test('#2203.3f4ab016 a temp home loads nothing: deep hub start there, with no launcher named and a launchctl outside every temp folder first on PATH, logs no bootstrap and exits 3 saying a temp home gets no login service', () => {
  needs();
  const home = homeIn(tempFolder());
  const bin = standIns(realFolder());
  const r = deep({ home, bin }, 'hub', 'start');
  // The base's failure comes first: today the stand-in logs a bootstrap of the temp home's plist.
  expect(bootstraps(bin), `deep hub start in a home under a temp folder reached launchctl bootstrap, where that home gets no login service\n${r.shown}`).toEqual([]);
  expect(r.code, `deep hub start in a home under a temp folder exits 3\n${r.shown}`).toBe(3);
  expect(r.stderr, `deep hub start in a home under a temp folder says on stderr that a temp home gets no login service\n${r.shown}`).toMatch(/\btemp(?:orary)?\b/i);
  expect(r.stderr, `deep hub start in a home under a temp folder says on stderr that a temp home gets no login service\n${r.shown}`).toMatch(/\blogin service\b/i);
}, 150_000);

test('#2203.ca54c4b1 the same through setup: deep inbox in that home, with no .deepbuild, logs no bootstrap', () => {
  needs();
  needHook();
  // First, that setup reaches the service manager from this checkout at all: the same command in the same kind of home,
  // its launchctl under a temp folder, where a temp home loads as today (the issue's Scope). A setup that stopped before
  // its hub start would log no bootstrap below either, and read as the rule. This is no assertion: a run that can't
  // show it is BLOCKED, so it proves nothing on the base either.
  const under = tempFolder();
  const underBin = standIns(under);
  const reached = deep({ home: homeIn(under), bin: underBin }, 'inbox');
  if (!bootstraps(underBin).length) throw Error(`BLOCKED: deep inbox in a temp home whose launchctl is under a temp folder logged no bootstrap, so this run can't tell the rule from a setup that never reached the service manager\n${reached.shown}`);

  const home = homeIn(tempFolder());
  const bin = standIns(realFolder());
  const r = deep({ home, bin }, 'inbox');
  expect(bootstraps(bin), `deep inbox in a home under a temp folder, with no .deepbuild, reached launchctl bootstrap through setup\n${r.shown}`).toEqual([]);
}, 300_000);

test("#2203.e7d67ec1 a real home loads as before: deep hub start in a home outside every temp folder, with the same stand-in, logs the bootstrap of that home's plist", () => {
  needs();
  const folder = realFolder();
  const home = homeIn(folder);
  const bin = standIns(folder);
  const r = deep({ home, bin }, 'hub', 'start');
  expect(bootstraps(bin).filter((call) => call.endsWith(` ${plist(home)}`)), `deep hub start in a home outside every temp folder logged no launchctl bootstrap of ${plist(home)}\n${r.shown}`).not.toEqual([]);
}, 150_000);

test("#2203.c433bc9f a test that names a launcher is unchanged: deep hub start in a temp home that names one, as #1359's and #1002's suites do, hands it the home's service definition, and launchctl logs no bootstrap", () => {
  needs();
  const folder = tempFolder();
  const home = homeIn(folder);
  const launcher = standIn(join(folder, 'launcher'));
  // The launchctl outside every temp folder, as in the first test: where a home that names no launcher is refused.
  const bin = standIns(realFolder());
  const r = deep({ home, bin, launcher }, 'hub', 'start');
  expect(calls(launcher), `deep hub start in a temp home that names a launcher hands the launcher ${plist(home)}, once, as before\n${r.shown}`).toEqual([`launcher ${plist(home)}`]);
  expect(bootstraps(bin), `deep hub start in a temp home that names a launcher reached launchctl bootstrap\n${r.shown}`).toEqual([]);
}, 150_000);
