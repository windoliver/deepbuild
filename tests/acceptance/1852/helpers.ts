import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const AC = {
  1: '#1852.215083f6 Through the installed hub, with no receiver the test starts, a scripted Claude Code session exporting to 127.0.0.1:4318 adds `tool.span` and `request.cost` events to the record; the merge base adds none and fails this test, naming the port',
  2: '#1852.ee6ff135 With Claude Code set to export to 127.0.0.1:4318 and nothing listening there, the doctor item fails naming the address; the merge base reads healthy and fails this test',
  3: '#1852.d94f17eb With 4318 held by another process, the hub starts and the doctor item names the port',
} as const;

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
const FACTS = join(REPO, 'adapters/claude-code.facts.json');
const STAND_IN = fileURLToPath(new URL('./fixtures/claude-code.mjs', import.meta.url));
const NODE = process.execPath;
export const HOST = '127.0.0.1';
export const PORT = 4318;
export const ADDRESS = `${HOST}:${PORT}`;
export const ENDPOINT = `http://${ADDRESS}`;
const MANAGED = '/Library/Application Support/ClaudeCode/managed-settings.json';
export const TELEMETRY = {
  CLAUDE_CODE_ENABLE_TELEMETRY: '1', CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1', OTEL_TRACES_EXPORTER: 'otlp', OTEL_LOGS_EXPORTER: 'otlp',
  OTEL_METRICS_EXPORTER: 'none', OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_EXPORTER_OTLP_ENDPOINT: ENDPOINT,
};

export type Line = { [key: string]: unknown };
const parseObject = (raw: string): Line | undefined => { try { const v: unknown = JSON.parse(raw); return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Line) : undefined; } catch { return undefined; } };
const home = homedir();
export const redact = (text: string): string => text.split(home).join('~');
const cut = (text: string, n = 2000): string => (text.length > n ? `${text.slice(0, n)}…` : text);

export function bound(ms: number): Promise<void> {
  // deadline: only ever raced against the event a test waits for, so a hang becomes a result
  return new Promise<void>((done) => { setTimeout(done, ms).unref(); });
}

const made: string[] = [];
const children = new Set<ChildProcess>();
const gone = (c: ChildProcess): boolean => c.exitCode !== null || c.signalCode !== null;
const exitOf = (c: ChildProcess): Promise<void> => (gone(c) ? Promise.resolve() : new Promise((done) => c.once('exit', () => done())));
const closers: (() => Promise<unknown>)[] = [];

export async function cleanup(): Promise<void> {
  for (const close of closers.splice(0).reverse()) await close().catch(() => undefined);
  for (const c of children) if (!gone(c)) c.kill('SIGTERM');
  await Promise.race([Promise.all([...children].map(exitOf)), bound(60_000)]);
  for (const c of children) if (!gone(c)) c.kill('SIGKILL');
  await Promise.race([Promise.all([...children].map(exitOf)), bound(5000)]);
  children.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface World { tmp: string; home: string }
export function world(settingsEnv: Record<string, string>): World {
  if (existsSync(MANAGED)) throw Error(`BLOCKED: ${MANAGED} exists and would override the test home's Claude Code settings`);
  const tmp = realpathSync(mkdtempSync('/tmp/d1852-'));
  made.push(tmp);
  const h = join(tmp, 'home');
  mkdirSync(join(h, '.claude'), { recursive: true });
  writeFileSync(join(h, '.claude', 'settings.json'), JSON.stringify({ env: settingsEnv }));
  return { tmp, home: h };
}

const PATH = [dirname(NODE), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
function childEnv(h: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|GIT_|CLAUDE|CODEX|OTEL_|ANTHROPIC|OPENAI|AWS_|GH_|GITHUB_|AI_AGENT|NODE_OPTIONS|NODE_TEST|NODE_EXTRA_CA_CERTS|VITEST|TMPDIR)/.test(key)) continue;
    env[key] = value;
  }
  return { ...env, HOME: h, XDG_CONFIG_HOME: join(h, '.config'), XDG_CACHE_HOME: join(h, '.cache'), PATH, NO_COLOR: '1', LC_ALL: 'C' };
}

export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran): string => redact(`exit ${r.code}, stdout ${JSON.stringify(cut(r.stdout))}, stderr ${JSON.stringify(cut(r.stderr))}`);
function run(args: readonly string[], w: World, ms: number): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, args, { cwd: w.tmp, env: childEnv(w.home), stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
    // deadline: a program that never ends is stopped by its PID, so its caller gets an answer
    const timer = setTimeout(() => { stderr += `\nstopped at ${ms} ms`; child.kill('SIGKILL'); }, ms);
    const done = (code: number | null, extra = ''): void => { clearTimeout(timer); children.delete(child); resolve({ code, stdout, stderr: stderr + extra }); };
    child.on('error', (error) => done(null, error.message));
    child.on('close', (code) => done(code));
  });
}

export async function portFree(): Promise<boolean> {
  const server = net.createServer();
  const taken = await new Promise<boolean>((done) => {
    server.once('error', () => done(true));
    server.listen(PORT, HOST, () => done(false));
  });
  if (!taken) await new Promise<void>((done) => server.close(() => done()));
  return !taken;
}
export async function requirePortFree(): Promise<void> {
  if (!(await portFree())) throw Error(`BLOCKED: ${ADDRESS} is already held by a process this test didn't start; free it and run again`);
}
export function answers(): Promise<boolean> {
  return new Promise((done) => {
    const sock = net.connect(PORT, HOST);
    sock.once('connect', () => { sock.destroy(); done(true); });
    sock.once('error', () => done(false));
  });
}

export async function holdPort(): Promise<{ requests: number }> {
  const held = { requests: 0 };
  const server = net.createServer((sock) => {
    sock.on('error', () => undefined);
    sock.once('data', () => {
      held.requests += 1;
      sock.end('HTTP/1.1 404 Not Found\r\ncontent-type: text/plain\r\ncontent-length: 9\r\nconnection: close\r\n\r\nnot here\n');
    });
  });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(PORT, HOST, () => done()); });
  closers.push(() => new Promise<void>((done) => server.close(() => done())));
  return held;
}

export interface Hub { child: ChildProcess; socket: string; root: string; stderr: () => string }
export async function startHub(w: World): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: w.tmp, env: childEnv(w.home), stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { err = (err + d).slice(-20_000); });
  const first = new Promise<Line | undefined>((done) => createInterface({ input: child.stdout! }).once('line', (l) => done(parseObject(l))));
  const ready = await Promise.race([first, exitOf(child).then(() => undefined), bound(300_000).then(() => undefined)]);
  if (ready?.ready !== true) throw Error(`BLOCKED: the installed hub (deep hub run in the test home) did not start: ${redact(cut(err.slice(-1500)))}`);
  return { child, socket: String(ready.socket), root: join(w.home, '.deepbuild'), stderr: () => redact(cut(err.slice(-1500))) };
}
export const running = (hub: Hub): boolean => !gone(hub.child);
export async function stopHub(hub: Hub): Promise<void> {
  if (!gone(hub.child)) hub.child.kill('SIGTERM');
  await Promise.race([exitOf(hub.child), bound(60_000)]);
  if (!gone(hub.child)) hub.child.kill('SIGKILL');
  await exitOf(hub.child);
}

export function control(hub: Hub, method: string, params: Line, ms = 60_000): Promise<Line> {
  const token = readFileSync(join(hub.root, 'control.token'), 'utf8').trim();
  return new Promise((done, fail) => {
    const sock = net.connect(hub.socket);
    let buffer = '';
    let step = 0;
    // deadline: a hub that never replies fails the call instead of hanging the test
    const timer = setTimeout(() => { sock.destroy(); fail(Error(`no reply to ${method} within ${ms} ms`)); }, ms);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); fail(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parseObject(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (step === 0) {
          step = 1;
          sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
        } else if (step === 1 && line?.role !== undefined) {
          step = 2;
          sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`);
        } else if (step === 2 && line?.id === 1) {
          clearTimeout(timer);
          sock.destroy();
          if (line.error) fail(Error(`${method} refused: ${JSON.stringify(line.error)}`));
          else done(line.result as Line);
        }
      }
    });
  });
}

export interface Ev { id: string; kind: string; log_pos: number; session?: string; data: Line }
export async function eventsOf(hub: Hub, kinds: string[]): Promise<Ev[]> {
  const out: Ev[] = [];
  for (let after = 0; ;) {
    const result = await control(hub, 'events.read', { after, limit: 1000, kinds });
    const raw = result.events;
    const events = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Ev[];
    out.push(...events);
    if (!result.more) return out;
    after = Number(result.log_pos);
  }
}

export interface Export { code: number | null; report: string }
export async function claudeCodeSession(w: World, session: string): Promise<Export> {
  const r = await run([STAND_IN, session, FACTS], w, 120_000);
  return { code: r.code, report: redact(cut(`${r.stdout.trim()} ${r.stderr.trim()}`.trim())) };
}

export interface Item { item: string; agent?: string; code: string; level: string; evidence: string; fix: string }
export interface Doctor { ran: Ran; items: Item[] }
export async function doctor(w: World): Promise<Doctor> {
  const ran = await run([CLI, 'doctor', '--json'], w, 180_000);
  const items = ran.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).map(parseObject).filter((l): l is Line => l !== undefined) as unknown as Item[];
  return { ran, items };
}
export function telemetryItem(d: Doctor): Item | undefined {
  return d.items.find((i) => i.item === 'otlp.telemetry' && (i.agent === undefined || i.agent === 'claude-code'));
}
export const itemText = (i: Item | undefined): string => (i ? redact(JSON.stringify(i)) : 'no otlp.telemetry item');
