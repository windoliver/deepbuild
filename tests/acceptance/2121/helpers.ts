// Real CLI/hub, isolated homes; reuse #148's socket, event, polling and local-git utilities.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect } from 'vitest';
import { CLI, DEEP_HOOK, SETTINGS, call, waitFor, syncReaches, type Line, type World } from '../148/helpers.ts';
export { call, waitFor, syncReaches, askOf, events, gitRepo, commitMore, type Line } from '../148/helpers.ts';
export const preload = fileURLToPath(new URL('./power-cut.cjs', import.meta.url));
const worlds: World[] = [];
const children = new Set<ChildProcess>();
export const bare = (id: string) => id.replace(/^[a-z]+:/, '');
export const staged = (w: World, p: Line) => join(w.root, 'agents/staged', bare(p.sync));
export const config = (w: World) => join(w.home, '.claude.json');
export const bytes = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : null;
export const server = (name: string) => ({ name, transport: 'stdio', command: process.execPath, args: ['-e', `console.log(${JSON.stringify(`started:${name}`)})`] });
export function world(): World {
  if (!existsSync(CLI) || !existsSync(DEEP_HOOK)) throw Error('BLOCKED: build this checkout with npm run build --workspaces and cargo build --locked -p deep-hook first');
  const tmp = realpathSync(mkdtempSync('/tmp/ac2121-'));
  const w: World = { tmp, home: join(tmp, 'home'), root: join(tmp, 'home/.deepbuild'), bin: join(tmp, 'bin'), path: '', work: join(tmp, 'work'), logs: join(tmp, 'logs'), confirm: join(tmp, 'confirm'), secrets: join(tmp, 'secrets.json'), restarts: join(tmp, 'restarts') };
  w.path = `${w.bin}:/usr/bin:/bin`;
  for (const d of [w.home, w.root, w.bin, w.work, w.logs]) mkdirSync(d, { recursive: true });
  writeFileSync(w.confirm, 'confirmed\n');
  writeFileSync(join(w.root, 'config.json'), JSON.stringify({ asks: SETTINGS, runner: { login_path: w.path } }));
  worlds.push(w);
  return w;
}
function launch(w: World, args: string[], extra: Record<string, string> = {}) {
  const child = spawn(process.execPath, [CLI, ...args], { cwd: w.work, env: { HOME: w.home, PATH: w.path, TMPDIR: w.tmp, LC_ALL: 'C', DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9', ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', d => { stdout += d; });
  child.stderr.setEncoding('utf8').on('data', d => { stderr += d; });
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => { children.delete(child); resolve({ code, stdout, stderr }); });
  });
  return { child, done, stdout: () => stdout, stderr: () => stderr };
}
export async function start(w: World, extra: Record<string, string> = {}) {
  const r = launch(w, ['hub', 'run'], extra);
  await waitFor(() => r.stdout().includes('\n') || r.child.exitCode !== null || r.child.signalCode !== null, 30_000, 'hub ready');
  if (!r.stdout().includes('\n')) throw Error(`BLOCKED: hub startup: ${r.stderr()}`);
  const ready = JSON.parse(r.stdout().split('\n')[0]!);
  expect(ready.ready).toBe(true);
  w.hub = { pid: r.child.pid!, child: r.child, socket: ready.socket, exit: r.done.then(() => undefined), stderr: r.stderr };
}
export async function stop(w: World) {
  const h = w.hub;
  if (h && h.child.exitCode === null && h.child.signalCode === null) h.child.kill('SIGTERM');
  if (h) await h.exit;
  w.hub = undefined;
}
export async function deep(w: World, args: string[]) {
  const r = launch(w, args);
  const timer = setTimeout(() => r.child.kill('SIGKILL'), 30_000);
  try { return await r.done; } finally { clearTimeout(timer); }
}
export async function answer(w: World, p: Line, option = 'apply') {
  const r = await deep(w, ['inbox', 'answer', `ask:${bare(p.ask)}`, option]);
  expect(r, 'the OS-confirmed approval reaches the real hub').toMatchObject({ code: 0 });
}
export async function propose(w: World, params: Line) {
  const p = await call(w, 'agents.propose', { via: 'app', agents: ['claude-code'], ...params });
  expect(p).toMatchObject({ sync: expect.any(String), ask: expect.any(String), files: expect.any(Array) });
  return p;
}
export async function apply(w: World, p: Line) { await answer(w, p); await syncReaches(w, p.sync, ['complete']); }
export const skill = (dir: string, commit: string) => ({ skill: { repo: dir, commit, path: 'skills/notes' } });
export const skillTree = { 'skills/notes/SKILL.md': '# Notes\nKeep short notes.\n', 'skills/notes/run.sh': '#!/bin/sh\nprintf one\n' };
afterEach(async () => {
  for (const w of worlds) await stop(w);
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  children.clear();
  for (const w of worlds.splice(0)) rmSync(w.tmp, { recursive: true, force: true });
});
