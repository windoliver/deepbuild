// Test-side tools for issue #2119's acceptance tests (README.md): this suite's own folders; a home with nothing of
// DeepBuild in it; stand-ins for the service managers, for a named launcher and for deep-hook, each logging its calls;
// the built `deep` CLI run as a child process; and the hub's own built modules run by a script in fixtures/, in a child
// process of its own. Nothing here stands in for DeepBuild: a test reaches it through the CLI or its built modules and
// reads what they wrote, printed or returned. No stand-in starts a program, so no test leaves a process behind.
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The checkout this file is in, wherever it sits: its packages/cli/dist/main.js is the `deep` every child runs. */
export const CHECKOUT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
const CLI = join(CHECKOUT, 'packages/cli/dist/main.js');
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const real = (path: string): string => { try { return realpathSync(path); } catch { return path; } };

/** The built CLI and hub, which every test runs. Without them a test is BLOCKED, never a pass. */
export function needs(): void {
  for (const file of [CLI, join(CHECKOUT, 'packages/hub/dist/index.js')]) {
    if (!existsSync(file)) throw Error(`BLOCKED: this checkout has no ${file.slice(CHECKOUT.length + 1)}; run npm run build --workspaces first`);
  }
}

/** The temp folders as `deep doctor` lists them at the base (packages/hub/src/paths.ts, underTemp): each as written and by its real path. */
const TEMPS = [tmpdir(), process.env.TMPDIR ?? '', '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'].filter(Boolean).flatMap((t) => [t, real(t)]).map((t) => (t.endsWith(sep) ? t : t + sep));
export const underTemp = (path: string): boolean => TEMPS.some((t) => path.startsWith(t) || real(path).startsWith(t));
/** The first folder from `path`'s own up to `/` that holds `.git`, or undefined. */
export function gitAbove(path: string): string | undefined {
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return undefined;
  }
}

// ---- This suite's own folders, removed when a file ends. A run killed midway leaves them, and none is removed by name.
const made: string[] = [];
/** A folder under a temp folder, /private/tmp/dh2119-*, by its real path. */
export function tempFolder(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh2119-'));
  made.push(dir);
  return dir;
}
/**
 * A folder outside every temp folder and every git folder, /Users/Shared/dh2119-*, readable by this user alone (README:
 * How the tests reach the code). BLOCKED where it can't be made, or where this run counts it as either.
 */
export function sharedFolder(): string {
  let dir: string;
  try {
    dir = realpathSync(mkdtempSync('/Users/Shared/dh2119-'));
  } catch (error) {
    throw Error(`BLOCKED: no folder outside every temp folder could be made under /Users/Shared: ${error instanceof Error ? error.message : String(error)}`);
  }
  made.push(dir);
  if (underTemp(dir)) throw Error(`BLOCKED: ${dir} is under a temp folder in this run (TMPDIR is ${process.env.TMPDIR ?? 'unset'})`);
  const git = gitAbove(join(dir, 'x'));
  if (git) throw Error(`BLOCKED: ${dir} is in a git folder, ${git}`);
  return dir;
}
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * An empty home, `<dir>/h`. `<dir>/confirm` answers `cancelled` for the OS confirming you (DEEP_HUB_TEST_CONFIRM, as
 * other suites set it), so setup sets up no Secure Enclave key.
 */
export function homeIn(dir: string): string {
  const home = join(dir, 'h');
  mkdirSync(home);
  writeFileSync(join(dir, 'confirm'), 'cancelled\n');
  return home;
}

/** A stand-in program at `file`: it appends its arguments to `<file>.log`, loads and starts nothing, and exits 1. */
export function standIn(file: string): string {
  writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${file}.log'\nexit 1\n`);
  chmodSync(file, 0o755);
  return file;
}
/** What a stand-in was asked to do, one line a call: its arguments. */
export const calls = (file: string): string[] => (existsSync(`${file}.log`) ? readFileSync(`${file}.log`, 'utf8').split('\n').filter(Boolean) : []);

/**
 * deep-hook as npm installs it (packages/hub/src/paths.ts, deepHook): this platform's package,
 * `@deepbuild/deep-hook-<platform>-<arch>`, with the program in its `bin` folder, under `<dir>/node_path`, the folder a
 * child's NODE_PATH names. The checkout holds no such package, so Node's resolution from its package.json falls back to
 * NODE_PATH, and setup takes the stand-in before any build under target/, which it then never builds. Each call appends
 * its arguments to `<program>.log`. Asked for `--help`, as setup asks to learn whether a build serves deep-actions, it
 * first runs `onHelp`, a line of shell, then prints a usage that names `mcp actions`. It does nothing else.
 */
export function standInHook(dir: string, onHelp = ':'): { nodePath: string; program: string } {
  const nodePath = join(dir, 'node_path');
  const name = `@deepbuild/deep-hook-${process.platform}-${process.arch}`;
  const pkg = join(nodePath, name);
  mkdirSync(join(pkg, 'bin'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), `${JSON.stringify({ name, version: '0.0.0' })}\n`);
  const program = join(pkg, 'bin', 'deep-hook');
  writeFileSync(program, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${program}.log'\nif [ "$1" = --help ]; then\n  ${onHelp}\n  echo 'Usage: deep-hook claude <event> | codex <event> | statusline | waiter | mcp actions'\nfi\nexit 0\n`);
  chmodSync(program, 0o755);
  return { nodePath, program };
}

/** A child's folders: its home, the folder of stand-ins first on its PATH, the launcher it names and, for setup, where deep-hook is found. */
export interface Child { home: string; bin: string; launcher: string; nodePath?: string; codexHome?: string }
/**
 * `<dir>/bin`, with `launchctl` and `systemctl` stand-ins, and `<dir>/launcher`, the stand-in a child names as
 * DEEP_HUB_LAUNCHER: every child gets both, so no service manager of the machine is reached.
 */
export function child(dir: string, home: string, more: Partial<Child> = {}): Child {
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  for (const name of ['launchctl', 'systemctl']) standIn(join(bin, name));
  return { home, bin, launcher: standIn(join(dir, 'launcher')), ...more };
}

export interface Ran { code: number | null; stdout: string; stderr: string; shown: string }
/** The checkout's path cut out of a text, its real path first, which may hold the other. */
export const plain = (text: string): string => [real(CHECKOUT), CHECKOUT].reduce((t, root) => t.replaceAll(root, '<checkout>'), text);
const quoted = (label: string, text: string): string => (text.trim() ? `${label}:\n${plain(text).trimEnd().split('\n').map((line) => `  | ${line}`.trimEnd()).join('\n')}` : `${label}: nothing`);
/** A program run to its end, under a timeout that kills it by its PID. */
function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string; why?: string }> {
  return new Promise((done) => {
    const proc = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    proc.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    const timer = setTimeout(() => proc.kill('SIGKILL'), 300_000);
    proc.on('error', (error) => { clearTimeout(timer); done({ code: null, stdout, stderr, why: error.message }); });
    proc.on('close', (code, signal) => { clearTimeout(timer); done({ code, stdout, stderr, ...(signal ? { why: `killed by ${signal}` } : {}) }); });
  });
}

/**
 * `deep <args>` run to its end as a child process: the built CLI under this Node, in the folder that holds the home.
 * Its environment is only this: HOME; PATH, the stand-ins' folder, then /usr/bin and /bin, so no agent, cargo or real
 * service manager is found; SHELL /bin/sh; XDG_CONFIG_HOME in the home; the stubbed OS confirmation; DEEP_HUB_LAUNCHER;
 * DEEP_DOCTOR_CANVAS_FAULT=render_skipped, which only doctor reads, so it skips its headless render; and, where given,
 * NODE_PATH and CODEX_HOME. No variable of the runner's reaches it.
 */
export async function deep(o: Child, ...args: string[]): Promise<Ran> {
  // No child runs outside this run's folders: the real home, and the real service manager, are never reached.
  for (const place of [o.home, o.bin, o.launcher, ...(o.nodePath ? [o.nodePath] : []), ...(o.codexHome ? [o.codexHome] : [])]) {
    if (!made.some((dir) => place.startsWith(dir + sep))) throw Error(`BLOCKED: ${place} is in no folder this run made`);
  }
  const env: NodeJS.ProcessEnv = {
    HOME: o.home,
    PATH: `${o.bin}:/usr/bin:/bin`,
    SHELL: '/bin/sh',
    XDG_CONFIG_HOME: join(o.home, '.config'),
    DEEP_HUB_TEST_CONFIRM: join(dirname(o.home), 'confirm'),
    DEEP_HUB_LAUNCHER: o.launcher,
    DEEP_DOCTOR_CANVAS_FAULT: 'render_skipped',
    ...(o.nodePath ? { NODE_PATH: o.nodePath } : {}),
    ...(o.codexHome ? { CODEX_HOME: o.codexHome } : {}),
  };
  const r = await run(process.execPath, [CLI, ...args], dirname(o.home), env);
  const shown = [
    `$ HOME=${o.home}${o.codexHome ? ` CODEX_HOME=${o.codexHome}` : ''}${o.nodePath ? ` NODE_PATH=${o.nodePath}` : ''} deep ${args.join(' ')}`,
    `exit ${r.code ?? r.why}`,
    quoted('stdout', r.stdout),
    quoted('stderr', r.stderr),
  ].join('\n');
  if (r.code === null) throw Error(`BLOCKED: deep ${args.join(' ')} did not run to its end\n${shown}`);
  // A half-built checkout fails to load a module: that is no answer of the command's, on the base or anywhere.
  if (r.stderr.includes('ERR_MODULE_NOT_FOUND')) throw Error(`BLOCKED: this checkout is not fully built; run npm run build --workspaces first\n${shown}`);
  return { code: r.code, stdout: r.stdout, stderr: r.stderr, shown };
}

/** One of `deep doctor --json`'s items, doctor.item@1. */
export interface Item { item: string; agent: string; code: string; level: string; evidence: string; fix: string }
/** The items a `deep doctor --json` run printed, one JSON object a line. */
export function items(r: Ran): Item[] {
  return r.stdout.split('\n').flatMap((line) => {
    try {
      const value = JSON.parse(line) as Item;
      return typeof value?.item === 'string' ? [value] : [];
    } catch {
      return [];
    }
  });
}

/**
 * A script of fixtures/ run to its end in a child process, given the checkout and `args`, with HOME `home` and a PATH of
 * /usr/bin and /bin alone: the hub's built modules, loaded and called as the script says. Its last line of output is
 * its JSON answer.
 */
export async function script<T>(name: string, args: string[], home: string): Promise<{ out: T; shown: string }> {
  if (!made.some((dir) => home.startsWith(dir + sep))) throw Error(`BLOCKED: ${home} is in no folder this run made`);
  const r = await run(process.execPath, [join(FIXTURES, name), CHECKOUT, ...args], dirname(home), { HOME: home, PATH: '/usr/bin:/bin' });
  // A long argument, a record as JSON, is named by its size: the test's own message shows what it holds.
  const shown = [`$ HOME=${home} node fixtures/${name} <checkout> ${args.map((a) => (a.length > 100 ? `<${a.length} bytes of JSON>` : a)).join(' ')}`, `exit ${r.code ?? r.why}`, quoted('stdout', r.stdout), quoted('stderr', r.stderr)].join('\n');
  const last = r.stdout.trim().split('\n').at(-1) ?? '';
  try {
    if (r.code !== 0) throw Error(`exit ${r.code ?? r.why}`);
    return { out: JSON.parse(last) as T, shown };
  } catch {
    throw Error(`BLOCKED: fixtures/${name} gave no answer\n${shown}`);
  }
}
