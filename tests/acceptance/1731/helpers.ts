// Test-side tools for the #1731 acceptance tests: a world of a real hub (`deep hub run`) in a temp home, the fixture
// library (library.ts) over HTTPS on 127.0.0.1 under a test CA the hub trusts through NODE_EXTRA_CA_CERTS, the test
// fill (fixtures/shelf) installed through `deep install`, a `deep mcp` the test talks to as an agent's MCP client
// does, the hub's socket as the cli role (your trusted path, the OS confirmation stubbed by DEEP_HUB_TEST_CONFIRM),
// `deep inbox answer` and `deep show`; and the judges each criterion's test and its planted fill share. No hub, CLI or
// extension-host module is imported but the extension host's public entry, for `packageDigest` only.
//
// Safety: every folder is under /tmp/dh1731-* and removed after its file; HOME is a temp home for every child;
// DEEP_*, CLAUDE*, CODEX* and NODE_OPTIONS are left out of their environment; nothing leaves 127.0.0.1; every process
// is one this file started, stopped by its PID.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import { asset, ASSETS, openLibrary, reportedLicense, thumbHash, TRIANGLES, type Library, wordsOf } from './library.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const NODE = process.execPath;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
/** The fill's registered source name: the library, as rows, asks and refusals name it. */
export const LIB = 'ext.shelf.library';
/** The criterion's search (AC1, and "the same search" of AC4 and AC5). */
export const RANGE: [number, number] = [0.4, 1.2];
export const SEARCH = { op: 'assets', query: 'chair', size_m: RANGE, limit: 50 };
/** A document ID for `deep show` (Document envelope: a ULID). */
export const DOC = '01JB1731D00000000000000001';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const parse = (text: string): Line | undefined => { try { const v: unknown = JSON.parse(text); return typeof v === 'object' && v !== null ? (v as Line) : undefined; } catch { return undefined; } };

// ---- Temp folders and processes, all gone after the file.
const made: string[] = [];
export function tempDir(): string {
  const dir = realpathSync(mkdtempSync('/tmp/dh1731-'));
  made.push(dir);
  return dir;
}
const owned = new Set<number>();
const closers: (() => Promise<void>)[] = [];
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
afterAll(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 3000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 30_000);

function childEnv(home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|AI_AGENT)/.test(key) || key === 'NODE_OPTIONS' || key === 'NODE_EXTRA_CA_CERTS') continue;
    env[key] = value;
  }
  return { ...env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C', ...extra };
}
export interface Ran { code: number | null; stdout: string; stderr: string }
export const shown = (r: Ran) => `exit ${r.code}, stdout ${JSON.stringify(r.stdout.slice(-1500))}, stderr ${JSON.stringify(r.stderr.slice(-1500))}`;
function run(args: readonly string[], home: string, cwd: string): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(NODE, [CLI, ...args], { cwd, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 300_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

// ---- TLS: a test CA and a leaf for 127.0.0.1, made per world with openssl; the hub trusts the CA only.
function certs(dir: string): { key: string; cert: string; ca: string } {
  const at = (f: string) => join(dir, f);
  writeFileSync(at('ca.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_ca]\nbasicConstraints = critical,CA:TRUE\nkeyUsage = critical,keyCertSign,cRLSign\nsubjectKeyIdentifier = hash\n');
  writeFileSync(at('leaf.cnf'), '[req]\ndistinguished_name = dn\n[dn]\n[v3_leaf]\nbasicConstraints = CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\nsubjectAltName = IP:127.0.0.1\n');
  const ssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  ssl('req', '-x509', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=dh1731 test CA', '-config', 'ca.cnf', '-extensions', 'v3_ca');
  ssl('req', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=127.0.0.1', '-config', 'leaf.cnf');
  ssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '2', '-extfile', 'leaf.cnf', '-extensions', 'v3_leaf');
  return { key: readFileSync(at('leaf.key'), 'utf8'), cert: readFileSync(at('leaf.pem'), 'utf8'), ca: at('ca.pem') };
}

// ---- The fill: fixtures/shelf copied, `*.fixture` renamed, its probe and its host written, its digest set.
export type Plant = 'measures-by-download' | 'reports-cc0';
async function fill(dir: string, host: string, plant?: Plant): Promise<string> {
  cpSync(join(FIXTURES, 'shelf'), dir, { recursive: true });
  for (const name of readdirSync(dir)) if (name.endsWith('.fixture')) renameSync(join(dir, name), join(dir, name.slice(0, -'.fixture'.length)));
  writeFileSync(join(dir, 'probe.json'), JSON.stringify({ host, ...(plant ? { plant } : {}) }));
  const path = join(dir, 'deepbuild.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as Line;
  manifest.sources[0].host = host;
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  const { packageDigest } = await import(new URL('../../../packages/extension-host/src/index.ts', import.meta.url).href) as typeof import('../../../packages/extension-host/src/index.ts');
  manifest.digest = packageDigest(dir);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}

// ---- The hub.
interface Hub { pid: number; socket: string; root: string; child: ChildProcess }
async function startHub(home: string, env: Record<string, string>): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(home, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  if (child.pid) owned.add(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-8000)));
  const ready = await new Promise<Line | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (out.includes('\n')) { clearTimeout(timer); resolve(parse(out.split('\n')[0]!)); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(undefined); });
  });
  if (ready?.ready !== true) throw Error(`BLOCKED: the hub didn't start (deep hub run): ${out.slice(0, 500)} ${err.slice(-1500)}`);
  return { pid: child.pid!, socket: typeof ready.socket === 'string' ? ready.socket : join(home, '.deepbuild', 'hub.sock'), root: join(home, '.deepbuild'), child };
}

/** One call on the hub's socket as the cli role, with the control token and this process for the peer check: the reply line. */
export async function control(w: World, method: string, params: Line, timeoutMs = 60_000): Promise<Line> {
  const token = readFileSync(join(w.hub.root, 'control.token'), 'utf8').trim();
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], { env: { ...process.env, LC_ALL: 'C' }, encoding: 'utf8' }).trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(w.hub.socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`BLOCKED: the hub gave no answer to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (error) => { clearTimeout(timer); reject(error); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = parse(buffer.slice(0, i)) ?? {};
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: 'cli', token, peer: { pid: process.pid, start } })}\n`); }
        else if (step === 1) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (line.id === 1) { clearTimeout(timer); sock.destroy(); resolve(line); }
      }
    });
  });
}
/** A cli call that must succeed: its result; a method the hub doesn't serve reads BLOCKED. */
export async function must(w: World, method: string, params: Line): Promise<Line> {
  const reply = await control(w, method, params);
  if (reply.error) throw Error(`${reply.error.code === 'unknown_method' ? 'BLOCKED: ' : ''}${method} ${JSON.stringify(params)} was refused: ${JSON.stringify(reply.error)}`);
  return reply.result as Line;
}

/** Every event in the hub's record, through events.read on the cli role. */
export async function events(w: World): Promise<Line[]> {
  const all: Line[] = [];
  for (let after = 0; ;) {
    const page = (await must(w, 'events.read', { after, limit: 1000 })).events as Line[];
    all.push(...page);
    if (page.length < 1000) return all;
    after = page[page.length - 1]!.log_pos;
  }
}
const dataOf = (e: Line): Line => (typeof e.data === 'string' ? parse(e.data) ?? {} : e.data ?? {});
/** The asks raised in the record, oldest first, each `{handle, kind, text, data}`; `kind` keeps one kind only. */
export async function asks(w: World, kind?: string): Promise<{ handle: string; kind: string; text: string; data: Line }[]> {
  return (await events(w)).filter((e) => e.kind === 'ask.created').map((e) => ({ handle: `ask:${String(e.id)}`, kind: String(dataOf(e).kind), text: JSON.stringify(dataOf(e)), data: dataOf(e) }))
    .filter((a) => !kind || a.kind === kind);
}
/** Your yes to an ask, on the trusted path: `deep inbox answer <ask> <the option whose decision is allow>`. */
export async function yes(w: World, ask: { handle: string; data: Line }): Promise<Ran> {
  const option = (ask.data.options as Line[] | undefined)?.find((o) => o.decision === 'allow')?.id;
  if (typeof option !== 'string') throw Error(`${ask.handle} has no option that says yes: ${JSON.stringify(ask.data.options)}`);
  return run(['inbox', 'answer', ask.handle, option], w.home, w.work);
}
/** The evidence store's entry for a hash (evidence.read), or undefined when it holds none. */
export async function stored(w: World, sha: string): Promise<Line | undefined> {
  const reply = await control(w, 'evidence.read', { sha });
  return reply.error ? undefined : (reply.result.evidence as Line);
}

// ---- deep mcp, as an agent's MCP client talks to it.
export interface Outcome { isError: boolean; value: Line; text: string }
class Mcp {
  private lines: string[] = [];
  private wakers = new Set<() => void>();
  private n = 0;
  constructor(private readonly child: ChildProcess) {
    let buffer = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      buffer += d;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) { this.lines.push(buffer.slice(0, i)); buffer = buffer.slice(i + 1); }
      for (const w of [...this.wakers]) w();
    });
    child.stdin!.on('error', () => undefined);
  }
  request(method: string, params: Line, timeoutMs = 300_000): Promise<Line> {
    const id = ++this.n;
    this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.wakers.delete(check); reject(Error(`deep mcp gave no reply to ${method} in ${timeoutMs} ms`)); }, timeoutMs);
      const check = () => {
        const found = this.lines.map((l) => parse(l)).find((l) => l?.id === id);
        if (found) { clearTimeout(timer); this.wakers.delete(check); resolve(found); }
        else if (this.child.exitCode !== null) { clearTimeout(timer); this.wakers.delete(check); reject(Error(`deep mcp exited ${this.child.exitCode}`)); }
      };
      this.wakers.add(check);
      check();
    });
  }
  notify(method: string): void { this.child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method, params: {} })}\n`); }
}
async function startMcp(home: string, cwd: string): Promise<Mcp> {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'ignore'] });
  if (child.pid) owned.add(child.pid);
  const mcp = new Mcp(child);
  const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-1731', version: '0' } });
  if (!init.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init)}`);
  mcp.notify('notifications/initialized');
  return mcp;
}
/** One deep_kinds call through deep mcp. */
export async function kinds(w: World, args: Line): Promise<Outcome> {
  const reply = await w.mcp.request('tools/call', { name: 'deep_kinds', arguments: args });
  if (reply.error) return { isError: true, value: reply.error as Line, text: JSON.stringify(reply.error) };
  const result = (reply.result ?? {}) as Line;
  const text = Array.isArray(result.content) ? String(result.content.find((c: Line) => c?.type === 'text')?.text ?? '') : '';
  const value = (result.structuredContent ?? parse(text) ?? {}) as Line;
  return { isError: result.isError === true, value, text: text || JSON.stringify(value) };
}
/** The search's rows; a reply with no `rows` list fails, naming the reply. */
export async function search(w: World): Promise<{ rows: Line[]; outcome: Outcome }> {
  const outcome = await kinds(w, SEARCH);
  if (outcome.isError || !Array.isArray(outcome.value.rows)) throw Error(`deep_kinds ${JSON.stringify(SEARCH)} gave no rows: ${outcome.text.slice(0, 1500)}`);
  return { rows: outcome.value.rows as Line[], outcome };
}
export const libraryRows = (rows: Line[]): Line[] => rows.filter((r) => r.from?.library === LIB);
export const fetchArgs = (id: string): Line => ({ op: 'fetch', library: LIB, id });
/** The words of a refusal: an error, or a reply whose status is refused; undefined for anything else. */
export const refusal = (o: Outcome): string | undefined => (o.isError || o.value.status === 'refused' ? o.text : undefined);
/** Whether a reply says BLOCKED. */
export const blocked = (o: Outcome): boolean => o.value.status === 'BLOCKED' || /\bBLOCKED\b/.test(o.text);
/** A fetch called again until it no longer says held (the job after your yes), up to `ms`. */
export async function fetchUntilDone(w: World, id: string, ms = 300_000): Promise<Outcome> {
  const deadline = Date.now() + ms;
  for (;;) {
    const o = await kinds(w, fetchArgs(id));
    if (o.value.status !== 'held' || Date.now() > deadline) return o;
    await sleep(1000);
  }
}

// ---- deep show: a document with one asset.game@1 item naming a stored asset, checked, as you.
export function gameDoc(item: string, sha: string): Line {
  return {
    format: 1, profile: 'scene', title: 'Library chair', description: 'One game-ready prop from a fetched library asset (#1731).',
    size: [320, 200], items: { [item]: { id: item, kind: 'asset.game@1', name: item, from: { asset: sha }, budget: 'small_prop' } },
  };
}
export async function show(w: World, document: Line): Promise<{ ran: Ran; reply: Line | undefined }> {
  const file = join(w.tmp, `doc-${Date.now()}.json`);
  writeFileSync(file, JSON.stringify(document));
  const ran = await run(['show', '--doc', DOC, '--document', file, '--check', '--json'], w.home, w.work);
  const reply = ran.stdout.trim().split('\n').reverse().map((l) => parse(l)).find(Boolean);
  return { ran, reply };
}
/** Whether a checked document refused an item: the revision refused, or an error-severity issue naming the item. */
export const refusedItem = (reply: Line | undefined, item: string): boolean => reply?.outcome === 'refused'
  || ((reply?.issues as Line[] | undefined) ?? []).some((i) => i.severity === 'error' && (i.ids as string[] | undefined ?? []).includes(item));

// ---- The world.
export interface World {
  tmp: string; home: string; work: string; library: Library; hub: Hub; mcp: Mcp;
  /** `deep install` of the fill: exit 0 when it loaded. */
  install: Ran;
}
export async function openWorld(plant?: Plant): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const work = join(tmp, 'work');
  mkdirSync(home);
  mkdirSync(work);
  mkdirSync(join(tmp, 'tls'));
  const tls = certs(join(tmp, 'tls'));
  const library = await openLibrary(tls);
  closers.push(() => library.close());
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const hub = await startHub(home, { DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), NODE_EXTRA_CA_CERTS: tls.ca });
  const dir = await fill(join(tmp, 'shelf'), library.host, plant);
  const install = await run(['install', dir], home, work);
  const mcp = await startMcp(home, work);
  return { tmp, home, work, library, hub, mcp, install };
}
/** A world whose fill loaded and is turned on (library.on), as every unplanted test needs. */
export async function onWorld(): Promise<World> {
  const w = await openWorld();
  if (w.install.code !== 0) throw Error(`deep install of the fill didn't load it: ${shown(w.install)}`);
  await must(w, 'library.on', { library: LIB });
  return w;
}

// ---- The proof, rewritten each run under $TMPDIR/deep-1731-proof/.
export const PROOF_DIR = join(tmpdir(), 'deep-1731-proof');
export function proof(name: string, value: unknown): void {
  mkdirSync(PROOF_DIR, { recursive: true });
  writeFileSync(join(PROOF_DIR, name), `${JSON.stringify(value, null, 2)}\n`);
}

/** The file requests the library's log holds since index `from`, as text. */
export const filesFetched = (w: World, from: number): string[] => w.library.log.slice(from).filter((q) => q.path.startsWith('/files/')).map((q) => `${q.method} ${q.path}`);
/** Whether a text names a byte count as a number of its own. */
export const namesNumber = (text: string, n: number): boolean => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(text);
export const CC_BY_WORDS = /CC[- ]BY[- ]4\.0/i;

// ---- Judges: each returns its failures in words; none is a pass.

/** The chairs the search must return, in #979's order: words matched (all one here), then nearest the range's middle. */
export function expectedChairs(): string[] {
  const mid = (RANGE[0] + RANGE[1]) / 2;
  return [...ASSETS.values()].map((a) => a.record).filter((r) => wordsOf(r).has('chair') && r.size_m !== null && r.size_m >= RANGE[0] && r.size_m <= RANGE[1])
    .sort((a, b) => Math.abs(a.size_m! - mid) - Math.abs(b.size_m! - mid)).map((r) => r.id);
}
/**
 * AC1's judge, on the rows a search returned and the request log of that search: exactly the chairs in range, in
 * #979's order, each row as the slot answers one, read against the library's own record; and no file in the log.
 */
export function judgeSearch(rows: Line[], library: Library, from: number): string[] {
  const failures: string[] = [];
  const ours = libraryRows(rows);
  const want = expectedChairs();
  const got = ours.map((r) => String(r.id));
  if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`the library's rows are ${JSON.stringify(got)}; the chairs in [${RANGE}] in #979's order (words matched, then size fit) are ${JSON.stringify(want)}`);
  for (const r of ours) {
    const rec = ASSETS.get(String(r.id))?.record;
    if (!rec || !wordsOf(rec).has('chair')) { failures.push(`row ${String(r.id)} is no chair of the library`); continue; }
    const expected = { id: rec.id, name: rec.name, kind: rec.type, license: reportedLicense(rec.license), size_m: rec.size_m, triangles: TRIANGLES, thumbnail: thumbHash(rec.id), url: rec.url };
    const actual = { id: r.id, name: r.name, kind: r.kind, license: r.license, size_m: r.size_m, triangles: r.triangles, thumbnail: r.thumbnail, url: r.url };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`row ${rec.id} reads ${JSON.stringify(actual)}; the library's own record says ${JSON.stringify(expected)}`);
  }
  const files = library.log.slice(from).filter((q) => q.path.startsWith('/files/'));
  if (files.length) failures.push(`the library's request log shows the search fetched ${files.length} files: ${files.map((q) => `${q.method} ${q.path}`).join(', ')}`);
  return failures;
}

/**
 * AC3's judge, on the unknown-license model: its row's license is the one the library's own record states, its fetch
 * is BLOCKED with exactly one unblock ask and no authority ask, and no byte of it was fetched or stored.
 */
export async function judgeUnknown(w: World, id: string): Promise<string[]> {
  const failures: string[] = [];
  const want = reportedLicense(asset(id).record.license);
  const row = libraryRows((await search(w)).rows).find((r) => r.id === id);
  if (!row) failures.push(`row ${id} is missing from the search`);
  else if (row.license?.id !== want.id) failures.push(`row ${id} reads license ${JSON.stringify(row.license?.id)}; the library's own record (/api/assets/${id}) says ${want.id}`);
  const before = await asks(w);
  const from = w.library.log.length;
  const first = await kinds(w, fetchArgs(id));
  const second = await kinds(w, fetchArgs(id));
  const raised = (await asks(w)).slice(before.length);
  if (!blocked(first) || !blocked(second)) failures.push(`the fetch of ${id} isn't BLOCKED: ${first.text.slice(0, 600)}`);
  const unblock = raised.filter((a) => a.kind === 'unblock');
  if (unblock.length !== 1) failures.push(`two fetches of ${id} raised ${unblock.length} unblock asks, not one`);
  const authority = raised.filter((a) => a.kind === 'authority');
  if (authority.length) failures.push(`the fetch of ${id} raised an authority ask, as for a license it may take: ${authority[0]!.text.slice(0, 400)}`);
  const files = w.library.log.slice(from).filter((q) => q.path.startsWith('/files/'));
  if (files.length) failures.push(`the library's request log shows ${id}'s bytes fetched: ${files.map((q) => q.path).join(', ')}`);
  for (const f of asset(id).record.files) if (await stored(w, f.sha256)) failures.push(`the store holds ${f.path} (${f.sha256})`);
  return failures;
}
