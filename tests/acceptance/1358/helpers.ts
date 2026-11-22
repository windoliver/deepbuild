// Test-side tools for issue #1358's acceptance tests (README.md): this suite's own folders under a temp folder; empty
// homes in them; stand-ins for the service managers, each logging its calls, the `launchctl` one answering as launchd
// does for a label that is already loaded; the built `deep` CLI run as a child process; and readers for the two
// definitions of the login service, launchd's plist and the systemd user unit. Nothing here stands in for DeepBuild: a
// test reaches it through the CLI alone and reads its exit code, its stderr, what the stand-ins logged and the
// definition it wrote. No stand-in starts a program, so no test leaves a process behind.
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'vitest';

/** The checkout this file is in, wherever it sits. Its packages/cli/dist/main.js is the `deep` every test runs. */
const CHECKOUT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const CLI = join(CHECKOUT, 'packages/cli/dist/main.js');
const real = (path: string): string => { try { return realpathSync(path); } catch { return path; } };

/** The one label every home's hub job has, and the job's name in this user's launchd domain, both as the issue writes them. */
export const LABEL = 'com.deepbuild.hub';
export const job = (): string => `gui/${process.getuid!()}/${LABEL}`;

/**
 * What every test needs: the platform whose service manager its criterion names, and the built CLI. Neither lack is
 * ever a pass. On the other platform the test is skipped with a note that names the platform this machine lacks, which
 * the lanes read as INCONCLUSIVE (platform) and never list as covered (`isPlatform` in scripts/lanes.mjs). With no
 * built CLI it is BLOCKED, by a thrown error.
 */
export function needs(ctx: TestContext, platform: 'darwin' | 'linux', why: string): void {
  if (process.platform !== platform) ctx.skip(`INCONCLUSIVE: ${why}; this is ${process.platform}, where deep hub start never writes or hands over that definition, so nothing was read here, and this is not a pass`);
  if (!existsSync(CLI)) throw Error('BLOCKED: this checkout has no built CLI at packages/cli/dist/main.js; run npm run build --workspaces first');
}

// ---- This suite's own folders, removed at the end. Short real paths, each under a temp folder.
const made: string[] = [];
/** A folder under a temp folder, by its real path: /private/tmp/dh1358-* on macOS, /tmp/dh1358-* on Linux. */
export function tempFolder(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1358-'));
  made.push(dir);
  return dir;
}
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * An empty home, `<dir>/<name>`: nothing of DeepBuild is in it. `<dir>/confirm` answers `cancelled` for the OS
 * confirming you (DEEP_HUB_TEST_CONFIRM, #24's seam), so nothing a command asks you to confirm goes through.
 */
export function homeIn(dir: string, name = 'h'): string {
  const home = join(dir, name);
  mkdirSync(home);
  writeFileSync(join(dir, 'confirm'), 'cancelled\n');
  return home;
}
/** The hub's launchd definition in a home, where the issue names it: `<home>/Library/LaunchAgents/com.deepbuild.hub.plist`. */
export const plist = (home: string): string => join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
/** Another home's plist on disk, as a job loaded from it would have: a definition of the same label. No test's command reads it. */
export function otherPlist(home: string): string {
  const file = plist(home);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>Label</key>\n  <string>${LABEL}</string>\n</dict>\n</plist>\n`);
  return file;
}

/**
 * `<dir>/bin` with `launchctl` and `systemctl` stand-ins: the folder a child gets first on PATH. Each appends its name
 * and arguments to `<file>.log` and loads, starts and stops nothing.
 *
 * `launchctl` answers as launchd does while the label is loaded: `bootstrap` fails with launchd's own words and exit
 * code for a label already loaded; `print gui/<uid>/com.deepbuild.hub` writes `<file>.print` (see `loadedFrom`) and
 * exits 0, or says the service isn't there and exits 113 when the test named no loaded job or the target is another;
 * every other call, `kickstart` too, is logged and exits 1, since nothing is there to start. `systemctl` exits 1.
 */
export function standIns(dir: string): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const launchctl = join(bin, 'launchctl');
  writeFileSync(launchctl, `#!/bin/sh
printf '%s %s\\n' launchctl "$*" >> '${launchctl}.log'
case "$1" in
  bootstrap)
    echo 'Bootstrap failed: 5: Input/output error' >&2
    exit 5 ;;
  print)
    if [ "$2" = '${job()}' ] && [ -f '${launchctl}.print' ]; then /bin/cat '${launchctl}.print'; exit 0; fi
    echo "Bad request." >&2
    echo "Could not find service \\"${LABEL}\\" in domain for user gui: ${process.getuid!()}" >&2
    exit 113 ;;
esac
echo "the launchctl stand-in starts and stops nothing: $1" >&2
exit 1
`);
  const systemctl = join(bin, 'systemctl');
  writeFileSync(systemctl, `#!/bin/sh\nprintf '%s %s\\n' systemctl "$*" >> '${systemctl}.log'\necho 'the systemctl stand-in loads and starts nothing' >&2\nexit 1\n`);
  for (const file of [launchctl, systemctl]) chmodSync(file, 0o755);
  return bin;
}
/**
 * Says which plist loaded the label's job: from now on the `launchctl` stand-in in `bin` answers
 * `launchctl print gui/<uid>/com.deepbuild.hub` as launchd does for a loaded LaunchAgent, naming `path` on its
 * `path = ` line.
 */
export function loadedFrom(bin: string, path: string): void {
  writeFileSync(join(bin, 'launchctl.print'), [
    `${job()} = {`,
    '\tactive count = 1',
    `\tpath = ${path}`,
    '\ttype = LaunchAgent',
    '\tstate = running',
    '',
    '\tprogram = /usr/local/bin/node',
    '\targuments = {',
    '\t\t/usr/local/bin/node',
    '\t\thub',
    '\t\trun',
    '\t}',
    '',
    '\tdefault environment = {',
    '\t\tPATH => /usr/bin:/bin:/usr/sbin:/sbin',
    '\t}',
    '',
    '\tdomain = ' + `gui/${process.getuid!()} [100000]`,
    '\truns = 1',
    '\tpid = 4242',
    '\tlast exit code = (never exited)',
    '}',
    '',
  ].join('\n'));
}
/** What a stand-in in `bin` was asked to do, one line a call: its name, then its arguments. */
export const calls = (bin: string, name: 'launchctl' | 'systemctl'): string[] => (existsSync(join(bin, `${name}.log`)) ? readFileSync(join(bin, `${name}.log`), 'utf8').split('\n').filter(Boolean) : []);
/** The stand-in's logged `launchctl <verb> …` calls. */
export const launchctl = (bin: string, verb: string): string[] => calls(bin, 'launchctl').filter((call) => call.startsWith(`launchctl ${verb} `) || call === `launchctl ${verb}`);

export interface Ran { code: number; stderr: string; shown: string }
/**
 * `deep <args>` run to its end as a child process: the built CLI under this Node, in the folder that holds the home.
 * Its environment is only this: HOME `home`; PATH `bin`, then /usr/bin and /bin, so the stand-ins in `bin` come first;
 * SHELL /bin/sh; XDG_CONFIG_HOME inside the home; and the stubbed OS confirmation. No variable of the runner's reaches
 * it, and none names a launcher. `shown` is the command, its exit code, its output and what the stand-ins logged, each
 * output line quoted, so none reads as a frame of a test's own stack.
 */
export function deep(o: { home: string; bin: string }, ...args: string[]): Ran {
  // No child runs outside this run's folders or without both stand-ins first on PATH: the real service manager is never reached.
  for (const place of [o.home, o.bin]) if (!made.some((dir) => place.startsWith(dir + sep))) throw Error(`BLOCKED: ${place} is in no folder this run made`);
  for (const name of ['launchctl', 'systemctl']) {
    try { accessSync(join(o.bin, name), constants.X_OK); } catch { throw Error(`BLOCKED: ${o.bin} holds no ${name} stand-in to run`); }
  }
  const path = `${o.bin}:/usr/bin:/bin`;
  const env: NodeJS.ProcessEnv = {
    HOME: o.home,
    PATH: path,
    SHELL: '/bin/sh',
    XDG_CONFIG_HOME: join(o.home, '.config'),
    DEEP_HUB_TEST_CONFIRM: join(dirname(o.home), 'confirm'),
  };
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dirname(o.home), env, encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL' });
  // The checkout's path is cut out of what is shown, its real path first, which may hold the other.
  const plain = (text: string): string => [real(CHECKOUT), CHECKOUT].reduce((t, root) => t.replaceAll(root, '<checkout>'), text);
  const quoted = (label: string, text: string): string => (text.trim() ? `${label}:\n${plain(text).trimEnd().split('\n').map((line) => `  | ${line}`.trimEnd()).join('\n')}` : `${label}: nothing`);
  const shown = [
    `$ HOME=${o.home} PATH=${path} deep ${args.join(' ')}`,
    `exit ${r.status ?? r.signal ?? r.error?.message}`,
    quoted('stdout', r.stdout ?? ''),
    quoted('stderr', r.stderr ?? ''),
    quoted('the launchctl stand-in logged', calls(o.bin, 'launchctl').join('\n')),
    quoted('the systemctl stand-in logged', calls(o.bin, 'systemctl').join('\n')),
    // A closing line of its own: the test runner appends what it expected to a message's last line.
    '(end of the run)',
  ].join('\n');
  if (r.status === null) throw Error(`BLOCKED: deep ${args.join(' ')} did not run to its end\n${shown}`);
  // A half-built checkout fails to load a module: that is no answer of the command's, on the base or anywhere.
  if (r.stderr.includes('ERR_MODULE_NOT_FOUND')) throw Error(`BLOCKED: this checkout is not fully built; run npm run build --workspaces first\n${shown}`);
  return { code: r.status, stderr: plain(r.stderr), shown };
}

/**
 * A plist as launchd reads it, parsed by macOS's own `plutil`: `ok` false when it is no property list. BLOCKED where
 * `plutil` itself can't be run.
 */
export function readPlist(file: string): { ok: boolean; said: string; value: Record<string, unknown> } {
  const r = spawnSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' });
  if (r.error || r.status === null) throw Error(`BLOCKED: /usr/bin/plutil could not be run to read ${file}: ${r.error?.message ?? r.signal}`);
  if (r.status !== 0) return { ok: false, said: `${r.stdout}${r.stderr}`.trim(), value: {} };
  return { ok: true, said: '', value: JSON.parse(r.stdout) as Record<string, unknown> };
}

/** The `*.service` files under a folder, at any depth: the systemd units a command wrote into a home that began empty. */
export function units(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return units(path);
    return entry.isFile() && entry.name.endsWith('.service') ? [path] : [];
  });
}
/**
 * The variables a systemd unit's `[Service]` section sets with `Environment=`, read as systemd.exec(5) does: every
 * such line adds assignments, an empty one resets the list, items are separated by white space, an item or its value
 * may be in double or single quotes, and inside double quotes a backslash escapes the next character.
 */
export function unitEnvironment(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (/^\[.+\]$/.test(line)) section = line;
    const value = section === '[Service]' ? /^Environment\s*=(.*)$/.exec(line)?.[1]?.trim() : undefined;
    if (value === undefined) continue;
    if (value === '') { for (const key of Object.keys(env)) delete env[key]; continue; }
    for (const [item] of value.matchAll(/(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s"'])+/g)) {
      const plain = item.replace(/"((?:\\.|[^"\\])*)"|'([^']*)'/g, (_all, double: string | undefined, single: string | undefined) => (double !== undefined ? double.replace(/\\(.)/g, '$1') : single ?? ''));
      const at = plain.indexOf('=');
      if (at > 0) env[plain.slice(0, at)] = plain.slice(at + 1);
    }
  }
  return env;
}
