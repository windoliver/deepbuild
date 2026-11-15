// #2068: real hub/adapter/record/task machinery; only the HTTP forge is planted.
// Reuse #16's socket client, not a Core, AskTasks, fetch or clock replacement.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { Conn, control, nextSeq, result, ulid, type Line } from '../16/helpers.ts';

export const BASE = '1c4d1f0e2aaad8c6a6573848823566d04ff73d17';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLI = join(ROOT, 'packages/cli/dist/main.js');
export const OWNER = 'fixture-owner-2068';
export const MEMBER = 'fixture-member-2068';
export const CRITERIA = [
  'Through the API an expired token returns status 401; returning status 200 fails this integration test.',
  'Through the API a fresh token returns status 200; rejecting it fails this integration test.',
];
export const link = (n = 7) => `https://github.com/fixture-2068/widgets/issues/${n}`;
export const prompt = (n = 7) => `Fix expired token handling as requested in ${link(n)}`;
export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
export async function until(test: () => boolean, ms: number): Promise<void> {
  const end = performance.now() + ms;
  while (!test() && performance.now() < end) await sleep(10);
}

export type Mode = 'five-seconds' | 'never' | 'pages-forever' | 'instant';
interface RequestTime { path: string; page: number; requested: number; answered?: number; disconnected?: boolean }
export async function forge(mode: Mode) {
  const requests: RequestTime[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let scan = () => {};
  const user = (login: string) => ({ login, type: 'User' });
  const server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    const path = url.pathname;
    const entry: RequestTime = { path, page: Number(url.searchParams.get('page') ?? 1), requested: performance.now() };
    requests.push(entry);
    if (mode === 'never') return; // Not even headers; neither success nor a fixture-induced error.
    const answer = () => {
      // Read committed events immediately BEFORE each answer, not a hook ACK or its backdated event.ts.
      scan();
      entry.answered = performance.now();
      entry.disconnected = res.destroyed;
      const issue = /\/issues\/(7|8)$/.exec(path);
      let body: unknown;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      const next = () => { headers.link = `<http://${req.headers.host}${path}?per_page=100&page=${entry.page + 1}>; rel="next"`; };
      if (issue) body = {
        title: `Forge-only title ${issue[1]}`, body: `### Acceptance criteria\n${CRITERIA.map((c) => `- [ ] ${c}`).join('\n')}\n`,
        html_url: link(Number(issue[1])), user: user(issue[1] === '7' ? OWNER : MEMBER), updated_at: '2026-01-01T00:00:00Z',
      };
      else if (path.endsWith('/comments')) { body = []; if (mode === 'pages-forever') next(); }
      else if (path.endsWith('/collaborators')) { body = entry.page === 1 ? [] : [user(MEMBER)]; if (entry.page === 1) next(); }
      else if (path === '/repos/fixture-2068/widgets') body = { owner: user(OWNER) };
      res.writeHead(body === undefined ? 404 : 200, headers);
      res.end(JSON.stringify(body ?? { message: 'Unknown fixture path' }));
    };
    if (mode === 'instant') answer();
    else {
      // Zero-delay yielding pages never hit a per-request network timeout, but the WHOLE read must end.
      const timer = setTimeout(() => { timers.delete(timer); answer(); }, mode === 'five-seconds' ? 5_000 : 0);
      timers.add(timer);
    }
  });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('BLOCKED: no loopback forge address');
  return {
    url: `http://127.0.0.1:${address.port}`, requests,
    beforeAnswer(fn: () => void) { scan = fn; },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
export type Forge = Awaited<ReturnType<typeof forge>>;
export interface Seen { id: string; kind: string; session: string | null; data: Line; log_pos: number; ts: number; unverified: number; absent: number; present: number }
interface Session { id: string; cwd: string; transcript: string; pid: number }

/** All filesystem writes are to this world's temporary home/repo. No inherited credentials/config/proxies. */
export async function world(f: Forge) {
  const tmp = realpathSync(mkdtempSync('/tmp/dh2068-'));
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  const repo = join(tmp, 'repo');
  const env: NodeJS.ProcessEnv = {
    HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'),
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, LC_ALL: 'C', TZ: 'UTC',
    // Empty, NOT a credential: prevents gh auth token, and emits no Authorization header.
    GH_TOKEN: '', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_EMAIL: 'fixture@example.test',
    DEEP_HUB_TEST_FORGE: f.url,
  };
  const children: ChildProcess[] = [];
  const sockets: Conn[] = [];
  let db: DatabaseSync | undefined;
  let poll: ReturnType<typeof setInterval> | undefined;
  const stop = async () => {
    if (poll) clearInterval(poll);
    f.beforeAnswer(() => {});
    for (const socket of sockets) socket.close();
    db?.close();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await until(() => children.every((c) => c.exitCode !== null || c.signalCode !== null), 3_000);
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all(children.map((c) => c.exitCode !== null || c.signalCode !== null ? Promise.resolve() : new Promise<void>((done) => c.once('exit', () => done()))));
    rmSync(tmp, { recursive: true, force: true });
  };
  try {
    mkdirSync(root, { recursive: true });
    mkdirSync(join(home, '.claude', 'projects', 'fixture'), { recursive: true });
    mkdirSync(repo);
    writeFileSync(join(repo, 'fixture.txt'), 'synthetic fixture, no remote\n');
    writeFileSync(join(root, 'rules.json'), readFileSync(join(ROOT, 'crates/deep-hook/default-rules.json')));
    for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['commit', '-qm', 'fixture base']])
      execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, env });
    const child = spawn(process.execPath, [CLI, 'hub', 'run'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let output = '';
    let errors = '';
    child.stdout!.setEncoding('utf8').on('data', (s: string) => { output += s; });
    child.stderr!.setEncoding('utf8').on('data', (s: string) => { errors += s; });
    let spawnError = '';
    child.once('error', (e) => { spawnError = e.message; });
    await until(() => output.includes('\n') || child.exitCode !== null || Boolean(spawnError), 60_000);
    const first = output.split('\n')[0];
    const ready = first ? JSON.parse(first) as Line : undefined;
    if (!ready?.ready) throw Error(`BLOCKED: deep hub run did not start: ${spawnError} ${errors.slice(-1500)}`);
    const socket = String(ready.socket);
    db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
    const events: Seen[] = [];
    let after = 0;
    let last = performance.now();
    const scan = () => {
      const rows = db!.prepare('SELECT id, kind, session_id, data, log_pos, ts, unverified FROM events WHERE log_pos > ? ORDER BY log_pos').all(after);
      const present = performance.now();
      for (const row of rows) {
        events.push({ id: String(row.id), kind: String(row.kind), session: row.session_id === null ? null : String(row.session_id), data: JSON.parse(String(row.data)) as Line,
          log_pos: Number(row.log_pos), ts: Number(row.ts), unverified: Number(row.unverified), absent: last, present });
        after = Number(row.log_pos);
      }
      last = present;
    };
    scan();
    poll = setInterval(scan, 10);
    f.beforeAnswer(scan);
    const connection = async () => { const c = await Conn.open(socket); sockets.push(c); return c; };
    const prepare = async (s: Session, event: string, fields: Line = {}) => {
      const c = await connection();
      return { conn: c, send() {
        const epoch = Date.now();
        const id = ulid(epoch);
        const at = c.send({ v: 1, agent: 'claude-code', event, seq: nextSeq(epoch), id, pid: process.pid, ppid: s.pid, matched: [],
          payload: { session_id: s.id, cwd: s.cwd, transcript_path: s.transcript, hook_event_name: event, ...fields } });
        return { id, at, epoch, conn: c };
      } };
    };
    const startSession = async (): Promise<Session> => {
      const id = randomUUID();
      const agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { cwd: repo, env, stdio: 'ignore' });
      children.push(agent);
      const transcript = join(home, '.claude', 'projects', 'fixture', `${id}.jsonl`);
      writeFileSync(transcript, '');
      const s = { id, cwd: repo, transcript, pid: agent.pid! };
      const sent = (await prepare(s, 'SessionStart', { source: 'startup' })).send();
      await until(() => events.some((e) => e.id === sent.id), 10_000);
      if (!events.some((e) => e.id === sent.id && e.unverified === 0)) throw Error('BLOCKED: session start was not verified and recorded');
      return s;
    };
    const typed = async (s: Session, text: string) => {
      const promptId = randomUUID();
      appendFileSync(s.transcript, `${JSON.stringify({ type: 'user', uuid: promptId, promptId, sessionId: s.id, cwd: repo, timestamp: new Date().toISOString(),
        message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' })}\n`);
      return prepare(s, 'UserPromptSubmit', { prompt: text, prompt_id: promptId });
    };
    const rpc = async (method: string, params: Line = {}) => {
      const c = await control({ socket, root }); sockets.push(c);
      try { return result(await c.call(method, params, 30_000)); } finally { c.close(); }
    };
    return { events, scan, prepare, startSession, typed, rpc, stop, errors: () => errors };
  } catch (error) { await stop(); throw error; }
}
export type World = Awaited<ReturnType<typeof world>>;
export type Sent = ReturnType<Awaited<ReturnType<World['prepare']>>['send']>;
export async function acknowledged(sent: Sent): Promise<number> {
  const ack = await sent.conn.seek((l) => l.ack === sent.id);
  if (!ack || typeof ack.json?.hold_until_ms !== 'number') throw Error(`BLOCKED: prompt has no acknowledged hold: ${JSON.stringify(ack?.json)}`);
  return ack.json.hold_until_ms as number;
}
export const taskFor = (w: World, s: { id: string }) => w.events.find((e) => e.kind === 'task.created' && e.session === s.id);
export function timing(mode: Mode, f: Forge, a: Sent, b: Sent, w: World, extra: Line = {}) {
  const seen = (id: string) => { const e = w.events.find((v) => v.id === id); return e ? { absent_ms: e.absent - a.at, present_ms: e.present - a.at, log_pos: e.log_pos } : null; };
  const first = f.requests.find((r) => r.answered !== undefined)?.answered;
  const bSeen = w.events.find((e) => e.id === b.id);
  console.log('ISSUE2068_TIMING ' + JSON.stringify({ mode, baseline: BASE, date: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    configured_b_after_a_ms: 100, b_sent_ms: b.at - a.at, a_record: seen(a.id), b_record: seen(b.id),
    b_minus_first_forge_answer_ms: first === undefined || !bSeen ? null : bSeen.present - first,
    forge: f.requests.map((r) => ({ path: r.path, page: r.page, requested_ms: r.requested - a.at, answered_ms: r.answered === undefined ? null : r.answered - a.at, disconnected: r.disconnected ?? null })), ...extra }));
}
