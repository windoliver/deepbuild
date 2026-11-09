// The world #1338's tests share (README, The world): maya's hub on her machine, and other machines simulated on this
// Mac as separate homes that reach it over its network listener, through a TCP link this file runs (100 ms each way
// when asked, and cut and restored on demand). The hub is reached only through `deep hub run`, its socket's lines, its
// network port (found with lsof), the `deep` CLI and deep-hook; the record's public entry only makes the generation-2
// and generation-3 records. The generic pieces (the hub as a process, the line protocol, the timing judge) are #16's.
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import { dirname, join } from 'node:path';
import tls from 'node:tls';
import {
  allEvents, childEnv, cleanup as cleanup16, Conn, DEEP_HOOK, deep, judge, NODE, p95, payload, REPO, run, sleep, startHub, stopHub, tokenOf,
  newSession, type Ev, type Hub, type Line, type Ran, type Session,
} from '../16/helpers.ts';
import { prepareRestore, writerGeneration } from '../../../packages/record/src/index.ts';

export { judge, newSession, p95, sleep, type Ev, type Line, type Ran, type Session };

// ==== Surfaces this suite assumes (README, "Surfaces this suite assumes"). Each is named here and nowhere else. ====
export const SURFACE = {
  /** 1. The hub's network listener: `hub.listen` in `<root>/config.json`, `<host>:<port>`; port 0 takes any free port. */
  listen: { key: 'listen', value: '127.0.0.1:0' },
  /** 2. An invite: a socket method on the owner's `cli` connection: {person, repo, address} → {invite}. */
  invite: 'person.invite',
  /** 3. Joining: `deep join <repo link> --invite <invite>` in the joining machine's home, in its clone. */
  join: (link: string, invite: string): string[] => ['join', link, '--invite', invite],
  /** 4. A client's read of the project: `deep status`, which lists each session by the first 8 characters of its ID. */
  read: ['status'],
  /** 5. Where a client keeps the private keys its credentials are bound to: files in this folder under `~/.deepbuild/`. */
  keys: 'keys',
  /** 6. Revoking: a socket method on the owner's `cli` connection: {person} → a result without `error`. */
  revoke: 'person.revoke',
  /** 7. A route's declared hook overhead and fail-open time: `routes.<route>.<field>` (ms) in Claude Code's adapter facts. */
  facts: { file: join(REPO, 'adapters', 'claude-code.facts.json'), member: 'routes', route: 'network', overhead: 'hookOverheadMs', failOpen: 'failOpenMs' },
  /** 8. The planted hub that listens on the network with no project members (DEEP_HUB_PLANT). */
  plantListen: 'listen-without-members',
  /** 9. A refusal of a stale hub names both generations on one line with the word "generation". */
  generationLine: (text: string, seen: number, hub: number): boolean => text.split('\n').some((l) => /generation/i.test(l) && word(l, seen) && word(l, hub)),
  /** 10. A refusal of a credential without its key names the proof. */
  proof: /proof/i,
} as const;
const word = (line: string, n: number): boolean => new RegExp(`(^|[^0-9A-Za-z])${n}([^0-9A-Za-z]|$)`).test(line);

/** The project's repo link, as a person on the project gives it. */
export const REPO_LINK = 'https://github.com/acme/shop';
const SHIPPED_RULES = join(REPO, 'crates', 'deep-hook', 'default-rules.json');

// ---- Folders and processes. Short paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
const servers: (Server | net.Server)[] = [];
const links: Link[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1338-'));
  made.push(dir);
  return dir;
}
/** Stops every process this suite started, by PID (#16's cleanup holds them), closes its servers and removes its folders. */
export async function cleanup(): Promise<void> {
  for (const l of links.splice(0)) l.close();
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => {
    s.close(() => resolve());
    if ('closeAllConnections' in s) s.closeAllConnections();
  })));
  await cleanup16();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- Git: real repos and real clones, nothing fetched (the remotes are names only).
const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH, HOME: '/nonexistent', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function clone(bare: string, path: string, url: string): string {
  mkdirSync(dirname(path), { recursive: true });
  git(dirname(path), 'clone', '-q', bare, path);
  git(path, 'remote', 'set-url', 'origin', url);
  return path;
}

/** The shipped fast rules, as `deep setup` writes them into a machine's ~/.deepbuild/rules.json. */
function seedRules(home: string): void {
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.deepbuild', 'rules.json'), readFileSync(SHIPPED_RULES, 'utf8'));
}
/** A fail_closed fast rule deep-hook enforces locally, with the call it must deny and its twin it must allow. */
export function killByName(): { name: string; planted: Line; twin: Line } {
  const proofs = (JSON.parse(readFileSync(SHIPPED_RULES, 'utf8')) as { proofs: Record<string, { planted: Line; twin: Line }> }).proofs;
  return { name: 'no-kill-by-name', ...proofs['no-kill-by-name']! };
}

// ---- The world: maya's machine, her hub and her clone of acme/shop.
export interface World {
  dir: string;
  /** maya's home: the hub's root is <maya>/.deepbuild. */
  maya: string;
  hub: Hub;
  bare: string;
  /** maya's clone of acme/shop. */
  shop: string;
  /** The link between the other machines and the hub's network port. */
  link: Link;
  /** PATH with the stand-ins first. */
  path: string;
  /** The hub's settings, for a restart. */
  env: Record<string, string | undefined>;
  /** maya's own machine, as a client of her hub over its socket. */
  me: Machine;
}
export async function world(o: { plant?: string } = {}): Promise<World> {
  const dir = tempDir();
  const maya = join(dir, 'm');
  seedRules(maya);
  // Surface 1: where the hub listens once it has project members.
  writeFileSync(join(maya, '.deepbuild', 'config.json'), `${JSON.stringify({ hub: { [SURFACE.listen.key]: SURFACE.listen.value } })}\n`);
  // The forge is a boundary this repo doesn't own: one that knows nothing, on 127.0.0.1.
  const forge = createServer((_req, res) => { res.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not Found"}'); });
  servers.push(forge);
  await new Promise<void>((resolve) => forge.listen(0, '127.0.0.1', resolve));
  const forgePort = (forge.address() as { port: number }).port;
  mkdirSync(join(dir, 'bin'));
  const stub = (name: string, body: string) => { writeFileSync(join(dir, 'bin', name), `#!/bin/sh\n${body}`); chmodSync(join(dir, 'bin', name), 0o755); };
  stub('gh', 'echo "gh: not signed in (test stand-in)" >&2\nexit 1\n');
  for (const agent of ['claude', 'codex']) stub(agent, `[ "$1 $2 $3" = "plugin list --json" ] && { echo '[]'; exit 0; }\necho "${agent}: test stand-in" >&2\nexit 1\n`);
  writeFileSync(join(dir, 'confirm'), 'confirmed\n');
  const path = `${join(dir, 'bin')}:${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`;

  const origin = join(dir, 'o', 'shop');
  mkdirSync(origin, { recursive: true });
  git(origin, 'init', '-q');
  writeFileSync(join(origin, 'README.md'), '# shop\n');
  git(origin, 'add', '-A');
  git(origin, 'commit', '-q', '-m', 'Start');
  const bare = join(dir, 'o', 'shop.git');
  git(dirname(origin), 'clone', '-q', '--bare', origin, bare);
  const shop = clone(bare, join(maya, 'src', 'shop'), 'https://github.com/acme/shop.git');

  const env = { PATH: path, DEEP_HUB_TEST_FORGE: `http://127.0.0.1:${forgePort}`, DEEP_HUB_TEST_CONFIRM: join(dir, 'confirm'), GH_TOKEN: undefined, GITHUB_TOKEN: undefined };
  const hub = await startHub({ home: maya, ...(o.plant !== undefined && { plant: o.plant }), env }, 60_000);
  const w: World = { dir, maya, hub, bare, shop, path, env, me: { name: 'maya', home: maya, clone: shop, path }, link: undefined as unknown as Link };
  w.link = await openLink(() => hubPort(w.hub.pid));
  return w;
}

/** A control connection as the hub's owner: the cli hello with the control token. */
export async function owner(w: World): Promise<Conn> {
  const conn = await Conn.open(w.hub.socket);
  conn.send({ v: 1, hello: 'cli', token: tokenOf(w.hub.root) });
  const reply = await conn.next();
  if (!reply || 'error' in reply) { conn.close(); throw Error(`BLOCKED: the hub refused its owner's control hello: ${JSON.stringify(reply)}`); }
  return conn;
}
async function ownerCall(w: World, method: string, params: Line): Promise<Line> {
  const conn = await owner(w);
  try { return await conn.call(method, params, 30_000); } finally { conn.close(); }
}

// ---- Ports (README, The surface under test: lsof on the hub and its descendants).
export interface Listener { pid: number; address: string; port: number }
function descendants(pid: number): number[] {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const out = [pid];
  for (let i = 0; i < out.length; i++) for (const [p, pp] of rows) if (pp === out[i] && p !== undefined && !out.includes(p)) out.push(p);
  return out;
}
/** Every TCP port the hub's process, or any process it started, listens on. */
export function listening(pid: number): Listener[] {
  let text: string;
  try {
    text = execFileSync('lsof', ['-nP', '-a', '-p', descendants(pid).join(','), '-iTCP', '-sTCP:LISTEN', '-Fpn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    // lsof exits 1 when it finds nothing.
    const e = error as { status?: number; stdout?: string };
    if (e.status === 1) text = e.stdout ?? '';
    else throw Error(`BLOCKED: lsof couldn't list the hub's ports: ${String((error as Error).message)}`);
  }
  const out: Listener[] = [];
  let current = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('p')) current = Number(line.slice(1));
    else if (line.startsWith('n')) out.push({ pid: current, address: line.slice(1), port: Number(line.slice(line.lastIndexOf(':') + 1)) });
  }
  return out;
}
/** The hub's network port, or undefined while it listens on none. */
export function hubPort(pid: number): number | undefined {
  return listening(pid)[0]?.port;
}

// ---- The link: a TCP forwarder from the other machines to the hub's network port.
export interface Link {
  port: number;
  /** Added to every chunk, each way. */
  delayMs: number;
  /** Connections this link carried to the hub. */
  carried: number;
  cut(): void;
  restore(): void;
  close(): void;
}
/**
 * A link that can be slowed and cut: each connection to it is joined to the hub's network port (resolved at connect
 * time), every chunk held `delayMs` each way. Cut, it is a dead link: connections are taken and held silent, nothing
 * passes either way, and no reset is sent; restored, held connections are dropped and new ones carry again.
 */
export function openLink(target: () => number | undefined): Promise<Link> {
  const live = new Set<{ a: net.Socket; b?: net.Socket; dead: boolean }>();
  let cut = false;
  const server = net.createServer((a) => {
    const pair: { a: net.Socket; b?: net.Socket; dead: boolean } = { a, dead: cut };
    live.add(pair);
    a.on('error', () => undefined);
    a.on('close', () => { pair.b?.destroy(); live.delete(pair); });
    if (cut) return;
    const port = target();
    if (!port) { a.destroy(); return; }
    link.carried++;
    const b = net.connect(port, '127.0.0.1');
    pair.b = b;
    b.on('error', () => a.destroy());
    b.on('close', () => { if (!pair.dead) a.destroy(); });
    const forward = (from: net.Socket, to: net.Socket) => from.on('data', (chunk: Buffer) => {
      if (pair.dead) return;
      const send = () => { if (!pair.dead && !to.destroyed) to.write(chunk); };
      if (link.delayMs > 0) setTimeout(send, link.delayMs); else send();
    });
    forward(a, b);
    forward(b, a);
    a.on('end', () => { if (!pair.dead) setTimeout(() => b.end(), link.delayMs); });
    b.on('end', () => { if (!pair.dead) setTimeout(() => a.end(), link.delayMs); });
  });
  const link: Link = {
    port: 0, delayMs: 0, carried: 0,
    cut: () => { cut = true; for (const p of live) p.dead = true; },
    restore: () => { cut = false; for (const p of [...live]) if (p.dead) { p.a.destroy(); p.b?.destroy(); live.delete(p); } },
    close: () => { for (const p of live) { p.a.destroy(); p.b?.destroy(); } server.close(); },
  };
  links.push(link);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { link.port = (server.address() as net.AddressInfo).port; resolve(link); });
  });
}

// ---- People and machines (surfaces 2, 3, 6).
/** The owner invites a person to acme/shop, reaching the hub at the link (surface 2); the invite string. */
export async function invite(w: World, person: string): Promise<string> {
  const reply = await ownerCall(w, SURFACE.invite, { person, repo: w.shop, address: `127.0.0.1:${w.link.port}` });
  if ('error' in reply) throw Error(`BLOCKED: the hub issues no invite (${SURFACE.invite} {person: ${JSON.stringify(person)}, repo: <maya's clone of acme/shop>, address: "127.0.0.1:<port>"} on the owner's control connection, answered {invite}): it answered ${JSON.stringify(reply.error)}`);
  const said = (reply.result as Line | undefined)?.invite;
  if (typeof said !== 'string' || !said) throw Error(`BLOCKED: ${SURFACE.invite} answered no invite string: ${JSON.stringify(reply.result)}`);
  return said;
}
/** The owner revokes a person's credential (surface 6); resolves when the hub has answered, at that time (ms). */
export async function revoke(w: World, person: string): Promise<number> {
  const reply = await ownerCall(w, SURFACE.revoke, { person });
  if ('error' in reply) throw Error(`BLOCKED: the hub revokes no credential (${SURFACE.revoke} {person: ${JSON.stringify(person)}} on the owner's control connection): it answered ${JSON.stringify(reply.error)}`);
  return Date.now();
}

/** Another machine: a home of its own with the shipped fast rules, as `deep setup` leaves it, and a clone of acme/shop. */
export interface Machine { name: string; home: string; clone: string; path: string }
export function machine(w: World, name: string): Machine {
  const home = join(w.dir, name);
  seedRules(home);
  return { name, home, clone: clone(w.bare, join(home, 'code', 'shop'), REPO_LINK), path: w.path };
}
const shown = (r: Ran): string => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}; stdout: ${r.stdout.trim().slice(0, 1500)}; stderr: ${r.stderr.trim().slice(0, 1500)}`;
/** `deep <args>` on a machine, in its clone. */
export const deepOn = (m: Machine, args: readonly string[], timeoutMs = 60_000): Promise<Ran> => deep(m.home, args, { cwd: m.clone, env: { PATH: m.path }, timeoutMs });
/** A person's machine joined to the project by the repo link and an invite (surface 3). */
export async function joined(w: World, person: string): Promise<Machine> {
  const code = await invite(w, person);
  const m = machine(w, person);
  const r = await deepOn(m, SURFACE.join(REPO_LINK, code), 120_000);
  if (r.code === 2 || /usage|unknown command/i.test(r.stderr) && r.code !== 0) throw Error(`BLOCKED: \`deep ${SURFACE.join(REPO_LINK, '<invite>').join(' ')}\` doesn't join (${shown(r)})`);
  if (r.code !== 0) throw Error(`${person}'s machine must join the project by the repo link and the invite, exit 0: ${shown(r)}`);
  return m;
}
/** A machine's read of the project (surface 4). */
export const readOn = (m: Machine): Promise<Ran> => deepOn(m, SURFACE.read);
export { shown };

/** The machine's files under ~/.deepbuild, all but its keys (surface 5): what a copied credential carries. */
export function copyWithoutKeys(from: Machine, to: Machine): void {
  const src = join(from.home, '.deepbuild');
  const dst = join(to.home, '.deepbuild');
  if (!existsSync(join(dst, SURFACE.keys)) || !readdirSync(join(dst, SURFACE.keys)).length) throw Error(`BLOCKED: ${to.name}'s machine holds no key under ~/.deepbuild/${SURFACE.keys}/ after joining`);
  if (!existsSync(join(src, SURFACE.keys)) || !readdirSync(join(src, SURFACE.keys)).length) throw Error(`BLOCKED: ${from.name}'s machine holds no key under ~/.deepbuild/${SURFACE.keys}/ after joining`);
  // The other machine keeps only its own keys: its own credential and settings go, so it can present only the copy.
  for (const entry of readdirSync(dst)) if (entry !== SURFACE.keys) rmSync(join(dst, entry), { recursive: true, force: true });
  for (const entry of readdirSync(src)) if (entry !== SURFACE.keys) cpSync(join(src, entry), join(dst, entry), { recursive: true });
}

// ---- Sessions and hooks through the real deep-hook.
export function needDeepHook(): string {
  if (!existsSync(DEEP_HOOK)) throw Error(`BLOCKED: no deep-hook at ${DEEP_HOOK}; build it first: CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook`);
  return DEEP_HOOK;
}
export interface Hooked extends Ran { ms: number }
/** One hook as an agent runs it: `deep-hook claude-code <event>` with its payload on stdin, timed from spawn to exit. */
export async function hook(home: string, s: Session, event: string, extra: Line = {}, path?: string): Promise<Hooked> {
  const start = performance.now();
  const r = await run(needDeepHook(), ['claude-code', event], { cwd: s.cwd, env: childEnv(home, path ? { PATH: path } : {}), input: JSON.stringify(payload(s, event, extra)), timeoutMs: 60_000 });
  return { ...r, ms: performance.now() - start };
}
/** What deep-hook's output tells Claude Code about a PreToolUse: exit 2 or a deny decision denies; exit 0 allows. */
export function decision(r: Ran): 'deny' | 'allow' | 'other' {
  let out: Line | undefined;
  try { out = JSON.parse(r.stdout.trim()) as Line; } catch { out = undefined; }
  const said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  if (r.code === 0 && (said === undefined || said === 'allow')) return 'allow';
  return 'other';
}
/** Every event the record holds, as the owner reads it. */
export async function record(w: World): Promise<Ev[]> {
  const conn = await owner(w);
  try { return await allEvents(conn); } finally { conn.close(); }
}
/** The owner's read once `enough` holds of it (up to `timeoutMs`); the last read either way. */
export async function recordUntil(w: World, enough: (events: Ev[]) => boolean, timeoutMs: number): Promise<Ev[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const events = await record(w);
    if (enough(events) || Date.now() > deadline) return events;
    await sleep(250);
  }
}
/** maya works in her clone: a session's opening hooks through deep-hook; its ID and its events' IDs, once recorded. */
export async function mayaWorks(w: World): Promise<{ session: Session; ids: string[] }> {
  const session = newSession(w.maya, 'claude-code', w.shop);
  for (const event of ['SessionStart', 'UserPromptSubmit']) await hook(w.maya, session, event, {}, w.path);
  const events = await recordUntil(w, (evs) => evs.filter((e) => e.session === session.id).length >= 2, 30_000);
  const ids = events.filter((e) => e.session === session.id).map((e) => e.id);
  if (ids.length < 2) throw Error(`BLOCKED: maya's session ${session.id} never reached the record through deep-hook on her own machine`);
  return { session, ids };
}

// ---- A client with no credential: raw bytes to the hub's network port.
const ASKS = [
  { v: 1, hello: 'cli' }, { v: 1, id: 1, method: 'events.read', params: { after: 0, limit: 1000 } },
  { v: 1, id: 2, method: 'sessions.read', params: {} }, { v: 1, id: 3, method: 'status.read', params: {} },
].map((l) => `${JSON.stringify(l)}\n`).join('');
/** What the hub's network port sends a client that presents nothing: over plain TCP, and over TLS with no client credential. */
export async function noCredential(port: number): Promise<{ plain: string; tls: string }> {
  const collect = (open: (done: (text: string) => void) => net.Socket) => new Promise<string>((resolve) => {
    let text = '';
    let finished = false;
    const done = () => { if (!finished) { finished = true; sock.destroy(); resolve(text); } };
    const sock = open(done);
    sock.on('data', (d: Buffer) => { text += d.toString('utf8'); });
    sock.on('error', done);
    sock.on('close', done);
    setTimeout(done, 3000);
  });
  const plain = await collect(() => { const s = net.connect(port, '127.0.0.1', () => s.write(ASKS)); return s; });
  const secure = await collect(() => { const s = tls.connect({ port, host: '127.0.0.1', rejectUnauthorized: false }, () => s.write(ASKS)); return s; });
  return { plain, tls: secure };
}

// ---- Generations (AC3): records of one hub at generation 2 and 3, made by the record's own restore (#572), which
// raises the generation above the backup's and the replaced record's.
/** With the hub stopped: its record raised to generation 3, and a copy of it at generation 2, the hub left behind. */
export async function generations(w: World): Promise<{ stale: string }> {
  const ledger = join(w.hub.root, 'ledger.db');
  const dir = join(w.dir, 'gens');
  mkdirSync(dir);
  const copy = (from: string, to: string) => { for (const x of ['', '-wal']) if (existsSync(from + x)) cpSync(from + x, to + x); };
  const g1 = join(dir, 'g1.db');
  copy(ledger, g1);
  (await prepareRestore(g1, ledger)).put();
  const stale = join(dir, 'g2.db');
  copy(ledger, stale);
  (await prepareRestore(g1, ledger)).put();
  const [now, then] = [writerGeneration(ledger), writerGeneration(stale)];
  if (now !== 3 || then !== 2) throw Error(`BLOCKED: the record's restore made generations ${now} and ${then}, not 3 and 2`);
  return { stale };
}
/** The hub's record swapped for another file, as a copy of the hub left behind on another machine would hold. */
export function putRecord(w: World, file: string): void {
  const ledger = join(w.hub.root, 'ledger.db');
  for (const x of ['', '-wal', '-shm']) rmSync(ledger + x, { force: true });
  cpSync(file, ledger);
}
/** Stops the hub, runs `between`, and starts it again on the same root with the same settings. */
export async function restart(w: World, between: () => Promise<void> | void = () => undefined): Promise<void> {
  await stopHub(w.hub);
  await between();
  w.hub = await startHub({ home: w.maya, env: w.env }, 60_000);
}
/** The writer generation a new connection's hello names. */
export async function helloGeneration(w: World): Promise<unknown> {
  const conn = await Conn.open(w.hub.socket);
  conn.close();
  return conn.hello?.generation;
}
/** The text of every file in a machine's spool folder. */
export function spoolText(home: string): string {
  const dir = join(home, '.deepbuild', 'spool');
  if (!existsSync(dir)) return '';
  return readdirSync(dir).map((f) => { try { return readFileSync(join(dir, f), 'utf8'); } catch { return ''; } }).join('\n');
}
