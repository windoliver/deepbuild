// AC17 #41.fb18eabe: "Set up from an app opened by Finder, on a test account whose `deep` and runtime are only on the
// login shell's PATH, succeeds; with a login shell DeepBuild can't read, Set up names it." Scope line: "The app finds
// `deep` and its runtime from your login shell's PATH, read once at Set up, so an app opened from Finder sets up as one
// opened from a terminal; a login shell it can't read is named, never skipped quietly."
//
// No second macOS account is available to this run, so the test account is a temp HOME: nothing of the machine's
// user is read from it. Finder's launch is the environment launchd gives an app: everything cleared except HOME, USER,
// LOGNAME, TMPDIR, SHELL and PATH=/usr/bin:/bin:/usr/sbin:/sbin, with the working folder `/`. Only one variable is
// added, `DEEP_HUB_LAUNCHER` (the hub's own test seam, a stand-in that starts nothing), so that if any real setup ran
// it could never reach this machine's login service; the stand-in `deep` below never uses it.
//
// The account's login shell is a real one, /bin/zsh or /bin/bash, started through a wrapper that logs each start, and
// its profile (~/.zprofile, ~/.bash_profile) puts `<tmp>/login-bin` first on PATH. Only there are:
//   - `node`, the runtime: a script that runs this test's Node;
//   - `deep`, a stand-in for the installed command, as npm installs it: a `#!/usr/bin/env node` script, so it runs only
//     when the PATH it gets holds the runtime. It logs its arguments to `<tmp>/deep-ran.jsonl` and exits 0.
// Neither is in launchd's PATH on this machine (checked first; BLOCKED otherwise).
//
// Surface assumed: `deep-app --set-up` (#326's: the Set up click, headless) runs `deep setup` and, when it exits 0,
// prints its one line on stdout and exits 0. It reads the login shell's PATH once per Set up (one start of SHELL).
// A login shell it can't read (SHELL missing, exiting non-zero, or not answering) is named: its path, as SHELL gives it,
// is in the app's output (stdout or stderr), and Set up finishes within 60 s.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { appBinary, cleanup, NODE, pidFile, run, script, shown, tempDir, type Ran } from './helpers.ts';

afterAll(cleanup, 60_000);
const BUILD = 3_600_000;
const LAUNCHD_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

interface Account { tmp: string; home: string; loginBin: string; ranLog: string; shellLog: string }
/** The test account: a temp HOME whose `deep` and runtime are only in `<tmp>/login-bin`. */
function account(): Account {
  for (const dir of LAUNCHD_PATH.split(':')) {
    for (const name of ['deep', 'node']) if (existsSync(join(dir, name))) throw Error(`BLOCKED: ${join(dir, name)} is on launchd's PATH on this machine, so it can't stand for an account whose ${name} is only on the login shell's PATH`);
  }
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const loginBin = join(tmp, 'login-bin');
  const ranLog = join(tmp, 'deep-ran.jsonl');
  mkdirSync(home, { recursive: true });
  script(join(loginBin, 'node'), `#!/bin/sh\nexec '${NODE}' "$@"\n`);
  script(join(loginBin, 'deep'), [
    '#!/usr/bin/env node',
    '// The installed `deep`, standing in: logs how it was run and exits 0.',
    "const { appendFileSync } = require('node:fs');",
    `appendFileSync(${JSON.stringify(ranLog)}, JSON.stringify({ args: process.argv.slice(2), path: process.env.PATH }) + '\\n');`,
    "if (process.argv[2] === '--version') console.log('0.0.0');",
    '',
  ].join('\n'));
  // Belt and braces: nothing reaches the real login service through the login PATH either.
  for (const name of ['launchctl', 'systemctl', 'dead-launcher']) script(join(loginBin, name), '#!/bin/sh\nexit 0\n');
  const profile = `export PATH='${loginBin}':"$PATH"\n`;
  writeFileSync(join(home, '.zprofile'), profile);
  writeFileSync(join(home, '.bash_profile'), profile);
  return { tmp, home, loginBin, ranLog, shellLog: join(tmp, 'shell-started.log') };
}

/** A login shell `real` (/bin/zsh or /bin/bash) started through a wrapper that logs each start. */
function loginShell(a: Account, real: string): string {
  return script(join(a.tmp, 'shells', real.split('/').at(-1)!), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${a.shellLog}'\nexec ${real} "$@"\n`);
}

/** The app opened by Finder: launchd's environment, working folder `/`, the Set up click. */
async function setUpFromFinder(a: Account, shell: string): Promise<Ran> {
  const app = await appBinary();
  const { username } = userInfo();
  const env = {
    HOME: a.home, USER: username, LOGNAME: username, TMPDIR: `${a.tmp}/`, SHELL: shell, PATH: LAUNCHD_PATH,
    DEEP_HUB_LAUNCHER: join(a.loginBin, 'dead-launcher'),
  };
  return run(app, ['--set-up'], { env, cwd: '/', timeoutMs: 150_000 });
}

const ranDeep = (a: Account) => (existsSync(a.ranLog) ? readFileSync(a.ranLog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { args: string[]; path: string }) : []);
const shellStarts = (a: Account) => (existsSync(a.shellLog) ? readFileSync(a.shellLog, 'utf8').trim().split('\n').filter(Boolean).length : 0);

describe('AC17 #41.fb18eabe Set up from an app opened by Finder', () => {
  for (const real of ['/bin/zsh', '/bin/bash']) {
    it(`AC17 #41.fb18eabe with ${real} as the login shell and deep and its runtime only on its PATH, Set up succeeds, running that deep with that runtime, reading the login shell once`, async () => {
      const a = account();
      const ran = await setUpFromFinder(a, loginShell(a, real));
      if (ran.code !== 0) expect.fail(`#41 AC17 Set up from an app opened by Finder must succeed when deep and its runtime are on the login shell's PATH: ${shown(ran)}`);
      const runs = ranDeep(a);
      if (runs.length !== 1 || runs[0]!.args[0] !== 'setup') expect.fail(`#41 AC17 Set up must run the login shell's deep (${join(a.loginBin, 'deep')}) once, as deep setup: it ran ${JSON.stringify(runs)}`);
      expect(runs[0]!.path.split(':'), 'deep ran with the login shell\'s PATH, so its runtime was found').toContain(a.loginBin);
      expect(ran.stdout.trim().length, 'Set up says what it did in one line').toBeGreaterThan(0);
      expect(shellStarts(a), 'the login shell\'s PATH is read once at Set up').toBe(1);
    }, BUILD);
  }

  const unreadable: [string, (a: Account) => string][] = [
    ['a login shell that is missing', (a) => join(a.tmp, 'shells', 'no-such-shell')],
    ['a login shell that exits non-zero', (a) => script(join(a.tmp, 'shells', 'failing-shell'), '#!/bin/sh\necho "failing-shell: cannot start" >&2\nexit 1\n')],
    ['a login shell that never answers', (a) => {
      const pids = pidFile(join(a.tmp, 'hung.pids'));
      return script(join(a.tmp, 'shells', 'hung-shell'), `#!/bin/sh\necho $$ >> '${pids}'\nexec /bin/sleep 600\n`);
    }],
  ];
  for (const [what, make] of unreadable) {
    it(`AC17 #41.fb18eabe with ${what}, Set up names it, within 60 s`, async () => {
      const a = account();
      const shell = make(a);
      const ran = await setUpFromFinder(a, shell);
      if (ran.timedOut || ran.ms > 60_000) expect.fail(`#41 AC17 with ${what}, Set up must finish within 60 s, naming it: it took ${ran.ms} ms (${shown(ran)})`);
      if (!`${ran.stdout}\n${ran.stderr}`.includes(shell)) expect.fail(`#41 AC17 with ${what}, Set up must name it (${shell}), never skip it quietly: ${shown(ran)}`);
    }, BUILD);
  }
});
