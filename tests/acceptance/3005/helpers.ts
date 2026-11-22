// Test-side tools for the #3005 acceptance tests: a real hub (`deep hub run`, this checkout's build) whose home is
// either under a symlink this file makes or spelled by its real path, and `deep install <folder>` run against it as
// you, the stubbed OS confirming (DEEP_HUB_TEST_CONFIRM, as docs/evidence/2629/e2e.sh and suite 154 do).
//
// Safety: every folder is under /tmp/dh3005-* (its real path) or the link beside it, both removed after the file; the
// hub and `deep` run with HOME and TMPDIR in that folder and without the caller's DEEP_*, CLAUDE*, CODEX*,
// NODE_OPTIONS; nothing leaves the machine; every process is one this file started, stopped by its PID.
import { spawn } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect } from 'vitest';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const NODE = process.execPath;
/** A hub start plus one install whose tool qualifies at install, on a loaded machine. */
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs's criterionId over the criterion's text), which starts its tests' names. */
export const AC = {
  1: '#3005.a1f4670f',
  2: '#3005.ae03f3f2',
  3: '#3005.c0a2e167',
} as const;

export const IMPORT = join(REPO, 'packages/jobs/import');
export const TYPESET = join(REPO, 'packages/jobs/typeset');

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const made: string[] = [];
const owned = new Set<number>();
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
afterAll(async () => {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 10_000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(100);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const path of made.splice(0).reverse()) rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}, 60_000);

export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran): string => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;

function childEnv(home: string, tmp: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT|TMUX)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, TMPDIR: tmp, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}

export interface World { base: string; home: string; work: string; hub: number }

/**
 * A hub whose home is `<base>/h`. `symlinked`: base is a symlink this file makes to a real temp folder, so the home's
 * path runs through it (on any OS, not relying on /tmp being a link); otherwise base is that folder's real path.
 */
export async function openWorld(symlinked: boolean): Promise<World> {
  const real = realpathSync(mkdtempSync('/tmp/dh3005-'));
  made.push(real);
  let base = real;
  if (symlinked) {
    base = `${real}-link`;
    symlinkSync(real, base);
    made.push(base);
  }
  const home = join(base, 'h');
  const work = join(base, 'work');
  mkdirSync(home);
  mkdirSync(work);
  // The home is spelled as the criterion asks: through a link, or by its real path.
  expect(lstatSync(base).isSymbolicLink(), `setup: ${base} is ${symlinked ? '' : 'not '}a symlink`).toBe(symlinked);
  expect(realpathSync(home) === home, `setup: the hub home ${home} is ${symlinked ? 'not ' : ''}its own real path`).toBe(!symlinked);
  writeFileSync(join(base, 'confirm'), 'confirmed\n');
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, base, { DEEP_HUB_TEST_CONFIRM: join(base, 'confirm') }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 300_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); try { resolve(JSON.parse(out.split('\n')[0]!).ready === true); } catch { resolve(false); } }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  expect(ready, `setup: the hub starts (deep hub run): ${out.slice(0, 500)} ${err.slice(-1500)}`).toBe(true);
  return { base, home, work, hub: child.pid! };
}

/** `deep install <folder>` as you, against the world's hub. */
export function install(w: World, folder: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, 'install', folder], { cwd: w.work, env: childEnv(w.home, w.base), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT - 60_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); if (child.pid) owned.delete(child.pid); resolve({ code, stdout, stderr }); });
  });
}

/** The install printed that `id@version` is installed and exited 0, as e2e.sh's runs show ("Installed <id>@<version>"). */
export function expectInstalled(r: Ran, folder: string, ref: string): void {
  expect(r.code, `deep install ${folder} exits 0: ${shown(r)}`).toBe(0);
  expect(`${r.stdout}\n${r.stderr}`, `deep install ${folder} prints that ${ref} is installed: ${shown(r)}`).toMatch(new RegExp(`\\bInstalled ${ref.replace(/[./@]/g, '\\$&')}\\b`));
}
