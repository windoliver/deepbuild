// #1358 acceptance, on Linux (README.md): the systemd user unit `deep hub start` writes carries HOME. It is the other
// half of the third criterion, which names both definitions of the login service; `launchd.test.ts` reads the plist.
// Written blind, from the issue, the design and the base commit. The test runs the built CLI as a child process in an
// empty home of its own, with a `systemctl` stand-in first on PATH that logs its calls, loads and starts nothing and
// exits 1, and reads the unit the command wrote into that home. Off Linux `deep hub start` writes no unit, so the test
// is skipped there with a note that names the platform, which the lanes read as INCONCLUSIVE (platform), never a pass.
import { readFileSync } from 'node:fs';
import { afterAll, expect, test } from 'vitest';
import { cleanup, deep, homeIn, needs, standIns, tempFolder, unitEnvironment, units } from './helpers.ts';

afterAll(cleanup);

test('#1358.e5fdc397 the systemd user unit deep hub start writes carries HOME, the home that set it up', (ctx) => {
  needs(ctx, 'linux', 'this half of the criterion is read on Linux, where the login service is a systemd user unit');
  const dir = tempFolder();
  const home = homeIn(dir);
  const bin = standIns(dir);
  const r = deep({ home, bin }, 'hub', 'start');
  // The home began empty and XDG_CONFIG_HOME is inside it, so a unit under it is the one this command wrote. With
  // none, or more than one, there is no one definition to read, which is no answer about HOME.
  const written = units(home);
  if (written.length !== 1) throw Error(`BLOCKED: deep hub start left ${written.length} systemd units under ${home} (${written.join(', ') || 'none'}), so there is no one unit to read HOME from\n${r.shown}`);
  const text = readFileSync(written[0]!, 'utf8');
  const variables = unitEnvironment(text);
  expect(variables.HOME, `the systemd unit deep hub start wrote, ${written[0]}, sets HOME with Environment= in [Service] to the home that set it up, ${home}; it sets ${JSON.stringify(variables)}\n${text.trimEnd().split('\n').map((line) => `  | ${line}`.trimEnd()).join('\n')}\n${r.shown}`).toBe(home);
}, 150_000);
