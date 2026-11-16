// #2119 acceptance (README.md), the fourth criterion: doctor judges the program the hub's login service runs, not the
// folder Node is installed in. Written first and blind, from the issue, the design and the base commit. The test writes
// the login service's definition into a home of its own, as setup writes it for a hub not yet promoted, with its own
// arguments: a node under a folder that holds .git, the CLI's script in no git folder, hub, run. Then `deep doctor
// --json` runs as a child process of the built CLI, and the test reads its hub.service item. A failure on a wrong
// program is the expect below; a test that can't set that up throws BLOCKED, and never passes or skips.
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { child, cleanup, deep, gitAbove, homeIn, items, needs, sharedFolder, tempFolder, underTemp } from './helpers.ts';

afterAll(cleanup);

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

test("#2119.c097fc3c doctor judges the program the login service runs, not the folder Node is installed in: a service definition whose arguments are a node under a folder that holds .git, a CLI script in no git folder, hub, run reads as service_unpromoted at level warn", async () => {
  needs();
  if (process.platform !== 'darwin') throw Error(`BLOCKED: this test writes the login service's definition as launchd's plist, macOS's, and needs /Users/Shared; this is ${process.platform}`);
  const folder = tempFolder();
  const home = homeIn(folder);
  // A node under a folder that holds .git, as a package manager's prefix that is itself a git checkout.
  const prefix = join(folder, 'prefix');
  mkdirSync(join(prefix, '.git'), { recursive: true });
  mkdirSync(join(prefix, 'bin'));
  const node = join(prefix, 'bin', 'node');
  symlinkSync(process.execPath, node);
  // The CLI's script in no git folder, and under no temp folder, which doctor counts as a place a run can lose too.
  const cli = join(sharedFolder(), 'cli', 'dist', 'main.js');
  mkdirSync(dirname(cli), { recursive: true });
  writeFileSync(cli, '');
  if (gitAbove(cli) || underTemp(cli)) throw Error(`BLOCKED: ${cli} is in a git folder or under a temp folder in this run`);
  if (gitAbove(node) !== prefix) throw Error(`BLOCKED: the first folder holding .git above ${node} is ${gitAbove(node) ?? 'none'}, not ${prefix}`);

  // The login service's definition where doctor reads it, as service.ts writes it for launchd: the program and its arguments.
  const program = [node, cli, 'hub', 'run'];
  const plist = join(home, 'Library', 'LaunchAgents', 'com.deepbuild.hub.plist');
  mkdirSync(dirname(plist), { recursive: true });
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.deepbuild.hub</string>
  <key>ProgramArguments</key>
  <array>
    ${program.map((arg) => `<string>${xml(arg)}</string>`).join('\n    ')}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/bin:/bin</string>
    <key>HOME</key>
    <string>${xml(home)}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(join(home, '.deepbuild', 'logs', 'hub.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(home, '.deepbuild', 'logs', 'hub.log'))}</string>
</dict>
</plist>
`);

  const r = await deep(child(folder, home), 'doctor', '--json');
  const item = items(r).find((i) => i.item === 'hub.service');
  // Given: doctor read that definition.
  if (!item || item.code === 'not_checked') throw Error(`BLOCKED: doctor's hub.service item read no login service definition at ${plist}\n${r.shown}`);
  expect({ code: item.code, level: item.level }, `doctor's hub.service item, for a login service that runs ${program.join(' ')}:\n${JSON.stringify(item, null, 2)}\n$ HOME=${home} deep doctor --json: exit ${r.code}\n(end of the item)`).toEqual({ code: 'service_unpromoted', level: 'warn' });
}, 600_000);
