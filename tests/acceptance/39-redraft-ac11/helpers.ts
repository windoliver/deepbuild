// Test-side tools for issue #39's AC11 (blind redraft): a temporary home with stand-ins for launchctl, systemctl,
// claude and codex; `deep setup` through the built CLI; a small disk image whose only writable folder is the dotfiles
// folder. Nothing here stands in for DeepBuild. fixtures/launchd.mjs is copied unchanged from
// tests/acceptance/19/setup/fixtures (same repo, same license).

import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const LAUNCHD = fileURLToPath(new URL('./fixtures/launchd.mjs', import.meta.url));
const NODE = process.execPath;

export interface Ran { code: number | null; stdout: string; stderr: string; timedOut: boolean }
function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string, timeoutMs: number): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1200))}, stderr ${JSON.stringify(r.stderr.slice(0, 1200))}`;

// ---- Prerequisites: each missing one is BLOCKED, never a pass.
export async function prerequisites(): Promise<void> {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: this test stands in for launchd and mounts a disk image with hdiutil; on ${process.platform} it can't run`);
  if (process.getuid?.() === 0) throw Error('BLOCKED: as root a read-only folder refuses nothing, so the proof would be empty');
  if (!existsSync(CLI)) throw Error(`BLOCKED: ${CLI} is not built; run npm run build --workspaces`);
  const built = await run('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], process.env, REPO, 1_200_000);
  if (built.code !== 0) throw Error(`BLOCKED: cargo build -p deep-hook failed: ${shown(built)}`);
}

// ---- Temporary places, undone in reverse by cleanup. Short paths: a Unix socket path must fit in 104 bytes on macOS.
const undo: (() => void | Promise<void>)[] = [];
function tempDir(): string {
  const dir = mkdtempSync('/private/tmp/ac11-');
  undo.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/** Hands a folder back to its owner at cleanup, so a read-only folder can be removed. */
export const restoreAtCleanup = (dir: string) => undo.push(() => chmodSync(dir, 0o755));
const hubs: string[] = [];
/** Stops the hubs first, so none holds a file on the disk image, then undoes the rest in reverse. */
export async function cleanup(): Promise<void> {
  for (const bin of hubs.splice(0)) await stopHubs(bin);
  for (const step of undo.splice(0).reverse()) await step();
}

const COVERED = (() => {
  const { versions } = JSON.parse(readFileSync(join(REPO, 'adapters/codex.facts.json'), 'utf8')) as { versions: string[] };
  const release = versions.filter((v) => !v.includes('-')).at(-1);
  if (!release) throw Error('BLOCKED: adapters/codex.facts.json covers no released Codex version');
  return release;
})();

export interface Home { tmp: string; home: string; bin: string; codex: string }
/**
 * `<tmp>/h` is HOME and `<tmp>/h/.codex` the Codex home. `<tmp>/bin` comes first on PATH: launchctl runs the launchd
 * stand-in; codex and claude answer --version with a covered version and exit 0 on all else; systemctl exits 0;
 * sh-login is the login shell, which reads no profile of this machine.
 */
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  const codex = join(home, '.codex');
  mkdirSync(codex, { recursive: true });
  mkdirSync(bin);
  const script = (name: string, lines: string[]) => { writeFileSync(join(bin, name), `#!/bin/sh\n${lines.join('\n')}\n`); chmodSync(join(bin, name), 0o755); };
  const claudeFacts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] };
  script('codex', [`[ "$1" = --version ] && echo 'codex-cli ${COVERED}'`, 'exit 0']);
  script('claude', [`[ "$1" = --version ] && echo '${claudeFacts.versions.at(-1)} (Claude Code)'`, 'exit 0']);
  script('systemctl', ['exit 0']);
  script('launchctl', [`exec '${NODE}' '${LAUNCHD}' '${join(bin, 'launchd')}' "$@"`]);
  script('sh-login', [
    `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
  ]);
  hubs.push(bin);
  return { tmp, home, bin, codex };
}

/** Stops, by PID only, what the launchd stand-in started for this home: SIGTERM, then SIGKILL after 3 s. */
async function stopHubs(bin: string): Promise<void> {
  const file = join(bin, 'launchd', 'started.pids');
  if (!existsSync(file)) return;
  const pids = readFileSync(file, 'utf8').split('\n').map(Number).filter((n) => n > 0);
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const signal = (pid: number, name: NodeJS.Signals) => { try { process.kill(pid, name); } catch { /* gone */ } };
  for (const pid of pids) signal(pid, 'SIGTERM');
  const deadline = Date.now() + 3000;
  while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  for (const pid of pids) signal(pid, 'SIGKILL');
}

/** `deep setup` through the built CLI, in the temp folder, with none of this process's DeepBuild or agent variables. */
export function deepSetup(h: Home): Promise<Ran> {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|ANTHROPIC_|OPENAI_|AWS_)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  Object.assign(env, {
    HOME: h.home,
    CODEX_HOME: h.codex,
    XDG_CONFIG_HOME: join(h.home, '.config'),
    XDG_CACHE_HOME: join(h.home, '.cache'),
    SHELL: join(h.bin, 'sh-login'),
    PATH: `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    LC_ALL: 'C',
  });
  return run(NODE, [CLI, 'setup'], env, h.tmp, 180_000);
}

/**
 * Mounts a small private disk image at `<tmp>/vol`: a filesystem of its own, so a rename into it from anywhere else
 * fails with EXDEV. `vol/dotfiles` is made, then the volume's root is made read-only: the dotfiles folder is the one
 * place on this filesystem where a new file can be made. Detached at cleanup.
 */
export function mountDotfiles(tmp: string): string {
  const image = join(tmp, 'vol.dmg');
  const mount = join(tmp, 'vol');
  try {
    execFileSync('hdiutil', ['create', '-quiet', '-size', '8m', '-fs', 'HFS+', '-volname', 'ac11', image], { stdio: 'pipe' });
    execFileSync('hdiutil', ['attach', '-quiet', '-nobrowse', '-owners', 'on', '-mountpoint', mount, image], { stdio: 'pipe' });
  } catch (error) {
    throw Error(`BLOCKED: can't mount a disk image for the dotfiles folder: ${(error as Error).message}`);
  }
  undo.push(() => {
    try { execFileSync('hdiutil', ['detach', '-quiet', mount], { stdio: 'pipe' }); } catch { execFileSync('hdiutil', ['detach', '-quiet', '-force', mount], { stdio: 'pipe' }); }
  });
  const dotfiles = join(mount, 'dotfiles');
  mkdirSync(dotfiles);
  chmodSync(mount, 0o555);
  undo.push(() => chmodSync(mount, 0o755));
  return dotfiles;
}
