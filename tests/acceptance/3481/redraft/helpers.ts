// Test-side tools for #3481 AC1's blind redraft: the app built from the checkout, an app home of its own, and a run of
// `deep-app` with that home. Nothing here stands in for DeepBuild: the hub is the built CLI's `deep hub run`
// (packages/hub/test/hub.ts, `withHub`), and the app is the built `deep-app`.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
const BIN = join(REPO, 'target', 'acceptance-3481-redraft');

/** The app runs on macOS only (its window's dependencies); elsewhere the test can't run, which is BLOCKED, never a pass. */
export function onMac(): void {
  if (process.platform !== 'darwin') throw Error(`BLOCKED: deep-app builds and runs on macOS only; this is ${process.platform}`);
}

/** The built CLI the hub runs from; missing, the test is BLOCKED. */
export function cliBuilt(): void {
  if (!existsSync(CLI)) throw Error(`BLOCKED: ${CLI} is missing; run npm run build --workspaces first`);
}

// ---- Processes this suite started, stopped by PID only.
const owned = new Set<number>();
const made: string[] = [];
export function cleanup(): void {
  for (const pid of owned) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; timedOut: boolean }
export function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, o.timeoutMs);
    child.on('error', (error) => { stderr += `\n[spawn failed: ${error.message}]`; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (child.pid) owned.delete(child.pid);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at the timeout' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;

// ---- The app, as `cargo build --locked -p deep-app --bin deep-app` builds it from the checkout, copied out of target/debug.
let built: Promise<string> | undefined;
export function appBinary(): Promise<string> {
  built ??= (async () => {
    onMac();
    const env = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` };
    const r = await run(join(REPO, 'scripts/lease'), ['cargo', 'build', '--locked', '-q', '-p', 'deep-app', '--bin', 'deep-app'], { cwd: REPO, env, timeoutMs: 3_000_000 });
    if (r.code !== 0) throw Error(`BLOCKED: deep-app didn't build: ${r.stderr.slice(-3000)}`);
    mkdirSync(BIN, { recursive: true });
    const out = join(BIN, 'deep-app');
    const part = `${out}.${process.pid}.part`;
    copyFileSync(join(REPO, 'target/debug/deep-app'), part);
    chmodSync(part, 0o755);
    renameSync(part, out);
    return out;
  })();
  return built;
}

// ---- The app's own home.
export interface AppHome { home: string; root: string; token: string }
/**
 * A home of the app's own at `/tmp/da3481-*` (short: a socket path must fit in 104 bytes): `~/.deepbuild/control.token`
 * holds a fresh random token, mode 0600, and `~/.deepbuild/config.json` says `{"hub":{"address":"unix:<socket>"}}`, the
 * address the app reads (crates/deep-app/src/hub.rs), so the app reaches the hub at `socket` while presenting the token
 * in its own home.
 */
export function appHome(socket: string): AppHome {
  const home = realpathSync(mkdtempSync('/tmp/da3481-'));
  made.push(home);
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  const token = randomBytes(32).toString('base64url');
  writeFileSync(join(root, 'control.token'), `${token}\n`, { mode: 0o600 });
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ hub: { address: `unix:${socket}` } })}\n`);
  return { home, root, token };
}
export const tokenAt = (root: string) => readFileSync(join(root, 'control.token'), 'utf8').trim();

/** The environment the app gets: HOME the app's home, and no DEEP_, XDG_, CLAUDE*, CODEX*, GIT_ or npm_ variable of this process's. */
export function appEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|npm_|ANTHROPIC_|OPENAI_)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  env.HOME = home;
  env.LC_ALL = 'C';
  return env;
}

/** The first line the hub writes on a fresh connection to `socket`: its hello. Proves the hub answers at that address. */
export function helloAt(socket: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const s = net.connect(socket);
    let got = '';
    const timer = setTimeout(() => { s.destroy(); reject(Error(`no hello from ${socket} within 10 s`)); }, 10_000);
    s.setEncoding('utf8').on('data', (d: string) => {
      got += d;
      const i = got.indexOf('\n');
      if (i >= 0) { clearTimeout(timer); s.destroy(); resolve(JSON.parse(got.slice(0, i)) as Record<string, unknown>); }
    });
    s.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
