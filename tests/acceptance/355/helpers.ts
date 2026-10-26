// Test-side tools for the #355 acceptance tests: temp homes under /tmp/dh355-*, a test clock, real git repos,
// sessions with archived transcripts in the real evidence store, decisions and project trust through the record,
// the wiki's writer (`@deepbuild/wiki`, loaded lazily so this file loads at the base), the pages it writes read
// back line by line, every quote checked against the source the test itself wrote, and the hub, `deep mcp` and
// the agent stand-in of tests/acceptance/26 (imported, never copied). Nothing here stands in for the wiki, the
// index, the record or the hub: the tests reach them only through the surfaces the README names.
//
// Safety: every folder is under /tmp/dh355-* (real paths); HOME is a temp folder for this process and for every
// child; no test touches the real ~/.deepbuild; no network (the one HTTP server listens on 127.0.0.1 to see that
// nothing fetches a link); processes are stopped by PID only (26's cleanup), never by name or port.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { openEvidenceStore, type Evidence, type EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openTrust } from '../../../packages/extension-host/src/index.ts';
import { openRecord, type Connection, type Event, type RecordStore } from '../../../packages/record/src/index.ts';
import { callTool, cleanup as cleanup26, initialize, McpProcess, startHub, stopHub, valueOf, type Hub, type Line, type Mcp } from '../26/helpers.ts';
import { buildDeepHook } from '../316/helpers.ts';

export { callTool, initialize, McpProcess, valueOf, type Hub, type Line, type Mcp };
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SECOND = 1000;
export const MINUTE = 60_000;

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];
/** Your real home, kept only so cargo finds its toolchain when it builds deep-hook (nothing of DeepBuild's is read there). */
const TOOLCHAIN_HOME = process.env.HOME;

// ---- Temp folders and the processes the suite started.
const made: string[] = [];
export function tempDir(tag = 'w'): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh355-${tag}-`));
  made.push(dir);
  return dir;
}
process.env.HOME = tempDir('home');
/** Stops every process the suite started, by PID, and removes the temp folders. */
export async function cleanup(): Promise<void> {
  await cleanup26();
  for (const server of servers.splice(0)) server.close();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/**
 * deep-hook built by tests/acceptance/316's helper (cargo build, target/debug). Cargo is spawned with your real HOME,
 * so it uses the toolchain installed there instead of fetching one into the test's temp home.
 */
export function buildHookBinary(): Promise<string> {
  const temp = process.env.HOME;
  process.env.HOME = TOOLCHAIN_HOME;
  try {
    return buildDeepHook();
  } finally {
    process.env.HOME = temp;
  }
}

// ---- The test clock: an hour ago, ticking only when told, so the claims are fresh when the hub reads them.
export interface Clock { now(): number; tick(ms?: number): number }
export function makeClock(start = Date.now() - 60 * MINUTE): Clock {
  let t = start;
  return { now: () => t, tick: (ms = SECOND) => (t += ms) };
}
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
/** A ULID at `ms`, unique within this process. */
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted * 7919 + Math.floor(Math.random() * 2 ** 30), i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}
export const sha256 = (text: string | Uint8Array): string => createHash('sha256').update(text).digest('hex');

// ---- Connections: what the hub's socket proved about a writer.
/** You, on the trusted path (the app). */
export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
export const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
export const hookIn = (session: string, project: string): Connection => ({ writer: 'hook', actor: 'you', scope: 'you', session, project, agent: 'claude-code' });
/** An agent's deep mcp, bound to its session. */
export const agentIn = (session: string, project: string): Connection => ({ writer: `mcp:${session}`, actor: 'you', scope: 'you', session, project, agent: 'claude-code' });

// ---- Git repos of their own (never this checkout): each commit writes its files over the last.
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
export interface Repo { dir: string; commits: string[] }
export function makeRepo(dir: string, commits: Record<string, string>[]): Repo {
  mkdirSync(dir, { recursive: true });
  const env = { ...process.env, ...GIT_ENV, HOME: dir };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  const shas: string[] = [];
  commits.forEach((files, i) => {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', `fixture ${i + 1}`);
    shas.push(git('rev-parse', 'HEAD'));
  });
  return { dir: realpathSync(dir), commits: shas };
}
/** A file's text at a commit, read by the test itself. */
export function fileAt(repo: string, commit: string, path: string): string | undefined {
  try { return execFileSync('git', ['show', `${commit}:${path}`], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return undefined; }
}

// ---- The wiki's surface (README: The surface under test), loaded lazily: at the base the package doesn't exist.
export type Known = 'you' | 'decision' | 'repo' | 'inferred' | 'outside';
export type Source = { at: string; quote: string } | { repo: string; path: string; commit: string; quote: string };
export interface Candidate { page: string; id: string; text: string; sources: Source[]; scope: string; supersedes?: string }
export interface Learned { written: string[]; dropped: { claim: string; reason: string }[] }
export interface Wiki {
  learn(candidates: Candidate[]): Promise<Learned>;
  write(): Promise<void>;
  promote(connection: Connection, claim: string): Promise<string>;
}
export interface WikiOptions { record: RecordStore; folder: string; now: () => number; plant?: 'quote-present-only' }
export const WIKI_ENTRY = '../../../packages/wiki/src/index.ts';
export async function openWiki(o: WikiOptions): Promise<Wiki> {
  const entry = (await import(new URL(WIKI_ENTRY, import.meta.url).href)) as { openWiki?: (o: WikiOptions) => Wiki | Promise<Wiki> };
  if (typeof entry.openWiki !== 'function') throw Error('@deepbuild/wiki exports no openWiki');
  return entry.openWiki(o);
}
export const handle = (c: Pick<Candidate, 'page' | 'id'>): string => `wiki:${c.page}#${c.id}`;

// ---- A world: a home whose ~/.deepbuild the hub will run on, its repos, and the text of every source written.
export interface World {
  tmp: string;
  home: string;
  /** <home>/.deepbuild: the hub's root. */
  root: string;
  /** <root>/wiki: the pages. */
  wiki: string;
  /** A folder that is no worktree the hub knows: a deep mcp started there by hand is bound to no session. */
  elsewhere: string;
  clock: Clock;
  /** What each handle the tests cite holds: a transcript message's text, or a decision's answer. */
  said: Map<string, string>;
}
export function makeWorld(): World {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  const elsewhere = join(tmp, 'elsewhere');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  mkdirSync(elsewhere);
  return { tmp, home, root, wiki: join(root, 'wiki'), elsewhere, clock: makeClock(), said: new Map() };
}
export interface Opened { record: RecordStore; store: EvidenceStore }
/** The hub's own ledger and evidence store, opened by the test while no hub runs, then closed. */
export async function withRecord<T>(w: World, fn: (o: Opened) => Promise<T>): Promise<T> {
  const store = await openEvidenceStore({ root: join(w.root, 'evidence'), now: w.clock.now });
  const record = await openRecord({ path: join(w.root, 'ledger.db'), now: w.clock.now, evidence: store });
  try {
    return await fn({ record, store });
  } finally {
    await record.close();
  }
}

// ---- Sessions and their transcripts (Claude Code's JSONL: one entry per line, `uuid` names the message).
/** A message: from you, from the agent, or the result of a fetch the agent made (outside content). */
export interface Msg { id: string; from: 'you' | 'agent' | 'fetch'; text: string; url?: string }
function transcript(session: string, messages: readonly Msg[]): string {
  const lines: Line[] = [];
  for (const m of messages) {
    if (m.from === 'you') lines.push({ type: 'user', uuid: m.id, sessionId: session, message: { role: 'user', content: m.text } });
    else if (m.from === 'agent') lines.push({ type: 'assistant', uuid: m.id, sessionId: session, message: { role: 'assistant', content: [{ type: 'text', text: m.text }] } });
    else {
      const call = `toolu${m.id}`;
      lines.push({ type: 'assistant', uuid: `${m.id}call`, sessionId: session, message: { role: 'assistant', content: [{ type: 'tool_use', id: call, name: 'WebFetch', input: { url: m.url ?? 'https://docs.example.invalid/readme', prompt: 'how to set up' } }] } });
      lines.push({ type: 'user', uuid: m.id, sessionId: session, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: m.text }] } });
    }
  }
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}
/**
 * A session of `project` in `worktree`, as its hooks record it, with its transcript archived in the evidence store
 * and linked by transcript.archived. Returns its ID; each message's handle is `session:<id>#<message id>`.
 */
export async function seedSession(w: World, o: Opened, project: string, worktree: string, messages: readonly Msg[]): Promise<string> {
  const at = w.clock.tick();
  const id = ulid(at);
  await o.record.append(hookIn(id, project), { v: 1, id: ulid(at), kind: 'session.start', ts: at, data: { agent: 'claude-code', worktree, branch: 'main', thread: id } });
  const put = await o.store.connect({ role: 'deepbuild', via: 'capture' })
    .put({ bytes: new Uint8Array(Buffer.from(transcript(id, messages), 'utf8')), kind: 'transcript', source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] } });
  expect(put.status, 'the evidence store keeps the transcript').toBe('stored');
  const t = w.clock.tick(1);
  await o.record.append(YOU, { v: 1, id: ulid(t), kind: 'transcript.archived', ts: t, data: { session: `session:${id}`, evidence: (put as { evidence: Evidence }).evidence.sha256 } });
  for (const m of messages) w.said.set(`session:${id}#${m.id}`, m.text);
  return id;
}
/** A decision of yours (decision.created, from the core), saved at `scope`; returns its handle. */
export async function seedDecision(w: World, o: Opened, answer: string, scope = 'all'): Promise<string> {
  const at = w.clock.tick();
  const id = ulid(at);
  await o.record.append(CORE, { v: 1, id, kind: 'decision.created', ts: at, data: { key: sha256(`decision ${id}`), scope, answer, ask: `ask:${ulid(at)}` } });
  w.said.set(`decision:${id}`, answer);
  return `decision:${id}`;
}
/** Your answer that you trust a project folder, on the trusted path (#348). */
export async function trustProject(w: World, o: Opened, folder: string): Promise<void> {
  const trust = await openTrust({ record: o.record, now: w.clock.now });
  await trust.answer(YOU, folder, true);
}
export async function allEvents(record: RecordStore): Promise<Event[]> {
  const out: Event[] = [];
  for (let after = 0; ;) {
    const page = await record.read({ after, limit: 1000 });
    if (!page.length) return out;
    out.push(...page);
    after = page[page.length - 1]!.log_pos;
  }
}

// ---- Quotes, as the design compares them: NFC, each whitespace run one space; a link without its query string.
export const stripQueries = (text: string): string => text.replace(/(https?:\/\/[^\s?#"'`<>]+)\?[^\s#"'`<>]*/g, '$1');
const norm = (text: string): string => stripQueries(text.normalize('NFC').replace(/\s+/g, ' ')).trim();
/** Why a source's quote isn't at it, read from what the test itself wrote (a message, a decision, a file at a commit); undefined when it is. */
export function quoteProblem(w: World, source: Line): string | undefined {
  const quote = typeof source.quote === 'string' ? source.quote : '';
  if (!quote.trim()) return `a source with no quote: ${JSON.stringify(source)}`;
  let text: string | undefined;
  let where: string;
  if (typeof source.at === 'string') {
    where = source.at;
    text = w.said.get(source.at);
  } else if (typeof source.path === 'string' && typeof source.commit === 'string' && typeof source.repo === 'string') {
    where = `${source.path} at ${source.commit} in ${source.repo}`;
    text = existsSync(source.repo) ? fileAt(source.repo, source.commit, source.path) : undefined;
  } else return `a source that names neither a handle nor a repo path at a commit: ${JSON.stringify(source)}`;
  if (text === undefined) return `${where} resolves to nothing the test wrote`;
  return norm(text).includes(norm(quote)) ? undefined : `the quote "${quote}" is not at ${where}`;
}

// ---- The pages, read back. A claim line is `- <text> <!-- deep:claim <JSON> -->` (README: Pages).
export interface ClaimLine { file: string; page: string; line: number; text: string; record: Line }
export interface PageFile { file: string; page: string; lines: string[] }
const CLAIM_LINE = /^- (.*?) <!-- deep:claim (\{.*\}) -->$/;
/** Every page under the wiki folder (index.md and log.md at its top aren't pages of claims). */
export function pageFiles(w: World): PageFile[] {
  const out: PageFile[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.md')) {
        const page = relative(w.wiki, path).slice(0, -3);
        if (page !== 'index' && page !== 'log') out.push({ file: path, page, lines: readFileSync(path, 'utf8').split('\n') });
      }
    }
  };
  walk(w.wiki);
  return out;
}
export const parseClaimLine = (raw: string): { text: string; record: Line } | undefined => {
  const m = CLAIM_LINE.exec(raw);
  if (!m) return undefined;
  try { return { text: m[1]!, record: JSON.parse(m[2]!) as Line }; } catch { return undefined; }
};
export function claimLines(w: World): ClaimLine[] {
  const out: ClaimLine[] = [];
  for (const p of pageFiles(w)) p.lines.forEach((raw, i) => {
    const parsed = parseClaimLine(raw);
    if (parsed) out.push({ file: p.file, page: p.page, line: i + 1, ...parsed });
  });
  return out;
}
/** The one claim line of a claim handle; fails naming the handle when there are none or several. */
export function lineOf(w: World, claim: string): ClaimLine {
  const [page, id] = claim.slice('wiki:'.length).split('#') as [string, string];
  const found = claimLines(w).filter((l) => l.page === page && l.record.id === id);
  expect(found.map((l) => `${l.file}:${l.line}`), `${claim} is one line on ${page}.md`).toHaveLength(1);
  return found[0]!;
}
/** Every text file under a folder, with its bytes as UTF-8. */
export function filesUnder(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (d: string): void => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push({ file: path, text: readFileSync(path).toString('latin1') });
    }
  };
  walk(dir);
  return out;
}

// ---- The hub: 26's `deep hub run` on the world's home, with its seams.
export interface HubRun { plant?: string; index?: string }
/** Runs `fn` with a hub up on the world's home, and stops it (by PID) after. */
export async function withHub<T>(w: World, o: HubRun, fn: (hub: Hub) => Promise<T>): Promise<T> {
  const hub = await startHub(w.home, { plant: o.plant, index: o.index });
  try {
    return await fn(hub);
  } finally {
    await stopHub(hub);
  }
}
/** A deep mcp started by hand in a folder no session works in: its calls are bound to no session. */
export async function unboundMcp(w: World, plant?: string): Promise<McpProcess> {
  const m = McpProcess.start(w.home, w.elsewhere, plant ? { DEEP_HUB_PLANT: plant } : {});
  await initialize(m);
  return m;
}
/** The wiki hits of a deep_search: those whose source is a claim handle, `wiki:<page>#<claim>`. */
export async function wikiHits(m: Mcp, query: string, who: string): Promise<Line[]> {
  const value = valueOf(await callTool(m, 'deep_search', { query }), `deep_search "${query}" from ${who}`);
  expect(Array.isArray(value?.hits), `deep_search "${query}" returns hits: ${JSON.stringify(value).slice(0, 800)}`).toBe(true);
  return (value.hits as Line[]).filter((h) => typeof h.source === 'string' && h.source.startsWith('wiki:'));
}
/** The page a wiki hit's source names. */
export const pageOfHit = (h: Line): string => String(h.source).slice('wiki:'.length).split('#')[0]!;

// ---- Index modules for DEEP_HUB_TEST_INDEX (26's seam: its default export returns the index@1 fill the hub uses).
/** A second index: the conformance package's reference index@1 fill, which the hub rebuilds from the pages. */
export function writeSecondIndex(w: World): string {
  const file = join(w.tmp, 'second-index.mjs');
  const conformance = join(REPO, 'packages/conformance/dist/index.js');
  writeFileSync(file, `// A second index for the wiki (#355): the reference index@1 fill, rebuilt by the hub from the pages.
import { cleanFills, slotKits } from ${JSON.stringify(conformance)};
export default function () { return cleanFills(slotKits().find((k) => k.slot === 'index@1'))[0]; }
`);
  return file;
}
export interface PlantedHit { claim: string; page: string; quote: string; source: string; [mark: string]: unknown }
/**
 * A planted index: whatever the hub rebuilds or upserts, it answers from the fixed hits below, each with the marks
 * it carries (an index that says a hit is inside, or keeps claims it should have let go).
 */
export function writePlantedIndex(w: World, name: string, hits: PlantedHit[]): string {
  const file = join(w.tmp, `${name}.mjs`);
  writeFileSync(file, `// A planted index (#355): ${name}. It keeps the hits below through every rebuild, upsert and drop.
const FIXED = ${JSON.stringify(hits)};
const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const matches = (h, q) => { const have = new Set(words(h.quote)); return words(q).every((x) => have.has(x)); };
export default function () {
  return {
    slot: 'index@1', revision: 1,
    rebuild() {}, upsert() {}, dropSource() {},
    search(query) { return FIXED.filter((h) => matches(h, query)).map((h) => ({ ...h })); },
  };
}
`);
  return file;
}

// ---- A local HTTP server that counts every request, so a test can see a link was never fetched.
const servers: Server[] = [];
export async function countingServer(): Promise<{ port: number; requests: () => string[] }> {
  const seen: string[] = [];
  const server = createServer((req, res) => { seen.push(`${req.method} ${req.url}`); res.end('setup'); });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('BLOCKED: the counting server has no port');
  return { port: address.port, requests: () => [...seen] };
}
