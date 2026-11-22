// #2958 AC1 and AC2: `deep-app --hub-check` against a real hub, from the built app and the built CLI. The surfaces are
// pinned in README.md.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { cleanup, configure, hubCheck, needBuilt, shown, startHub, tempDir } from './helpers.mjs';

after(cleanup);

const REFUSAL = /refus|credential/i;

/** The check's answer is the hub's, as the app, with no refusal: `hub ok` first on stdout, exit 0, no refusal said. */
function answeredAsApp(r, where) {
  assert.ok(!r.timedOut, `${where}: deep-app --hub-check didn't finish within 60 s: ${shown(r)}`);
  assert.match(r.stdout.split('\n')[0] ?? '', /^hub ok/, `${where}: stdout's first line doesn't start with "hub ok": ${shown(r)}`);
  assert.equal(r.code, 0, `${where}: deep-app --hub-check exited ${r.code}: ${shown(r)}`);
  assert.doesNotMatch(r.stderr, REFUSAL, `${where}: the hub refused the app (its hello or a call): ${shown(r)}`);
}

test('AC1 #2958.9c0089ca with hub.address pointing at a hub run with --root in another folder, deep-app --hub-check is answered by that hub as the app, with no refusal', { timeout: 240_000 }, async () => {
  needBuilt();
  // Two states of the installed root: a control token of its own that isn't the dev hub's, and none at all.
  for (const installed of ['a different control.token', 'no control.token']) {
    const tmp = tempDir();
    const home = join(tmp, 'h');
    const root = join(tmp, 'r');
    mkdirSync(home, { recursive: true });
    const hub = await startHub(home, root);
    try {
      assert.ok(existsSync(join(root, 'control.token')), `the dev hub at ${root} wrote no control.token beside its socket`);
      configure(home, hub.socket);
      const installedToken = join(home, '.deepbuild', 'control.token');
      if (installed === 'a different control.token') {
        writeFileSync(installedToken, 'not-the-dev-hubs-token-2958\n', { mode: 0o600 });
        assert.notEqual(readFileSync(installedToken, 'utf8').trim(), readFileSync(join(root, 'control.token'), 'utf8').trim());
      }
      assert.ok(!existsSync(join(home, '.deepbuild', 'hub.sock')), 'a hub is at the installed root too; only the dev hub may answer');
      const r = await hubCheck(home);
      answeredAsApp(r, `installed root with ${installed}, hub.address unix:${hub.socket}`);
    } finally {
      await hub.stop();
    }
  }
});

test('AC2 #2958.db948145 with no hub.address configured, deep-app --hub-check reaches the installed hub as before', { timeout: 120_000 }, async () => {
  needBuilt();
  const home = join(tempDir(), 'h');
  mkdirSync(home, { recursive: true });
  const hub = await startHub(home);
  try {
    assert.ok(!existsSync(join(home, '.deepbuild', 'config.json')) || !/"address"/.test(readFileSync(join(home, '.deepbuild', 'config.json'), 'utf8')), 'a hub.address is configured; this criterion runs with none');
    const r = await hubCheck(home);
    answeredAsApp(r, 'no hub.address, the installed hub at ~/.deepbuild/hub.sock');
  } finally {
    await hub.stop();
  }
});
