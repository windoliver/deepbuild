// AC14 #41.3e1f79e3, the surfaces you see: "With the network down, Check for updates says it couldn't check and gives
// the last check's time; a planted check that reports up to date offline fails." Scope line: "An update check says up
// to date only after a check that succeeded; offline or refused, it says it couldn't check and when it last did."
// The logic's own tests are tests/acceptance/41/update/update-check.test.ts; these run the `deep` command and the app.
//
// Surface assumed (the issue and design name no command or setting, so this is the one the tests pin):
//   `deep update --check`: checks for an update once and prints its one line as the last line of stdout.
//   `deep-app --check-for-updates`: no window; runs the app's Check for updates once and prints its line as the last
//     line of stdout, exit 0 whatever the check found.
//   Both fetch the update manifest with an HTTP GET of the URL in the environment variable DEEP_UPDATE_URL (a loopback
//   URL in these tests). A 200 answer whose JSON body has a string `version` is a check that succeeded; a refused,
//   dropped or unreachable connection is a check that did not. Each keeps the time of its last successful check under
//   HOME (~/.deepbuild/, any file), so a later run reads it back.
//   A check that did not succeed prints a line that says it couldn't check (/couldn['’]?t check|could not check/i)
//   and gives the last successful check's time as an ISO 8601 UTC time (2026-11-07T10:42:00Z, milliseconds optional),
//   or the word "never" when none succeeded in this home; it never says "up to date".
// Homes here have ~/.deepbuild in place, so the first `deep` command runs no setup (packages/hub/src/setup.ts).
// The planted wrong program, twins/check-says-up-to-date.mjs, stands in for `deep`: its `update --check` says up to
// date without fetching anything.

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appBinary, childEnv, CLI, cleanup, droppingServer, failsWith, lastLine, NODE, run, setUpHome, shown, TWINS, updateServer,
  type Home, type Ran,
} from './helpers.ts';

afterAll(cleanup, 60_000);
const BUILD = 3_600_000;
const COULDNT = /couldn['’]?t check|could not check/i;
const ISO = /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/g;

type Surface = 'deep' | 'app';
const who = (s: Surface) => (s === 'deep' ? '`deep update --check`' : 'the app\'s Check for updates (deep-app --check-for-updates)');
async function checkNow(s: Surface, h: Home, url: string): Promise<Ran> {
  const env = childEnv(h, { DEEP_UPDATE_URL: url });
  if (s === 'deep') return run(NODE, [CLI, 'update', '--check'], { env, cwd: h.tmp, timeoutMs: 120_000 });
  return run(await appBinary(), ['--check-for-updates'], { env, cwd: h.tmp, timeoutMs: 120_000 });
}

/** The line of a check made with the network down: couldn't check, the last success's time (or never), no up to date. */
function couldntCheck(s: Surface, r: Ran, last: { from: number; to: number } | 'never'): void {
  const line = lastLine(r.stdout);
  if (/up to date/i.test(r.stdout)) expect.fail(`#41 AC14 offline, ${who(s)} said up to date without a check that succeeded: ${JSON.stringify(line)}`);
  if (!COULDNT.test(line)) expect.fail(`#41 AC14 offline, ${who(s)} must say it couldn't check: ${shown(r)}`);
  const times = line.match(ISO) ?? [];
  if (last === 'never') {
    if (!/\bnever\b/i.test(line) || times.length) expect.fail(`#41 AC14 offline with no check that ever succeeded here, ${who(s)} must say the last check was never: ${JSON.stringify(line)}`);
    return;
  }
  if (times.length !== 1) expect.fail(`#41 AC14 offline, ${who(s)} must give the last check's time as one ISO 8601 UTC time: ${JSON.stringify(line)}`);
  const at = Date.parse(times[0]!);
  // ISO times may drop the milliseconds, so the window starts at the second the successful check began.
  if (!(at >= Math.floor(last.from / 1000) * 1000 && at <= last.to)) expect.fail(`#41 AC14 offline, ${who(s)} must give the time of the last check that succeeded, between ${new Date(last.from).toISOString()} and ${new Date(last.to).toISOString()}: it gave ${times[0]}`);
}

/** A check that succeeds against a loopback manifest, then the network goes down; returns when the success ran. */
async function succeedThenGoOffline(s: Surface, h: Home): Promise<{ from: number; to: number; url: string }> {
  const server = await updateServer('0.0.1');
  const from = Date.now();
  const ok = await checkNow(s, h, server.url);
  const to = Date.now();
  if (server.hits() < 1) expect.fail(`#41 AC14 ${who(s)} must fetch the manifest at DEEP_UPDATE_URL (${server.url}); it made no request: ${shown(ok)}`);
  if (COULDNT.test(ok.stdout)) expect.fail(`#41 AC14 with the manifest answering, ${who(s)} must not say it couldn't check: ${shown(ok)}`);
  await server.close();
  return { from, to, url: server.url };
}

for (const s of ['deep', 'app'] as const) {
  describe(`AC14 #41.3e1f79e3 ${who(s)} with the network down`, () => {
    it(`AC14 #41.3e1f79e3 ${s}: after a check that succeeded, with the update server's port closed, it says it couldn't check and gives that check's time, never up to date`, async () => {
      const h = setUpHome();
      const { from, to, url } = await succeedThenGoOffline(s, h);
      const offline = await checkNow(s, h, url);
      couldntCheck(s, offline, { from, to });
      // A second failure moves nothing: it still gives the one success's time.
      couldntCheck(s, await checkNow(s, h, url), { from, to });
    }, BUILD);

    it(`AC14 #41.3e1f79e3 ${s}: after a check that succeeded, with a network that drops the connection, it says it couldn't check and gives that check's time`, async () => {
      const h = setUpHome();
      const { from, to } = await succeedThenGoOffline(s, h);
      const dropping = await droppingServer();
      couldntCheck(s, await checkNow(s, h, dropping.url), { from, to });
    }, BUILD);

    it(`AC14 #41.3e1f79e3 ${s}: offline in a home where no check ever succeeded, it says it couldn't check and that the last check was never`, async () => {
      const h = setUpHome();
      const server = await updateServer('0.0.1');
      await server.close();
      couldntCheck(s, await checkNow(s, h, server.url), 'never');
    }, BUILD);
  });
}

describe('AC14 #41.3e1f79e3 planted', () => {
  it('AC14 #41.3e1f79e3 planted: a check that reports up to date offline (twins/check-says-up-to-date.mjs as deep) fails this test', async () => {
    const h = setUpHome();
    const server = await updateServer('0.0.1');
    await server.close();
    const env = childEnv(h, { DEEP_UPDATE_URL: server.url });
    const r = await run(NODE, [join(TWINS, 'check-says-up-to-date.mjs'), 'update', '--check'], { env, cwd: h.tmp, timeoutMs: 60_000 });
    await failsWith(() => couldntCheck('deep', r, 'never'), /^#41 AC14 offline, .* said up to date without a check that succeeded/);
  }, 120_000);
});
