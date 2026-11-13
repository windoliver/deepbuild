// Test-side tools for issue #2203's acceptance tests (README.md): this suite's own folders, under a temp folder and
// outside every temp folder; an empty home; stand-ins for the service managers and for a named launcher, each logging
// its calls; and the built `deep` CLI run as a child process. Nothing here stands in for DeepBuild: a test reaches it
// through the CLI alone and reads its exit code, its stderr and what the stand-ins logged. No stand-in starts a
// program, so no test leaves a process behind.
import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout this file is in, wherever it sits. Its packages/cli/dist/main.js is the `deep` every test runs. */
const CHECKOUT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const CLI = join(CHECKOUT, 'packages/cli/dist/main.js');
const real = (path: string): string => { try { return realpathSync(path); } catch { return path; } };

/** What every test needs: macOS, whose service manager is launchd, and the built CLI. Without one it is BLOCKED, never a pass. */
export function needs(): void {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: #2203's criteria are macOS's, where the service manager is launchd and its command launchctl; this is ${process.platform}`);
  if (!existsSync(CLI)) throw Error('BLOCKED: this checkout has no built CLI at packages/cli/dist/main.js; run npm run build --workspaces first');
}
/** Setup's hook entries name the built deep-hook. With none, setup stops before its hub start: a child here has no cargo to build one with. */
export function needHook(): void {
  if (!['release', 'debug'].some((build) => existsSync(join(CHECKOUT, 'target', build, 'deep-hook')))) throw Error('BLOCKED: this checkout has no deep-hook built under target/, so setup stops before it starts the hub; run cargo build --locked -p deep-hook first');
}

/** The temp folders as `deep doctor` lists them at the base (packages/hub/src/doctor.ts, its hub.service item): each as written and by its real path. */
const TEMPS = [tmpdir(), process.env.TMPDIR ?? '', '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].filter(Boolean).flatMap((t) => [t, real(t)]).map((t) => (t.endsWith(sep) ? t : t + sep));
const underTemp = (path: string): boolean => TEMPS.some((t) => path.startsWith(t) || real(path).startsWith(t));

// ---- This suite's own folders, removed at the end. Short real paths: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
/** A folder under a temp folder: /private/tmp/dh2203-*, where the issue saw the leaked hub's home (/private/tmp/dh667-*). */
export function tempFolder(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh2203-'));
  made.push(dir);
  return dir;
}
/**
 * A folder outside every temp folder: /Users/Shared/dh2203-*, readable by this user alone (README: Where the folders
 * are). BLOCKED where it can't be made, or where this run counts it as a temp folder.
 */
export function realFolder(): string {
  let dir: string;
  try {
    dir = realpathSync(mkdtempSync('/Users/Shared/dh2203-'));
  } catch (error) {
    throw Error(`BLOCKED: no folder outside every temp folder could be made under /Users/Shared: ${error instanceof Error ? error.message : String(error)}`);
  }
  made.push(dir);
  if (underTemp(dir)) throw Error(`BLOCKED: ${dir} is under a temp folder in this run (TMPDIR is ${process.env.TMPDIR ?? 'unset'}), so no home or launchctl there is outside every temp folder`);
  return dir;
}
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * An empty home, `<dir>/h`: nothing of DeepBuild is in it, no `.deepbuild` either. `<dir>/confirm` answers `cancelled`
 * for the OS confirming you (DEEP_HUB_TEST_CONFIRM, #24's seam), so setup sets up no Secure Enclave key and nothing a
 * command asks you to confirm goes through.
 */
export function homeIn(dir: string): string {
  const home = join(dir, 'h');
  mkdirSync(home);
  writeFileSync(join(dir, 'confirm'), 'cancelled\n');
  return home;
}

/**
 * A stand-in program at `file`: it appends its name and its arguments to `<file>.log`, loads and starts nothing, and
 * exits 1, as a service manager that couldn't load the job does. Returns `file`.
 */
export function standIn(file: string): string {
  writeFileSync(file, `#!/bin/sh\nprintf '%s %s\\n' '${basename(file)}' "$*" >> '${file}.log'\nexit 1\n`);
  chmodSync(file, 0o755);
  return file;
}
/** `<dir>/bin` with `launchctl` and `systemctl` stand-ins: the folder a child gets first on PATH. */
export function standIns(dir: string): string {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl']) standIn(join(bin, name));
  return bin;
}
/** What a stand-in was asked to do, one line a call: its name, then its arguments. */
export const calls = (file: string): string[] => (existsSync(`${file}.log`) ? readFileSync(`${file}.log`, 'utf8').split('\n').filter(Boolean) : []);
/** The `launchctl bootstrap` calls the stand-in in `bin` logged. */
export const bootstraps = (bin: string): string[] => calls(join(bin, 'launchctl')).filter((call) => call.startsWith('launchctl bootstrap '));
/** The hub's launchd definition in a home, as the base writes it and hands it to `launchctl bootstrap`. */
export const plist = (home: string): string => join(home, 'Library', 'LaunchAgents', 'com.deepbuild.hub.plist');

export interface Ran { code: number; stderr: string; shown: string }
/**
 * `deep <args>` run to its end as a child process: the built CLI under this Node, in the folder that holds the home.
 * Its environment is only this: HOME `home`; PATH `bin`, then /usr/bin and /bin, so the stand-ins in `bin` come first
 * and no agent or cargo is found; SHELL /bin/sh; the stubbed OS confirmation; and DEEP_HUB_LAUNCHER only when a
 * `launcher` is named. `shown` is the command, its exit code, its output and what the stand-ins logged, each output
 * line quoted, so none reads as a frame of a test's own stack.
 */
export function deep(o: { home: string; bin: string; launcher?: string }, ...args: string[]): Ran {
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
    ...(o.launcher ? { DEEP_HUB_LAUNCHER: o.launcher } : {}),
  };
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dirname(o.home), env, encoding: 'utf8', timeout: 120_000, killSignal: 'SIGKILL' });
  // The checkout's path is cut out of what is shown, its real path first, which may hold the other.
  const plain = (text: string): string => [real(CHECKOUT), CHECKOUT].reduce((t, root) => t.replaceAll(root, '<checkout>'), text);
  const quoted = (label: string, text: string): string => (text.trim() ? `${label}:\n${plain(text).trimEnd().split('\n').map((line) => `  | ${line}`.trimEnd()).join('\n')}` : `${label}: nothing`);
  const shown = [
    `$ HOME=${o.home} PATH=${path}${o.launcher ? ` DEEP_HUB_LAUNCHER=${o.launcher}` : ''} deep ${args.join(' ')}`,
    `exit ${r.status ?? r.signal ?? r.error?.message}`,
    quoted('stdout', r.stdout ?? ''),
    quoted('stderr', r.stderr ?? ''),
    quoted('the launchctl stand-in logged', calls(join(o.bin, 'launchctl')).join('\n')),
    ...(o.launcher ? [quoted('the launcher logged', calls(o.launcher).join('\n'))] : []),
    // A closing line of its own: the test runner appends what it expected to a message's last line.
    '(end of the run)',
  ].join('\n');
  if (r.status === null) throw Error(`BLOCKED: deep ${args.join(' ')} did not run to its end\n${shown}`);
  // A half-built checkout fails to load a module: that is no answer of the command's, on the base or anywhere.
  if (r.stderr.includes('ERR_MODULE_NOT_FOUND')) throw Error(`BLOCKED: this checkout is not fully built; run npm run build --workspaces first\n${shown}`);
  return { code: r.status, stderr: plain(r.stderr), shown };
}
