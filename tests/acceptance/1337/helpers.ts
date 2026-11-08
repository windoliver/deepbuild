// The world #1337's tests share (README, The world): a fixture project with two people. maya owns the hub (her
// home, her control token); bob joins the project `acme/shop` with a credential of his own. The hub, its socket and
// its record are reached only through `deep hub run`, the socket's lines and the record's public entry. The generic
// pieces (the hub as a process, the line protocol, a session's hook payloads) are #16's, imported by path.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allEvents, childEnv, cleanup as cleanup16, Conn, hookRequest, newSession, NODE, own, result, sleep, startHub, stopHub, tokenOf,
  type Ev, type Hub, type Line, type Session,
} from '../16/helpers.ts';

export { allEvents, Conn, NODE, result, sleep, stopHub, tokenOf, type Ev, type Hub, type Line, type Session };
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const HERE = fileURLToPath(new URL('./', import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

/** The project both people are on, by its forge identity, and the URLs its clones name it by. */
export const PROJECT = { https: 'https://github.com/acme/shop.git', ssh: 'git@github.com:acme/shop.git', bare: 'https://github.com/acme/shop' };
/** maya's own repo, outside the project: her personal scope. */
export const PERSONAL = 'https://github.com/maya/notes.git';
/** The hub's owner reads as `you`, as every event does today (README, The surface under test, 1). */
export const OWNER = 'you';

// ---- Folders and processes. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
const servers: Server[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1337-'));
  made.push(dir);
  return dir;
}
const agents = new Set<ChildProcess>();
/** Stops every process this suite started, by PID (#16's cleanup holds the hubs), and removes the folders. */
export async function cleanup(): Promise<void> {
  for (const a of agents) a.kill();
  agents.clear();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => { s.close(() => resolve()); s.closeAllConnections(); })));
  await cleanup16();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- Git: real repos and real clones, nothing fetched (the remotes are names only).
const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH, HOME: '/nonexistent', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
export const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function repo(path: string, remote?: string): string {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q');
  writeFileSync(join(path, 'README.md'), `# ${basename(path)}\n`);
  git(path, 'add', '-A');
  git(path, 'commit', '-q', '-m', 'Start');
  if (remote) git(path, 'remote', 'add', 'origin', remote);
  return path;
}
function clone(from: string, path: string, url: string): string {
  mkdirSync(dirname(path), { recursive: true });
  git(dirname(path), 'clone', '-q', from, path);
  git(path, 'remote', 'set-url', 'origin', url);
  return path;
}
/** The path scope a repo with no remote keeps, as the base computes it (packages/hub/src/paths.ts, repoOf). */
export const pathScope = (folder: string): string => {
  const real = realpathSync(folder);
  return `${basename(real).replace(/[^0-9A-Za-z]/g, '')}${createHash('sha256').update(real).digest('hex').slice(0, 8)}`;
};

// ---- The world.
export interface World {
  dir: string;
  /** maya's home: the hub's root is <maya>/.deepbuild. */
  maya: string;
  /** bob's home, where his sessions' transcripts are. */
  bob: string;
  hub: Hub;
  /** Requests the stand-in forge got: the hub reaches no forge but this one, on 127.0.0.1. */
  forgeRequests: string[];
  repos: {
    /** maya's clone of acme/shop, named by HTTPS. */ shop: string;
    /** a second clone of acme/shop at another path, named by SSH. */ shop2: string;
    /** bob's clone of acme/shop. */ bobShop: string;
    /** maya's own repo, maya/notes: outside the project. */ notes: string;
    /** a repo with no remote. */ scratch: string;
  };
}
export interface WorldOptions { plant?: string; ledger?: string }
export async function world(o: WorldOptions = {}): Promise<World> {
  const dir = tempDir();
  const maya = join(dir, 'm');
  const bob = join(dir, 'b');
  mkdirSync(join(maya, '.deepbuild'), { recursive: true });
  mkdirSync(bob, { recursive: true });
  // An existing record, opened as it is (AC4).
  if (o.ledger) copyFileSync(o.ledger, join(maya, '.deepbuild', 'ledger.db'));
  // The forge is a boundary this repo doesn't own: one that knows nothing, on 127.0.0.1, so no call leaves the machine.
  const forgeRequests: string[] = [];
  const forge = createServer((req, res) => {
    forgeRequests.push(`${req.method} ${req.url}`);
    res.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not Found"}');
  });
  servers.push(forge);
  await new Promise<void>((resolve) => forge.listen(0, '127.0.0.1', resolve));
  const port = (forge.address() as { port: number }).port;
  // Agents' CLIs the hub runs are boundaries too, first on PATH: a `gh` with no login, so no forge login reaches the hub,
  // and a `claude` and a `codex` that list no plugins and do nothing else, so no real agent runs under a test's home.
  mkdirSync(join(dir, 'bin'));
  const stub = (name: string, body: string) => { writeFileSync(join(dir, 'bin', name), `#!/bin/sh\n${body}`); chmodSync(join(dir, 'bin', name), 0o755); };
  stub('gh', 'echo "gh: not signed in (test stand-in)" >&2\nexit 1\n');
  for (const agent of ['claude', 'codex']) stub(agent, `[ "$1 $2 $3" = "plugin list --json" ] && { echo '[]'; exit 0; }\necho "${agent}: test stand-in" >&2\nexit 1\n`);
  writeFileSync(join(dir, 'confirm'), 'confirmed\n');

  const origin = join(dir, 'o', 'shop');
  repo(origin);
  const bare = join(dir, 'o', 'shop.git');
  git(dirname(origin), 'clone', '-q', '--bare', origin, bare);
  const repos = {
    shop: clone(bare, join(maya, 'src', 'shop'), PROJECT.https),
    shop2: clone(bare, join(maya, 'work', 'shop-2'), PROJECT.ssh),
    bobShop: clone(bare, join(bob, 'code', 'shop'), PROJECT.bare),
    notes: repo(join(maya, 'src', 'notes'), PERSONAL),
    scratch: repo(join(maya, 'src', 'scratch')),
  };
  const hub = await startHub({
    home: maya,
    ...(o.plant !== undefined && { plant: o.plant }),
    env: {
      PATH: `${join(dir, 'bin')}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      DEEP_HUB_TEST_FORGE: `http://127.0.0.1:${port}`,
      DEEP_HUB_TEST_CONFIRM: join(dir, 'confirm'),
      GH_TOKEN: undefined, GITHUB_TOKEN: undefined,
    },
  }, 60_000);
  return { dir, maya, bob, hub, forgeRequests, repos };
}

// ---- People (README, The surface under test, 1 and 2).
export type Added = { ok: true; person: string; token: string } | { ok: false; refused: string };
/** The owner adds a person to the project a clone names: `person.add` on her control connection. */
export async function addPerson(w: World, person: string, repo: string): Promise<Added> {
  const conn = await owner(w);
  try {
    const reply = await conn.call('person.add', { person, repo }, 30_000);
    if ('error' in reply) return { ok: false, refused: JSON.stringify(reply.error) };
    const r = reply.result as Line;
    if (typeof r?.person !== 'string' || !r.person || typeof r?.token !== 'string' || !r.token) return { ok: false, refused: `a result without a person and a token: ${JSON.stringify(r)}` };
    return { ok: true, person: r.person, token: r.token };
  } finally {
    conn.close();
  }
}
/** bob on the project: the step every two-person test starts with; it fails, naming the hub's answer, when there's no such surface. */
export async function joinBob(w: World): Promise<{ person: string; token: string }> {
  const added = await addPerson(w, 'bob', w.repos.shop);
  if (!added.ok) throw Error(`the hub must issue a second person's credential (person.add {person: "bob", repo: <maya's clone of acme/shop>} on maya's control connection, answered {person, token}): it answered ${added.refused}`);
  return added;
}

/** A `cli` connection presenting a credential: the owner's control token, or a person's. */
export async function connectAs(w: World, token: string): Promise<Conn> {
  const conn = await Conn.open(w.hub.socket);
  conn.send({ v: 1, hello: 'cli', token });
  const reply = await conn.next();
  if (!reply || 'error' in reply) {
    conn.close();
    throw Error(`the hub refused the hello presenting this credential: ${JSON.stringify(reply)}`);
  }
  return conn;
}
export const owner = (w: World): Promise<Conn> => connectAs(w, tokenOf(w.hub.root));

/** What a connection reads: every event (events.read, paged), and the sessions' rows (sessions.read). */
export interface Read { events: Ev[]; sessions: Line[] }
export async function readWith(conn: Conn): Promise<Read> {
  const events = await allEvents(conn);
  const sessions = (result(await conn.call('sessions.read', {}, 30_000)).sessions ?? []) as Line[];
  return { events, sessions };
}
/** The owner's read once every event with these IDs is in it (up to 15 s): what the record holds. */
export async function settled(w: World, ids: readonly string[]): Promise<Read> {
  const conn = await owner(w);
  try {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const read = await readWith(conn);
      const have = new Set(read.events.map((e) => e.id));
      if (ids.every((id) => have.has(id)) || Date.now() > deadline) return read;
      await sleep(200);
    }
  } finally {
    conn.close();
  }
}

// ---- Sessions: an agent process per session, its hooks carried by its children (fixtures/agent.mjs, hook.mjs).
export interface Sent { event: string; id: string; lines: Line[]; end: string; ack?: Line; error?: Line }
export class Agent {
  private n = 0;
  private pending = new Map<number, (line: Line) => void>();
  private constructor(private readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      let i: number;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = JSON.parse(buffer.slice(0, i)) as Line;
        buffer = buffer.slice(i + 1);
        this.pending.get(line.n as number)?.(line);
      }
    });
  }
  static start(home: string, cwd: string): Agent {
    const child = spawn(NODE, [join(FIXTURES, 'agent.mjs')], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(child.pid);
    agents.add(child);
    return new Agent(child);
  }
  send(command: Line, timeoutMs = 30_000): Promise<Line> {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`the agent stand-in gave no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => {
        clearTimeout(timer);
        this.pending.delete(n);
        if (line.failed) reject(Error(`the agent stand-in failed ${command.op}: ${line.failed}`));
        else resolve(line);
      });
      this.child.stdin!.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  async stop(): Promise<void> {
    try { await this.send({ op: 'exit' }, 3000); } catch { /* gone */ }
    agents.delete(this.child);
  }
}
const parse = (raw: string): Line => { try { return JSON.parse(raw) as Line; } catch { return { unparsed: raw }; } };

/**
 * One session's opening hooks (SessionStart, UserPromptSubmit, PreToolUse) in `cwd`, from an agent process run as the
 * person whose home it is. With `token`, each hook connection first says hello with that person's credential.
 * `extra` goes into every payload, as fields the agent's hook JSON carries.
 */
export async function work(w: World, o: { home: string; cwd: string; token?: string; extra?: Line; events?: string[] }): Promise<{ session: Session; sent: Sent[] }> {
  const session = newSession(o.home, 'claude-code', o.cwd);
  const agent = Agent.start(o.home, o.cwd);
  const sent: Sent[] = [];
  try {
    for (const event of o.events ?? ['SessionStart', 'UserPromptSubmit', 'PreToolUse']) {
      const request = hookRequest(session, event, o.extra ?? {});
      const r = await agent.send({ op: 'hook', address: w.hub.socket, request, cwd: o.cwd, ...(o.token ? { token: o.token } : {}) });
      const lines = (r.lines as string[]).slice(1).map(parse);
      const ack = lines.find((l) => 'ack' in l);
      const error = lines.find((l) => 'error' in l);
      sent.push({ event, id: request.id, lines, end: r.end as string, ...(ack && { ack }), ...(error && { error: error.error as Line }) });
    }
  } finally {
    await agent.stop();
  }
  return { session, sent };
}
/** How a hook ended, for a failure message. */
export const ended = (s: Sent): string => (s.error ? `refused ${JSON.stringify(s.error)}` : s.ack ? 'acknowledged' : `ended ${s.end} with no acknowledgement`);

/** Runs `judge` and returns the failure it raised, or undefined: a planted program's run must raise one. */
export function failureOf(judge: () => void): Error | undefined {
  try {
    judge();
    return undefined;
  } catch (error) {
    return error as Error;
  }
}
