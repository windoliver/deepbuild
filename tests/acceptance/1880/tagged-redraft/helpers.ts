// What #1880's acceptance tests share (README): each criterion's tag, a temp HOME per test with agents' history and
// sign-ins where the agents keep them, the fake agents on the login PATH, and a real hub (`deep hub run` from the built
// CLI) reached on its socket the way `deep` reaches it. Only node's own modules: nothing here stands in for DeepBuild.
import { spawn, spawnSync, type ChildProcessByStdio } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CLI = join(REPO, 'packages', 'cli', 'dist', 'main.js');

/** Each criterion's tag, as the issue's acceptance criteria name them. */
export const AC = {
  codexOnly: '#1880.28966ae3',
  claudeReader: '#1880.964d40e3',
  noNameBranch: '#1880.f9683a09',
} as const;

/** The commit these tests were drafted at, used only when the checkout has no merge base with origin/main. */
const DRAFTED_AT = '654c560c1468816186f16ab34830840b96746f0c';
/**
 * What the "unchanged" checks compare against: DEEP_1880_BASE when set, else the checkout's merge base with
 * origin/main, so a change main made since the draft isn't counted as this issue's; else the commit drafted at (README).
 */
export const BASE = process.env.DEEP_1880_BASE || (() => {
  const mb = spawnSync('git', ['-C', REPO, 'merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' });
  const sha = mb.status === 0 ? mb.stdout.trim() : '';
  return /^[0-9a-f]{40}$/.test(sha) ? sha : DRAFTED_AT;
})();

type Obj = Record<string, any>;
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A version the agent's facts cover, a plain release where there is one. */
export function coveredVersion(facts: 'claude-code' | 'codex'): string {
  const versions = (JSON.parse(readFileSync(join(REPO, 'adapters', `${facts}.facts.json`), 'utf8')) as { versions: string[] }).versions;
  return [...versions].reverse().find((v) => /^\d+\.\d+\.\d+$/.test(v)) ?? versions.at(-1)!;
}

export interface Home { home: string; root: string; bin: string }
const homes: Home[] = [];
/** A fresh temp HOME, its DeepBuild root, and a login PATH folder holding only what the test installs. */
export function makeHome(): Home {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'dh1880-')));
  const h = { home, root: join(home, '.deepbuild'), bin: join(home, 'bin') };
  mkdirSync(h.root, { recursive: true });
  mkdirSync(h.bin, { recursive: true });
  homes.push(h);
  return h;
}
export function removeHomes(): void {
  for (const h of homes.splice(0)) rmSync(h.home, { recursive: true, force: true });
}

/** The fake agent as `claude` or `codex` on the login PATH, its version one the agent's facts cover. */
export function installFake(h: Home, agent: 'claude' | 'codex'): void {
  const version = coveredVersion(agent === 'claude' ? 'claude-code' : 'codex');
  const text = readFileSync(join(FIXTURES, `fake-${agent}.pl`), 'utf8').replaceAll('__VERSION__', version);
  const file = join(h.bin, agent);
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}
/** The runner's login PATH, as setup records it in config.json: the test's bin first, then the system's. */
export function writeLoginPath(h: Home): void {
  writeFileSync(join(h.root, 'config.json'), JSON.stringify({ runner: { login_path: `${h.bin}:/usr/bin:/bin` } }));
}

const git = (cwd: string, ...args: string[]): void => {
  spawnSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'ignore' });
};
/** A repo folder with one commit. */
export function repo(path: string): string {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q');
  writeFileSync(join(path, 'README.md'), 'x\n');
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'one');
  return path;
}
/** One Codex session in the home's history, one user message of `text`. */
export function codexSession(home: string, cwd: string, id: string, text: string): void {
  const dir = join(home, '.codex', 'sessions', '2026', '10', '01');
  mkdirSync(dir, { recursive: true });
  const lines = [
    { type: 'session_meta', payload: { session_id: id, id, timestamp: '2026-10-01T09:00:00.000Z', cwd, originator: 'codex_exec', cli_version: '0.144.0', source: 'exec' } },
    { type: 'response_item', payload: { type: 'message', id: 'msg_u1', role: 'user', content: [{ type: 'input_text', text }] } },
    { type: 'response_item', payload: { type: 'message', id: 'msg_a2', role: 'assistant', content: [{ type: 'output_text', text: 'Noted.' }] } },
  ];
  writeFileSync(join(dir, `rollout-2026-10-01T09-00-00-${id}.jsonl`), `${lines.map((l, i) => JSON.stringify({ timestamp: new Date(Date.UTC(2026, 9, 1, 9, 0, i)).toISOString(), ...l })).join('\n')}\n`);
}
/** One Claude Code session in the home's history, one user message of `text`. */
export function claudeSession(home: string, cwd: string, id: string, text: string): void {
  const dir = join(home, '.claude', 'projects', cwd.replace(/[^0-9A-Za-z]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const lines = [
    { type: 'user', uuid: 'u1', message: { role: 'user', content: text } },
    { type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'Noted.' }] } },
  ];
  writeFileSync(join(dir, `${id}.jsonl`), `${lines.map((l) => JSON.stringify({ cwd, sessionId: id, ...l })).join('\n')}\n`);
}

/** The environment a hub starts with: yours without any agent's, DeepBuild's or a billing key's variables, HOME the temp one. */
function hubEnv(h: Home): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDE|CODEX|ANTHROPIC|OPENAI|DEEP_|AI_AGENT|AWS_|GOOGLE_|AZURE_)/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, HOME: h.home, PATH: `${h.bin}:/usr/bin:/bin` };
}

export interface Hub { stop(): Promise<void> }
/** `deep hub run` on the home, as its owner starts it; ready once it prints. Stopped by its own PID only. */
export async function startHub(h: Home): Promise<Hub> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: ${CLI} is missing; run npm run build --workspaces first`);
  const hub: ChildProcessByStdio<null, Readable, null> = spawn(process.execPath, [CLI, 'hub', 'run'], { env: hubEnv(h), stdio: ['ignore', 'pipe', 'inherit'] });
  let timer: NodeJS.Timeout | undefined;
  await new Promise((resolve, reject) => {
    hub.stdout.once('data', resolve);
    hub.once('exit', () => reject(Error('the hub exited before it was ready')));
    timer = setTimeout(() => reject(Error("the hub wasn't ready within 30 s")), 30_000);
  }).finally(() => clearTimeout(timer));
  hub.stdout.resume();
  return {
    async stop() {
      if (hub.exitCode !== null || hub.signalCode !== null) return;
      const exited = new Promise((r) => hub.once('exit', r));
      hub.kill('SIGTERM');
      await Promise.race([exited, sleep(60_000)]);
    },
  };
}

/** One call on the hub's socket as the cli role, the way `deep` makes it: its result, or a thrown refusal. */
export function hubCall(h: Home, method: string, params: Obj = {}, timeoutMs = 60_000): Promise<Obj> {
  const socket = join(h.root, 'hub.sock');
  const token = readFileSync(join(h.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Obj | undefined;
        try { line = JSON.parse(buffer.slice(0, i)) as Obj; } catch { line = undefined; }
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) reject(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else resolve((line.result ?? {}) as Obj);
        }
      }
    });
  });
}

export interface Ev { id: string; kind: string; subject?: string; data: Obj; log_pos: number }
/** Every event in the home's record, through `events.read`. */
export async function events(h: Home): Promise<Ev[]> {
  const all: Ev[] = [];
  for (let after = 0; ;) {
    const page = ((await hubCall(h, 'events.read', { after, limit: 1000 })).events ?? []) as Ev[];
    if (!page.length) return all;
    all.push(...page);
    after = page[page.length - 1]!.log_pos;
  }
}
export interface Job { job: string; kind: string; agent: string; state: string; refused?: string; blocked?: Obj; [k: string]: unknown }
export const readJobs = async (h: Home): Promise<Job[]> => ((await hubCall(h, 'job.list')).jobs as Job[]).filter((j) => j.kind === 'read');
export const jobOutput = async (h: Home, job: string): Promise<string> => String((await hubCall(h, 'job.output', { job })).stdout ?? '');

/** The `fake` lines a fake agent printed in a job's output: the argv it was launched with. */
export function fakeArgv(stdout: string): string[][] {
  const out: string[][] = [];
  for (const line of stdout.split('\n')) {
    try { const e = JSON.parse(line) as Obj; if (e?.type === 'fake' && Array.isArray(e.argv)) out.push(e.argv.map(String)); } catch { /* not JSON */ }
  }
  return out;
}

/**
 * Whether `value` reads BLOCKED and names why: an object holding the value `BLOCKED` beside a non-empty reason
 * (`why`, `reason`, `cause`, `invalid`, `refused`, `message`), or a string saying `BLOCKED` followed by words.
 */
export function blockedWithReason(value: unknown): boolean {
  if (typeof value === 'string') return /\bBLOCKED\b\W+\w+/.test(value);
  if (Array.isArray(value)) return value.some(blockedWithReason);
  if (value && typeof value === 'object') {
    const o = value as Obj;
    const says = Object.values(o).some((v) => v === 'BLOCKED');
    if (says && ['why', 'reason', 'cause', 'invalid', 'refused', 'message'].some((k) => typeof o[k] === 'string' && o[k].trim())) return true;
    return Object.values(o).some(blockedWithReason);
  }
  return false;
}
