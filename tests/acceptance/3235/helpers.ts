import { spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect } from 'vitest';
import { DEEP_HOOK, SETTINGS, call, events, waitFor, type Ev, type Line, type World } from '../148/helpers.ts';

export { call, commitMore, events, gitRepo, waitFor, type Ev, type Line, type World } from '../148/helpers.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const REASON = 'switches approval or checks off';
export const SKILL = 'shipnotes';
export const SKILL_PATH = `skills/${SKILL}`;

export const AC1 = '#3235.85af5de8';
export const AC2 = '#3235.7eeb122b';
export const AC3 = '#3235.72ad896b';
export const AC4 = '#3235.9456c23d';
export const AC5 = '#3235.ab296727';
export const AC6 = '#3235.cfb2d4cf';
export const AC7 = '#3235.56171bb6';
export const AC8 = '#3235.27b56b06';
export const AC9 = '#3235.8aac6e47';

export interface Checkout { root: string; cli: string }
export const checkoutAt = (root: string): Checkout => ({ root, cli: join(root, 'packages/cli/dist/main.js') });
export const HERE = checkoutAt(REPO);

const worlds: World[] = [];
const children = new Set<ChildProcess>();
export const bare = (handle: string): string => String(handle).replace(/^[a-z]+:/, '');

export function world(): World {
  if (!existsSync(HERE.cli) || !existsSync(DEEP_HOOK)) throw Error('BLOCKED: build this checkout with npm run build --workspaces and cargo build --locked --offline -p deep-hook first');
  const tmp = realpathSync(mkdtempSync('/tmp/ac3235-'));
  const w: World = { tmp, home: join(tmp, 'home'), root: join(tmp, 'home/.deepbuild'), bin: join(tmp, 'bin'), path: '', work: join(tmp, 'work'), logs: join(tmp, 'logs'), confirm: join(tmp, 'confirm'), secrets: join(tmp, 'secrets.json'), restarts: join(tmp, 'restarts') };
  w.path = `${w.bin}:/usr/bin:/bin`;
  for (const d of [w.home, w.root, w.bin, w.work, w.logs]) mkdirSync(d, { recursive: true });
  writeFileSync(w.confirm, 'confirmed\n');
  writeFileSync(join(w.root, 'config.json'), JSON.stringify({ asks: SETTINGS, runner: { login_path: w.path } }));
  worlds.push(w);
  return w;
}

export function putAgentOnPath(w: World, binary: string, version: string): void {
  const file = join(w.bin, binary);
  writeFileSync(file, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\nexit 0\n`);
  chmodSync(file, 0o755);
}

function launch(w: World, checkout: Checkout, args: string[]) {
  const child = spawn(process.execPath, [checkout.cli, ...args], { cwd: w.work, env: { HOME: w.home, PATH: w.path, TMPDIR: w.tmp, LC_ALL: 'C', DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_FORGE: 'http://127.0.0.1:9' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
  child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
  const done = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => { children.delete(child); resolve({ code, stdout, stderr }); });
  });
  return { child, done, stdout: () => stdout, stderr: () => stderr };
}

export async function start(w: World, checkout: Checkout = HERE): Promise<void> {
  const r = launch(w, checkout, ['hub', 'run']);
  await waitFor(() => r.stdout().includes('\n') || r.child.exitCode !== null || r.child.signalCode !== null, 60_000, 'hub ready');
  if (!r.stdout().includes('\n')) throw Error(`BLOCKED: the hub did not start: ${r.stderr()}`);
  const ready = JSON.parse(r.stdout().split('\n')[0]!) as Line;
  expect(ready.ready, 'the hub says it is ready').toBe(true);
  w.hub = { pid: r.child.pid!, child: r.child, socket: ready.socket, exit: r.done.then(() => undefined), stderr: r.stderr };
}

export async function stop(w: World): Promise<void> {
  const h = w.hub;
  if (h && h.child.exitCode === null && h.child.signalCode === null) h.child.kill('SIGTERM');
  if (h) await h.exit;
  w.hub = undefined;
}

export async function answer(w: World, ask: string, option: string): Promise<void> {
  const r = launch(w, HERE, ['inbox', 'answer', `ask:${bare(ask)}`, option]);
  const timer = setTimeout(() => r.child.kill('SIGKILL'), 60_000);
  const done = await r.done.finally(() => clearTimeout(timer));
  expect(done.code, `deep inbox answer ask:${bare(ask)} ${option} counts: ${done.stderr.slice(-800)}`).toBe(0);
}

export interface Proposal { sync: string; ask: string; files: Line[] }
export async function proposeSkill(w: World, repo: string, commit: string, agents: string[] = ['claude-code']): Promise<Proposal> {
  const p = await call(w, 'agents.propose', { via: 'app', agents, skill: { repo, commit, path: SKILL_PATH } });
  expect(typeof p.sync === 'string' && typeof p.ask === 'string', `agents.propose plans the skill and names its ask: ${JSON.stringify(p).slice(0, 600)}`).toBe(true);
  return p as Proposal;
}

export function textsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(textsIn);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(textsIn);
  return [];
}

export async function askCreated(w: World, ask: string): Promise<Ev> {
  return waitFor(async () => (await events(w)).find((e) => e.kind === 'ask.created' && e.id === bare(ask)), 30_000, `the ask.created of ${ask}`);
}

export async function cardOf(w: World, p: Proposal): Promise<string> {
  return textsIn((await askCreated(w, p.ask)).data).join('\n');
}

export async function syncStatus(w: World, sync: string): Promise<string | undefined> {
  const page = await call(w, 'agents.read', {});
  return (page.syncs as Line[] | undefined)?.find((s) => bare(String(s.id)) === bare(sync))?.status as string | undefined;
}

export async function syncReaches(w: World, sync: string, statuses: string[]): Promise<void> {
  await waitFor(async () => statuses.includes((await syncStatus(w, sync)) ?? ''), 60_000, `${sync} to be ${statuses.join(' or ')}`, 50);
}

export async function approve(w: World, p: Proposal): Promise<void> {
  await answer(w, p.ask, 'apply');
  await syncReaches(w, p.sync, ['complete']);
}

const escaped = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface Finding { file: string; line: number; text: string }
export function expectStopped(card: string, f: Finding, what: string): void {
  const named = `${what}: ${f.file} line ${f.line}, "${f.text}"`;
  expect.soft(card, `${named} is stopped for the reason "${REASON}"`).toContain(REASON);
  expect.soft(card, `${named}: the card quotes the line's text`).toContain(f.text);
  expect.soft(card, `${named}: the card names its file and its line number`).toMatch(new RegExp(`${escaped(f.file)}\\D{0,24}\\b${f.line}\\b`));
}

export function expectNotQuoted(card: string, f: Finding, what: string): void {
  expect.soft(card, `${what}: ${f.file} line ${f.line}, "${f.text}", is prose and no finding, but the card quotes it`).not.toContain(f.text);
}

export const skillTree = (files: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries({ 'SKILL.md': `---\nname: ${SKILL}\ndescription: Writes the release notes for each change you ship.\n---\n\nWrite a short entry for each change.\n`, ...files }).map(([rel, text]) => [`${SKILL_PATH}/${rel}`, text]));

export const script = (...lines: string[]): string => `#!/bin/sh\nset -e\n${lines.join('\n')}\n`;

export const installedDir = (w: World, agentFolder = '.claude/skills'): string => join(w.home, agentFolder, SKILL);

export function bytesOf(path: string): Buffer | null {
  return existsSync(path) ? readFileSync(path) : null;
}

afterEach(async () => {
  for (const w of worlds) await stop(w);
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  children.clear();
  for (const w of worlds.splice(0)) rmSync(w.tmp, { recursive: true, force: true });
});
