// #1880's helpers: a real hub on a temp home (HOME is a temp folder for every child), the fake agents first on the
// hub's PATH (the login PATH its jobs resolve agents on), history where each agent keeps it, and what the hub
// recorded: the runner's jobs (`job.list`, `job.output` on the control socket) and the ledger's events. Nothing here
// stands in for DeepBuild. Processes are stopped by PID only.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

type Obj = Record<string, any>;
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const CLI = join(REPO, 'packages', 'cli', 'dist', 'main.js');
const NODE = process.execPath;
/** The newest version each agent's facts cover, stable builds only: what the fakes answer `--version` with. */
const covered = (facts: string): string => {
  const v = (JSON.parse(readFileSync(join(REPO, 'adapters', facts), 'utf8')) as { versions: string[] }).versions.filter((x) => !x.includes('-'));
  return v[v.length - 1]!;
};
export const CODEX_VERSION = covered('codex.facts.json');
export const CLAUDE_VERSION = covered('claude-code.facts.json');
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** What must be built for a hub to run; a missing piece is BLOCKED, never a pass. */
export function missingBuild(): string | undefined {
  if (!existsSync(CLI)) return `BLOCKED: the CLI isn't built (${CLI}); run npm run build --workspaces`;
  if (!existsSync(join(REPO, 'target', 'debug', 'deep-hook'))) return 'BLOCKED: target/debug/deep-hook isn\'t built; run cargo build --locked -p deep-hook';
  return undefined;
}

export interface Home { tmp: string; home: string; bin: string; codexLog: string }
const made: string[] = [];
/** A fresh temp home: `<tmp>/h` is HOME, `<tmp>/bin` holds the fake agents and comes first on the hub's PATH. */
export function makeHome(): Home {
  const tmp = realpathSync(mkdtempSync('/tmp/dh1880-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin);
  return { tmp, home, bin, codexLog: join(tmp, 'codex-calls.jsonl') };
}

/** Codex signed in: `~/.codex/auth.json` (made-up tokens, no account ID, so no plan window gates the job) and the fake `codex`. */
export function signInCodex(h: Home): void {
  mkdirSync(join(h.home, '.codex'), { recursive: true });
  writeFileSync(join(h.home, '.codex', 'auth.json'), `${JSON.stringify({ OPENAI_API_KEY: null, tokens: { id_token: 'dh1880.fake.id', access_token: 'dh1880.fake.access', refresh_token: 'dh1880.fake.refresh' }, last_refresh: '2026-11-01T00:00:00Z' })}\n`, { mode: 0o600 });
  const text = readFileSync(join(FIXTURES, 'fake-codex.pl'), 'utf8').replaceAll('__VERSION__', CODEX_VERSION).replaceAll('__LOG__', h.codexLog);
  writeFileSync(join(h.bin, 'codex'), text, { mode: 0o755 });
  chmodSync(join(h.bin, 'codex'), 0o755);
}
export const CLAUDE_ACCOUNT = '18801880-1111-4222-8333-444444444444';
/** Claude Code signed in (made-up credentials) and #63's fake reader as `claude` (tests/acceptance/63/fixtures). */
export function signInClaude(h: Home): void {
  mkdirSync(join(h.home, '.claude'), { recursive: true });
  writeFileSync(join(h.home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: CLAUDE_ACCOUNT, emailAddress: 'a@example.invalid' } }));
  writeFileSync(join(h.home, '.claude', '.credentials.json'), `${JSON.stringify({ claudeAiOauth: { accessToken: `sk-ant-oat01-dh1880FAKE${'x'.repeat(40)}`, refreshToken: `sk-ant-ort01-dh1880FAKE${'y'.repeat(40)}`, expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`, { mode: 0o600 });
  writeFileSync(join(h.home, '.claude', 'settings.json'), '{}\n');
  const text = readFileSync(join(REPO, 'tests', 'acceptance', '63', 'fixtures', 'fake-reader.pl'), 'utf8')
    .replace('__VERSION__', CLAUDE_VERSION).replace('__PLANTED__', Buffer.from('[]').toString('base64'));
  writeFileSync(join(h.bin, 'claude'), text, { mode: 0o755 });
  chmodSync(join(h.bin, 'claude'), 0o755);
}

const git = (cwd: string, ...args: string[]): void => { execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'ignore' }); };
/** A repo folder with one commit. */
export function repo(path: string): string {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q');
  writeFileSync(join(path, 'README.md'), 'x\n');
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'one');
  return path;
}
/** One Codex session where Codex keeps it, as packages/hub/test/wiki.test.ts writes one: a user message per text. */
export function codexSession(home: string, cwd: string, id: string, texts: string[]): void {
  const dir = join(home, '.codex', 'sessions', '2026', '10', '01');
  mkdirSync(dir, { recursive: true });
  const head = { type: 'session_meta', payload: { session_id: id, id, timestamp: '2026-10-01T09:00:00.000Z', cwd, originator: 'codex_exec', cli_version: CODEX_VERSION, source: 'exec' } };
  const lines = texts.map((text, i) => ({ type: 'response_item', payload: { type: 'message', id: `msg_u${i + 1}`, role: 'user', content: [{ type: 'input_text', text }] } }));
  writeFileSync(join(dir, `rollout-2026-10-01T09-00-00-${id}.jsonl`), `${[head, ...lines].map((l, i) => JSON.stringify({ timestamp: new Date(Date.UTC(2026, 9, 1, 9, 0, i)).toISOString(), ...l })).join('\n')}\n`);
}
/** One Claude Code session where Claude Code keeps it. */
export function claudeSession(home: string, cwd: string, id: string, texts: string[]): void {
  const dir = join(home, '.claude', 'projects', cwd.replace(/[^0-9A-Za-z]/g, '-'));
  mkdirSync(dir, { recursive: true });
  const lines = texts.map((text, i) => ({ type: 'user', uuid: `u${i + 1}`, cwd, sessionId: id, message: { role: 'user', content: text } }));
  writeFileSync(join(dir, `${id}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}

/** The environment the hub gets: HOME the temp home, the fakes first on PATH, none of this process's agent, DEEP_ or billing variables. */
function hubEnv(h: Home): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC|OPENAI|GIT_|AWS_|VITEST|npm_)/.test(k) || k === 'NODE_OPTIONS') continue;
    env[k] = v;
  }
  env.HOME = h.home;
  env.PATH = `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.SHELL = '/bin/sh';
  env.LC_ALL = 'C';
  return env;
}

export interface Hub { root: string; call(method: string, params?: Obj): Promise<Obj>; stop(): Promise<void> }
/** A real hub (`deep hub run`) on the temp home, and a control client on its socket, as the CLI is. */
export async function startHub(h: Home): Promise<Hub> {
  const root = join(h.home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  // The login shell's PATH as `deep setup` records it (runner.login_path): where the runner resolves an agent's binary.
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ runner: { login_path: hubEnv(h).PATH } })}\n`);
  const child: ChildProcess = spawn(NODE, [CLI, 'hub', 'run'], { cwd: h.home, env: hubEnv(h), stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-20_000); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`the hub wasn't ready within 20 s: ${stderr}`)), 20_000);
    child.stdout!.once('data', () => { clearTimeout(timer); resolve(); });
    child.once('exit', () => { clearTimeout(timer); reject(Error(`the hub exited before it was ready: ${stderr}`)); });
  });
  child.stdout!.resume();
  const token = readFileSync(join(root, 'control.token'), 'utf8').trim();
  const sock = net.connect(join(root, 'hub.sock'));
  let buf = '';
  const lines: Obj[] = [];
  sock.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i)) as Obj); buf = buf.slice(i + 1); } });
  const until = async <T>(f: () => T | undefined, ms: number): Promise<T> => {
    const end = Date.now() + ms;
    for (;;) { const v = f(); if (v) return v; if (Date.now() > end) throw Error('no answer from the hub'); await sleep(50); }
  };
  await until(() => lines[0], 10_000);
  sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token })}\n`);
  await until(() => lines.find((l) => l.role), 10_000);
  let n = 0;
  return {
    root,
    async call(method, params = {}) {
      const id = `t${++n}`;
      sock.write(`${JSON.stringify({ v: 1, id, method, params })}\n`);
      const reply = await until(() => lines.find((l) => l.id === id), 300_000);
      if (reply.error) throw Error(`${method}: ${JSON.stringify(reply.error)}`);
      return reply.result as Obj;
    },
    async stop() {
      sock.destroy();
      if (child.exitCode !== null || child.signalCode !== null) return;
      const gone = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');
      const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 30_000);
      await gone;
      clearTimeout(timer);
    },
  };
}

/** Every event of the ledger, read on its own read-only connection: kind and data. */
export function events(root: string): { kind: string; data: Obj }[] {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT kind, data FROM events ORDER BY log_pos').all() as { kind: string; data: string }[])
      .map((r) => { let data: Obj = {}; try { data = JSON.parse(r.data) as Obj; } catch { /* not JSON */ } return { kind: r.kind.replace(/@\d+$/, ''), data }; });
  } finally { db.close(); }
}

/** The runner's reading jobs, each with what its process printed. */
export async function readJobs(hub: Hub): Promise<(Obj & { stdout: string })[]> {
  const jobs = ((await hub.call('job.list')).jobs as Obj[]).filter((j) => j.kind === 'read');
  return Promise.all(jobs.map(async (j) => ({ ...j, stdout: String((await hub.call('job.output', { job: j.job }).catch(() => ({ stdout: '' }))).stdout ?? '') })));
}

/** Waits until every reading job has settled and each reading the build started has ended or reads BLOCKED (bound `ms`). */
export async function settled(hub: Hub, ms = 180_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const jobs = ((await hub.call('job.list')).jobs as Obj[]).filter((j) => j.kind === 'read');
    const busy = jobs.some((j) => (j.state === 'running' || j.state === 'stopping' || j.state === 'waiting') && j.blocked?.status !== 'BLOCKED');
    const finished = events(hub.root).filter((e) => e.kind === 'reading.finished').length;
    if (!busy && (finished > 0 || jobs.some((j) => j.blocked?.status === 'BLOCKED'))) return;
    await sleep(500);
  }
}

/** Removes the temp homes (after their hubs are stopped). */
export function cleanup(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** What the fake Codex logged of the calls it could log (README: The fake Codex). */
export function codexCalls(h: Home): { argv: string[]; pid: number }[] {
  return existsSync(h.codexLog) ? readFileSync(h.codexLog, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; pid: number }) : [];
}
/** The JSON lines a job printed. */
export const linesOf = (stdout: string): Obj[] => stdout.split('\n').flatMap((l) => { try { const v = JSON.parse(l) as unknown; return typeof v === 'object' && v !== null ? [v as Obj] : []; } catch { return []; } });
