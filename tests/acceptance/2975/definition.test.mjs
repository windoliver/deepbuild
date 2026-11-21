// #2975 AC6: the login service's definition, as the hub's start through its login service writes it (the step of
// `deep setup` that starts the hub; README: The surface). On Linux, the systemd user unit keeps Restart=on-failure and
// adds RestartSec=3, SuccessExitStatus=75 and RestartForceExitStatus=75; on macOS, the plist keeps KeepAlive's
// SuccessfulExit false. The base picks the definition by process.platform with no seam, so each half runs on its own
// platform only and is skipped, with that reason, on the other.
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LONG, assert, deep, sandbox, shown } from './helpers.mjs';

/** The definition file `deep hub start` wrote for the installed hub through the login service's stand-in. */
async function written(t, file) {
  const box = await sandbox(t);
  const run = await deep(box, ['hub', 'start']);
  const path = file(box);
  assert.ok(existsSync(path), `BLOCKED: deep hub start wrote no login service definition at ${path.split(box.dir).join('<sandbox>')}: ${shown(run, box)}`);
  return path;
}

/** The [Service] section's settings: each key to the values it was given, in order. */
function service(text) {
  const section = /^\[Service\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(text)?.[1] ?? '';
  const keys = {};
  for (const m of section.matchAll(/^\s*([A-Za-z]+)\s*=\s*(.*?)\s*$/gm)) (keys[m[1]] ??= []).push(m[2]);
  return keys;
}

test('#2975.4668c24b the systemd unit keeps Restart=on-failure and adds RestartSec=3, SuccessExitStatus=75 and RestartForceExitStatus=75', {
  ...LONG, skip: process.platform !== 'linux' && `platform ${process.platform}: the base writes the systemd unit only on Linux (service.ts picks the definition by process.platform), so this half runs on Linux`,
}, async (t) => {
  const path = await written(t, (box) => join(box.env.XDG_CONFIG_HOME, 'systemd', 'user', 'deepbuild-hub.service'));
  const keys = service(readFileSync(path, 'utf8'));
  const has = (key, value) => (keys[key] ?? []).some((v) => v.split(/\s+/).includes(value));
  const got = {
    Restart: keys.Restart?.at(-1),
    RestartSec: /^3(s|sec)?$/.test(keys.RestartSec?.at(-1) ?? '') ? '3' : keys.RestartSec?.at(-1),
    SuccessExitStatus75: has('SuccessExitStatus', '75'),
    RestartForceExitStatus75: has('RestartForceExitStatus', '75'),
  };
  assert.deepEqual(got, { Restart: 'on-failure', RestartSec: '3', SuccessExitStatus75: true, RestartForceExitStatus75: true }, `the unit's [Service] settings: ${JSON.stringify(keys)}`);
});

test('#2975.4668c24b the plist still has KeepAlive with SuccessfulExit false', {
  ...LONG, skip: process.platform !== 'darwin' && `platform ${process.platform}: the base writes the launchd plist only on macOS, so this half runs on macOS`,
}, async (t) => {
  const path = await written(t, (box) => join(box.home, 'Library', 'LaunchAgents', 'com.deepbuild.hub.plist'));
  // plutil, the OS's own plist parser, reads it as launchd would.
  const plist = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8' }));
  assert.deepEqual(plist.KeepAlive, { SuccessfulExit: false }, `the plist's KeepAlive must still be { SuccessfulExit: false }: ${JSON.stringify(plist.KeepAlive)}`);
});
