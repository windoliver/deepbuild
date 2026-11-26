// AC1 #3481.e99bba39, blind redraft: "Against a real hub (`deep hub run`) with an app home whose `control.token` differs
// from the hub's, `deep-app --hub-check` exits non-zero, prints no `hub ok`, and names the `credential` refusal in its
// output. On the merge base it exits 0 with `hub ok`."
//
// Setup (README: The setup): the hub is the built CLI's `deep hub run` on its own temp home (withHub,
// packages/hub/test/hub.ts), which writes `<hub home>/.deepbuild/control.token` and listens on
// `<hub home>/.deepbuild/hub.sock`. The app runs with HOME set to a second home whose `.deepbuild/control.token` holds
// another random token and whose `.deepbuild/config.json` sets `hub.address` to `unix:<the hub's socket>`. So the app
// reaches the real hub and presents its own home's token, which the hub didn't write, and the hub refuses its hello
// with `credential` at `/token`.

import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { withHub } from '../../../../packages/hub/test/hub.js';
import { appBinary, appEnv, appHome, cleanup, cliBuilt, helloAt, onMac, run, shown, tokenAt } from './helpers.ts';

afterAll(cleanup, 60_000);
const BUILD = 3_600_000;
const AC1 = 'AC1 #3481.e99bba39';

describe(`${AC1} deep-app --hub-check against a real hub that refuses the app's token`, () => {
  it(`${AC1} with an app home whose control.token differs from the hub's, deep-app --hub-check exits non-zero, prints no hub ok, and names the credential refusal`, async () => {
    onMac();
    cliBuilt();
    const app = await appBinary();
    await withHub(async (root) => {
      const socket = join(root, 'hub.sock');
      // The setup holds: a real hub answers at the address the app's config names, and the two tokens differ.
      const hello = await helloAt(socket);
      expect(hello.hello, `the real hub answers at ${socket} with its hello: ${JSON.stringify(hello)}`).toBe('deep-hub');
      const a = appHome(socket);
      const hubToken = tokenAt(root);
      expect(hubToken, 'the hub wrote its control token').not.toBe('');
      expect(a.token, "the app home's control.token differs from the hub's").not.toBe(hubToken);

      const ran = await run(app, ['--hub-check'], { env: appEnv(a.home), cwd: a.home, timeoutMs: 120_000 });
      const output = `${ran.stdout}\n${ran.stderr}`;
      if (ran.timedOut || ran.code === null) expect.fail(`${AC1} deep-app --hub-check must exit within 120 s: ${shown(ran)}`);
      if (ran.code === 0) expect.fail(`${AC1} the hub refused the app's hello, so deep-app --hub-check must exit non-zero; it exited 0: ${shown(ran)}`);
      if (/\bhub ok\b/.test(output)) expect.fail(`${AC1} the hub refused the app's hello, so deep-app --hub-check must not print hub ok: ${shown(ran)}`);
      if (!/\bcredential\b/.test(output)) expect.fail(`${AC1} deep-app --hub-check must name the hub's credential refusal in its output: ${shown(ran)}`);
    });
  }, BUILD);
});
