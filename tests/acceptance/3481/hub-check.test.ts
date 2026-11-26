// #3481: `deep-app --hub-check` against a real hub (`deep hub run`), once with an app home whose control.token isn't
// the hub's and once with the hub's own token.
//
// Surfaces (named by the issue and #41):
//   - the hub: the built CLI's `deep hub run` on a temp home of its own (packages/hub/test/hub.ts `withHub`, as #41's
//     real-hub test starts it). The hub writes a new control token to <home>/.deepbuild/control.token at each launch
//     (design: Socket roles and contract versions) and refuses a hello with any other token.
//   - the app: `deep-app --hub-check` from `cargo build --locked -p deep-app --bin deep-app` (#41's `appBinary`). With
//     HOME set it connects to the hub at `hub.address` in ~/.deepbuild/config.json (`unix:<path>`), else
//     ~/.deepbuild/hub.sock, and presents ~/.deepbuild/control.token as the app (crates/deep-app/src/hub.rs).
//   - "an app home whose control.token differs from the hub's": a home of its own (#41's `setUpHome`, a random token)
//     whose config.json points `hub.address` at the real hub's socket.
// "Its output" is stdout and stderr together: the issue doesn't say which stream names the refusal.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { withHub } from '../../../packages/hub/test/hub.js';
import { appBinary, childEnv, cleanup, NODE, REPO, rootOf, run, setUpHome, shown } from '../41/app/helpers.ts';

afterAll(cleanup, 60_000);
// deadline: the first test may build deep-app from the checkout (cargo, a large build on a loaded machine).
const BUILD = 3_600_000;
// deadline: --hub-check against a hub on this machine answers in seconds; the bound only stops a hung check.
const CHECK = 120_000;

/** The hub won't start without a deep-hook built under target/ (packages/hub/src/paths.ts): built once, as the app is. */
let hookBuilt: Promise<void> | undefined;
function deepHook(): Promise<void> {
  hookBuilt ??= run(join(REPO, 'scripts/lease'), ['cargo', 'build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, env: { ...process.env, PATH: `${dirname(NODE)}:${process.env.PATH ?? ''}` }, timeoutMs: BUILD }).then((r) => {
    if (r.code !== 0) throw Error(`BLOCKED: deep-hook didn't build, so no hub can start: ${shown(r)}`);
  });
  return hookBuilt;
}

it('#3481.e99bba39 against a real hub, an app home whose control.token differs from the hub\'s makes deep-app --hub-check exit non-zero, print no hub ok, and name the credential refusal', async () => {
  await deepHook();
  const app = await appBinary();
  await withHub(async (root) => {
    const h = setUpHome();
    writeFileSync(join(rootOf(h.home), 'config.json'), `${JSON.stringify({ hub: { address: `unix:${join(root, 'hub.sock')}` } })}\n`);
    const ran = await run(app, ['--hub-check'], { env: childEnv(h), cwd: h.tmp, timeoutMs: CHECK });
    const output = `${ran.stdout}\n${ran.stderr}`;
    if (ran.timedOut || ran.signal) expect.fail(`#3481 deep-app --hub-check didn't finish on its own: ${shown(ran)}`);
    if (ran.code === 0) expect.fail(`#3481 the hub refused the app's hello (its token isn't the hub's), so deep-app --hub-check must exit non-zero: ${shown(ran)}`);
    if (/hub ok/.test(output)) expect.fail(`#3481 the hub refused the app's hello, so deep-app --hub-check must not print hub ok: ${shown(ran)}`);
    if (!/\bcredential\b/.test(output)) expect.fail(`#3481 deep-app --hub-check must name the hub's credential refusal in its output: ${shown(ran)}`);
  });
}, BUILD);

it('#3481.0d194ed9 with the hub\'s own token, deep-app --hub-check still prints hub ok and exits 0', async () => {
  await deepHook();
  const app = await appBinary();
  await withHub(async (_root, home) => {
    // The hub's own home: its hub.sock and the control.token it wrote at this launch.
    const env = { ...childEnv(setUpHome()), HOME: home };
    const ran = await run(app, ['--hub-check'], { env, cwd: home, timeoutMs: CHECK });
    if (ran.timedOut || ran.signal) expect.fail(`#3481 deep-app --hub-check didn't finish on its own: ${shown(ran)}`);
    if (ran.code !== 0) expect.fail(`#3481 with the hub's own token deep-app --hub-check must exit 0: ${shown(ran)}`);
    if (!/^hub ok/m.test(ran.stdout)) expect.fail(`#3481 with the hub's own token deep-app --hub-check must print hub ok: ${shown(ran)}`);
  });
}, BUILD);
