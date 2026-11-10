// Test-side tools for the #1515 acceptance tests (README): temp folders under /tmp/dh1515-*, two git repos of their
// own with dated commits, the fixture record of 500 sessions written through the real record and evidence store
// while no hub runs, the hub (`deep hub run`) and the agent stand-in of tests/acceptance/26 (imported, never copied),
// a Codex session driven through that stand-in's hooks so its `deep mcp` is bound to it, `deep find` as the built
// CLI, and the index dropped from the ledger with the hub stopped. Nothing here stands in for the hub, the archive's
// index, `deep_search` or `deep find`: the tests reach them only through the surfaces the README names.
//
// Safety: every folder is under /tmp/dh1515-* (real paths); HOME is a temp folder for this process and for every
// child; no test touches the real ~/.deepbuild, ~/.claude or ~/.codex; no network; processes are stopped by PID only
// (26's cleanup and stopHub), never by name or port.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { openEvidenceStore, type Evidence } from '../../../packages/evidence/src/index.ts';
import { openRecord, type Connection, type RecordStore } from '../../../packages/record/src/index.ts';
import { mulberry32 } from '../16/helpers.ts';
import {
  Agent, callTool, childEnv, cleanup as cleanup26, CLI, eventMatching, initialize, NODE, REPO, run, startHub, stopHub, ulid,
  type Hub, type Line, type Outcome, type Ran,
} from '../26/helpers.ts';

export { callTool, startHub, stopHub, type Hub, type Line, type Outcome };
export const MINUTE = 60_000;
export const DAY = 86_400_000;

/** Each criterion's ID: `#1515.` and the first 8 hex of SHA-256 of its text (tests/acceptance/48/README.md). */
export const AC = {
  1: '#1515.50f29297', 2: '#1515.82f04bac', 3: '#1515.c41b7667', 4: '#1515.c5a02456',
  5: '#1515.c84a0fbf', 6: '#1515.adbdb642', 7: '#1515.c1a2b880', 8: '#1515.03d88b61',
} as const;

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('CODEX') || key.startsWith('DEEP_') || key === 'AI_AGENT') delete process.env[key];

// ---- Temp folders (short: the hub's socket path must fit in 104 bytes on macOS).
const made: string[] = [];
export function tempDir(tag = 'w'): string {
  const dir = realpathSync(mkdtempSync(`/tmp/dh1515-${tag}-`));
  made.push(dir);
  return dir;
}
process.env.HOME = tempDir('home');
/** Stops every process the suite started, by PID (26's cleanup), and removes the temp folders. */
export async function cleanup(): Promise<void> {
  await cleanup26();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ---- What the fixture holds that the tests look for (README: The fixture).
/** The error string of criterion 1: in a Bash result of a Claude Code session of repo A, and of one of repo B. */
export const ERR = 'PoolTimeoutError: connection pool exhausted after 30000ms';
/** In an agent's message of a Claude Code session and of a Codex session of repo A: each hit names its own agent. */
export const AGENT_WORD = 'plovertide';
/** In one session of repo A: your message, a page a WebFetch returned, and the agent's message. */
export const WHOSE_WORD = 'quillfeather';
/** In the messages of the two sessions of criterion 4, each naming the file it edited. */
export const CHANGED_WORD = 'wobblecap';
/** A word of the filler, put in about 3% of its messages: a query with hundreds of hits, for order. */
export const COMMON_WORD = 'lantern';
export const FILE = 'src/retry.ts';
export const UNCHANGED_FILE = 'src/backoff.ts';
/** Criterion 8's queries, each only a part of the words that hold it. */
export const QUERIES = { part: 'thBackoffJit', greek: 'ανασύνδ', chinese: '重试' } as const;

// ---- Git repos of their own (never this checkout), each commit at its own time.
/** The newest Codex version its facts cover: every Codex transcript here carries it, so no session is recorded unverified. */
const CODEX_VERSION = ((JSON.parse(readFileSync(join(REPO, 'adapters/codex.facts.json'), 'utf8')) as { versions: string[] }).versions).at(-1)!;
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
export interface Repo { dir: string; commits: string[] }
function gitRepo(dir: string, commits: { at: number; files: Record<string, string> }[]): Repo {
  mkdirSync(dir, { recursive: true });
  const git = (env: Record<string, string>, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env: { ...process.env, ...GIT_ENV, HOME: dir, ...env }, encoding: 'utf8' }).trim();
  git({}, 'init', '-q');
  const shas: string[] = [];
  commits.forEach((c, i) => {
    for (const [name, text] of Object.entries(c.files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    const date = `@${Math.floor(c.at / 1000)} +0000`;
    git({}, 'add', '-A');
    git({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, 'commit', '-q', '-m', `fixture ${i + 1}`);
    shas.push(git({}, 'rev-parse', 'HEAD'));
  });
  return { dir: realpathSync(dir), commits: shas };
}

// ---- The fixture's sessions (README: The fixture). IDs and texts are fixed, so handles are the same on every run.
export type AgentName = 'claude-code' | 'codex';
/** A transcript message: yours, the agent's, or a tool call with its result (the result's ID is the message's). */
export interface Msg { id: string; from: 'you' | 'agent' | 'fetch' | 'shell' | 'read' | 'edit'; text: string; path?: string }
export interface FixtureSession { id: string; repo: 'a' | 'b'; agent: AgentName; at: number; msgs: Msg[]; commit?: number }
const FILLER = ('amber basil cedar delta ember fable garnet harbor island jasper kettle linen meadow nickel orchard pebble quartz ' +
  'raven saddle timber umber velvet willow yarrow zephyr anchor beacon canyon dune estuary fjord glacier heath inlet ' +
  'juniper knoll lagoon marsh nimbus oasis prairie quarry ridge savanna tundra upland valley wetland arbor bramble ' +
  'clover dahlia fennel ginger hazel iris jonquil kelp lilac mallow nettle olive peony quince rosemary sorrel tansy ' +
  'violet wisteria acorn bobbin candle drawer easel funnel goblet hammock inkwell jigsaw ladle mitten napkin ' +
  'paddle quiver ribbon spindle teapot urn vessel whistle the a of and to in is it was for on with as at by from ' +
  'this that we they will can should could would after before over under again then now later soon').split(' ');
/** Seeded filler: `words` words, with COMMON_WORD in about 3% of messages. */
function filler(rng: () => number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(FILLER[Math.floor(rng() * FILLER.length)]!);
  if (rng() < 0.03) out.splice(Math.floor(rng() * words), 0, COMMON_WORD);
  return out.join(' ');
}
const pad = (n: number): string => String(n).padStart(3, '0');
export const sessionId = (repo: 'a' | 'b', i: number, agent: AgentName): string => `s${repo}${pad(i)}${agent === 'codex' ? 'x' : 'c'}`;
const agentAt = (i: number): AgentName => (i % 5 === 4 ? 'codex' : 'claude-code');

/** The named sessions of the fixture, each by its repo and index (README: The fixture, the table). */
export const NAMED = {
  E1: ['a', 10], BE1: ['b', 10], C1: ['a', 11], X1: ['a', 14], F1: ['a', 12], T1: ['a', 13], N1: ['a', 15], T2: ['a', 19],
  G1: ['a', 20], G2: ['a', 21], G3: ['a', 22], G5: ['a', 23], G4: ['a', 24], S1: ['a', 280], S2: ['a', 281],
} as const satisfies Record<string, readonly ['a' | 'b', number]>;
export type Named = keyof typeof NAMED;
export const idOf = (name: Named): string => { const [repo, i] = NAMED[name]; return sessionId(repo, i, agentAt(i)); };
export const handleOf = (name: Named, message: string): string => `session:${idOf(name)}#${message}`;

/** The messages each named session adds to its filler (README: The fixture). */
function named(name: Named | undefined): { msgs: Msg[]; read?: string; edit?: string } {
  switch (name) {
    case 'E1': case 'BE1':
      return { msgs: [{ id: 'merr', from: 'shell', text: `npm test\n\n${ERR}\n    at Pool.acquire (src/pool.ts:88:11)\n    at async main (src/main.ts:12:3)` }] };
    case 'C1': return { msgs: [{ id: 'mword', from: 'agent', text: `The ${AGENT_WORD} worker drains the queue on shutdown.` }] };
    case 'X1': return { msgs: [{ id: 'mword', from: 'agent', text: `The ${AGENT_WORD} worker restarts after a crash.` }] };
    case 'F1': return {
      msgs: [
        { id: 'myou', from: 'you', text: `I wrote the ${WHOSE_WORD} notes myself last spring.` },
        { id: 'mfetch', from: 'fetch', text: `${WHOSE_WORD} setup guide: run make bootstrap, then make serve.` },
        { id: 'magent', from: 'agent', text: `The ${WHOSE_WORD} build is green on my side.` },
      ],
    };
    case 'T1': return { msgs: [], read: FILE };
    case 'T2': return { msgs: [], edit: FILE };
    case 'N1': return { msgs: [{ id: 'mnamed', from: 'you', text: `Please look at ${FILE} again tomorrow; I think the bug is there.` }] };
    case 'S1': return { msgs: [{ id: 'mnote', from: 'agent', text: `${CHANGED_WORD}: patched the jitter in ${FILE} so pool waits back off.` }], edit: FILE };
    case 'S2': return { msgs: [{ id: 'mnote', from: 'agent', text: `${CHANGED_WORD}: tuned the delay in ${UNCHANGED_FILE} for the pool.` }], edit: UNCHANGED_FILE };
    case 'G1': return { msgs: [{ id: 'mg1', from: 'agent', text: 'retryWithBackoffJitter keeps the pool warm between runs.' }, { id: 'mg2', from: 'you', text: '稍后重新尝试一次。' }] };
    case 'G2': return { msgs: [{ id: 'mg1', from: 'you', text: 'Η επανασύνδεση απέτυχε στο δεύτερο βήμα.' }] };
    case 'G3': return { msgs: [{ id: 'mg1', from: 'agent', text: '连接重试失败，正在回退到只读模式。' }] };
    case 'G4': return { msgs: [{ id: 'mg1', from: 'you', text: 'Set withBackoffJitterMs to 250 for the pool.' }, { id: 'mg2', from: 'agent', text: 'Η διαδικασία ανασύνδεσης ολοκληρώθηκε.' }] };
    case 'G5': return { msgs: [{ id: 'mg1', from: 'you', text: '重试三次以后再报错。' }, { id: 'mg2', from: 'agent', text: 'withBackoffJiggle stays off.' }, { id: 'mg3', from: 'you', text: 'Η ανασυνδεση χωρίς τόνους.' }] };
    default: return { msgs: [] };
  }
}

/** The 500 sessions: 300 of repo A, 200 of repo B, every fifth a Codex session; each 40 filler messages of ~60 words, a read and an edit. */
export function fixtureSessions(t0: number, o: { a?: number; b?: number } = {}): FixtureSession[] {
  const byPlace = new Map<string, Named>(Object.entries(NAMED).map(([name, [repo, i]]) => [`${repo}${i}`, name as Named]));
  const out: FixtureSession[] = [];
  for (const [repo, count, offset] of [['a', o.a ?? 300, 0], ['b', o.b ?? 200, 5 * MINUTE]] as const) {
    for (let i = 0; i < count; i++) {
      const agent = agentAt(i);
      const rng = mulberry32(1515 + (repo === 'a' ? 0 : 100_000) + i * 7919);
      const extra = named(byPlace.get(`${repo}${i}`));
      const msgs: Msg[] = [];
      for (let k = 0; k < 40; k++) msgs.push({ id: `m${k}`, from: k % 2 ? 'agent' : 'you', text: filler(rng, 60) });
      msgs.splice(5, 0, { id: 'mread', from: 'read', text: 'export const answer = 42;\n', path: extra.read ?? `src/mod${i % 37}.ts` });
      msgs.splice(20, 0, { id: 'medit', from: 'edit', text: 'The file has been updated.', path: extra.edit ?? `src/mod${(i * 7 + 3) % 37}.ts` });
      msgs.splice(30, 0, ...extra.msgs);
      const name = byPlace.get(`${repo}${i}`);
      out.push({ id: sessionId(repo, i, agent), repo, agent, at: t0 + i * 30 * MINUTE + offset, msgs, ...(name === 'S1' || name === 'S2' ? { commit: name === 'S1' ? 1 : 2 } : {}) });
    }
  }
  return out;
}

const iso = (ms: number): string => new Date(ms).toISOString();
/** Claude Code's JSONL: one entry per line, `uuid` names the message; a tool call is its tool_use, then its result. */
function claudeTranscript(s: FixtureSession, worktree: string): string {
  const lines: Line[] = [];
  const base = (uuid: string, k: number) => ({ uuid, sessionId: s.id, cwd: worktree, timestamp: iso(s.at + (k + 1) * 15_000) });
  s.msgs.forEach((m, k) => {
    if (m.from === 'you') lines.push({ type: 'user', ...base(m.id, k), message: { role: 'user', content: m.text } });
    else if (m.from === 'agent') lines.push({ type: 'assistant', ...base(m.id, k), message: { role: 'assistant', content: [{ type: 'text', text: m.text }] } });
    else {
      const call = `toolu${s.id}${m.id}`;
      const [name, input] = m.from === 'fetch' ? ['WebFetch', { url: 'https://docs.example.invalid/setup', prompt: 'how to set it up' }]
        : m.from === 'shell' ? ['Bash', { command: 'npm test', description: 'run the tests' }]
          : m.from === 'read' ? ['Read', { file_path: join(worktree, m.path!) }]
            : ['Edit', { file_path: join(worktree, m.path!), old_string: 'answer = 41', new_string: 'answer = 42', replace_all: false }];
      lines.push({ type: 'assistant', ...base(`${m.id}call`, k), message: { role: 'assistant', content: [{ type: 'tool_use', id: call, name, input }] } });
      lines.push({ type: 'user', ...base(m.id, k), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: m.text }] } });
    }
  });
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}
/** Codex's rollout: a session_meta line, then response items; an edit is an apply_patch call and its output. */
function codexTranscript(s: FixtureSession, worktree: string): string {
  const lines: Line[] = [{ timestamp: iso(s.at), type: 'session_meta', payload: { id: s.id, timestamp: iso(s.at), cwd: worktree, originator: 'codex_cli_rs', cli_version: CODEX_VERSION, source: 'cli', model_provider: 'openai' } }];
  s.msgs.forEach((m, k) => {
    const timestamp = iso(s.at + (k + 1) * 15_000);
    if (m.from === 'you' || m.from === 'agent') {
      const role = m.from === 'you' ? 'user' : 'assistant';
      lines.push({ timestamp, type: 'response_item', payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text: m.text }] } });
    } else {
      const call_id = `call${s.id}${m.id}`;
      const input = m.from === 'edit' ? `*** Begin Patch\n*** Update File: ${join(worktree, m.path!)}\n@@\n-answer = 41\n+answer = 42\n*** End Patch\n`
        : m.from === 'read' ? `cat ${join(worktree, m.path!)}` : 'npm test';
      if (m.from === 'edit') {
        lines.push({ timestamp, type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', input, call_id, status: 'completed' } });
        lines.push({ timestamp, type: 'response_item', payload: { type: 'custom_tool_call_output', call_id, output: 'Success.' } });
      } else {
        lines.push({ timestamp, type: 'response_item', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', input] }), call_id } });
        lines.push({ timestamp, type: 'response_item', payload: { type: 'function_call_output', call_id, output: m.text } });
      }
    }
  });
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

/**
 * Writes the sessions into <root>/ledger.db and <root>/evidence with no hub running, as the hub's hooks, core and
 * archive record them: session.start, a tool.before/tool.after pair for each read and edit (the paths resolved),
 * commit.made for a session's commit, session.end, and the transcript stored as evidence and linked by
 * transcript.archived@2. `projects` are the hub's own projects for the two repos (`discoverProjects`).
 */
export async function seedRecord(root: string, sessions: readonly FixtureSession[], repos: Record<'a' | 'b', Repo>, projects: Record<'a' | 'b', string>, commitAt: (n: number) => { sha: string; at: number }): Promise<void> {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  let now = sessions[0]?.at ?? Date.now();
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => now });
  const record: RecordStore = await openRecord({ path: join(root, 'ledger.db'), now: () => now, evidence: store });
  const writer = store.connect({ role: 'deepbuild', via: 'capture' });
  try {
    for (const s of sessions) {
      const worktree = repos[s.repo].dir;
      const who = { actor: 'you', scope: 'you', session: s.id, project: projects[s.repo], agent: s.agent };
      const hook: Connection = { writer: 'hook', ...who };
      const core: Connection = { writer: 'core', ...who };
      const at = (ms: number) => { now = ms; return ms; };
      await record.append(hook, { v: 1, id: ulid(at(s.at)), kind: 'session.start', ts: s.at, data: { agent: s.agent, worktree, branch: 'main', thread: s.id } });
      for (const [k, m] of s.msgs.entries()) {
        if (m.from !== 'read' && m.from !== 'edit') continue;
        const t = at(s.at + (k + 1) * 15_000);
        const data = { kind: m.from, paths: [join(worktree, m.path!)], command: null, call: `call${s.id}${m.id}` };
        await record.append(hook, { v: 3, id: ulid(t), kind: 'tool.before', ts: t, data });
        await record.append(hook, { v: 3, id: ulid(t + 1), kind: 'tool.after', ts: t + 1, data: { ...data, outcome: 'ok' } });
      }
      if (s.commit !== undefined) {
        const c = commitAt(s.commit);
        await record.append(core, { v: 1, id: ulid(at(c.at)), kind: 'commit.made', subject: `session:${s.id}`, ts: c.at, data: { sha: c.sha, worktree, branch: 'main' } });
      }
      const end = at(s.at + 20 * MINUTE);
      await record.append(hook, { v: 1, id: ulid(end), kind: 'session.end', ts: end, data: { reason: 'other' } });
      const text = s.agent === 'codex' ? codexTranscript(s, worktree) : claudeTranscript(s, worktree);
      const bytes = new Uint8Array(Buffer.from(text, 'utf8'));
      const put = await writer.put({ bytes, kind: 'transcript', source: s.agent, redaction: 'complete', license: { name: 'own', allows: [] } });
      if (put.status !== 'stored') throw Error(`BLOCKED: the evidence store didn't keep the transcript of ${s.id}: ${JSON.stringify(put)}`);
      const archived = at(end + MINUTE);
      const sha = createHash('sha256').update(bytes).digest('hex');
      await record.append(core, { v: 2, id: ulid(archived), kind: 'transcript.archived', ts: archived, data: { session: `session:${s.id}`, evidence: (put as { evidence: Evidence }).evidence.sha256, source: { size: bytes.length, sha256: sha } } });
    }
  } finally {
    await record.close();
  }
}

// ---- A Codex session, live: the agent stand-in of tests/acceptance/26 (fixtures/agent.mjs) runs its hooks and its
// `deep mcp` as its children, so the hub binds that deep mcp to this session. 26's `Agent` speaks Claude Code's
// hooks; this sends Codex's (agent `codex`, payloads as tests/acceptance/16's `payload` shapes them) through the
// same stand-in's `hook` op, by its one command channel.
type Channel = { send(command: Line, timeoutMs?: number): Promise<Line> };
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
export class CodexSession {
  readonly id = `01a1581d-${randomBytes(2).toString('hex')}-7b62-8f4f-${randomBytes(6).toString('hex')}`;
  readonly transcript: string;
  private seq = BigInt(Date.now()) * 1_000_000n;
  private calls = 0;
  private constructor(readonly agent: Agent, readonly hub: Hub, readonly cwd: string, home: string) {
    this.transcript = join(home, '.codex/sessions/2026/11/08', `rollout-2026-11-08T09-00-00-${this.id}.jsonl`);
    mkdirSync(dirname(this.transcript), { recursive: true });
    writeFileSync(this.transcript, `${JSON.stringify({ timestamp: new Date().toISOString(), type: 'session_meta', payload: { id: this.id, cwd, originator: 'codex_cli_rs', cli_version: CODEX_VERSION, source: 'cli', model_provider: 'openai' } })}\n`);
  }
  /** The session's handle ID: its ID with everything but letters and digits dropped. */
  get handleId(): string { return letters(this.id); }
  /** A Codex session working in `cwd`: its SessionStart, a prompt and a first shell call, then its deep mcp initialized and checked bound. */
  static async open(home: string, hub: Hub, cwd: string): Promise<CodexSession> {
    const s = new CodexSession(Agent.start(home, cwd), hub, cwd, home);
    await s.hook('SessionStart', { source: 'startup' });
    await s.hook('UserPromptSubmit', { prompt: 'why does the pool time out?', turn_id: 'turn-1' });
    await s.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `call_${++s.calls}`, turn_id: 'turn-1' });
    await initialize(s.agent);
    const status = await s.call('deep_status', {});
    const bound = status.value?.session;
    if (typeof bound !== 'string' || letters(bound) !== s.handleId) throw Error(`BLOCKED: the Codex session's deep mcp isn't bound to ${s.handleId}: deep_status says ${JSON.stringify(status.value)}`);
    return s;
  }
  async hook(event: string, extra: Line): Promise<void> {
    const payload = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, model: 'gpt-reserve', permission_mode: 'default', ...extra };
    const request = { v: 1, agent: 'codex', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload };
    const r = await (this.agent as unknown as Channel).send({ op: 'hook', socket: this.hub.socket, request, cwd: this.cwd });
    if (!((r.lines as string[] | undefined) ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge Codex's ${event} for ${this.id}: ${JSON.stringify(r).slice(0, 1500)}`);
  }
  /** A deep tool call, after the PreToolUse Codex fires for it (tool `mcp__deep__<tool>`). */
  async call(tool: string, args: Line): Promise<Outcome> {
    await this.hook('PreToolUse', { tool_name: `mcp__deep__${tool}`, tool_input: args, tool_use_id: `call_${++this.calls}`, turn_id: 'turn-1' });
    return callTool(this.agent, tool, args);
  }
  /** deep_search's past-session hits for `query`: those whose source is a `session:` handle (README: The surface). */
  async past(query: string): Promise<{ hits: Line[]; reply: Outcome }> {
    const reply = await this.call('deep_search', { query });
    if (reply.isError || !Array.isArray(reply.value?.hits)) throw Error(`deep_search "${query}" from Codex session ${this.handleId} answers with hits: ${JSON.stringify(reply.reply).slice(0, 1500)}`);
    return { hits: (reply.value.hits as Line[]).filter((h) => typeof h?.source === 'string' && h.source.startsWith('session:')), reply };
  }
}

/** The project the hub gives each folder, read from its session.start (`project`, as events.read serves it), on a scratch home. */
export async function discoverProjects(dirs: readonly string[]): Promise<string[]> {
  const home = join(tempDir('scout'), 'h');
  mkdirSync(home);
  const hub = await startHub(home);
  try {
    const out: string[] = [];
    for (const dir of dirs) {
      const s = await CodexSession.open(home, hub, dir);
      const start = await eventMatching(hub, (e) => e.kind === 'session.start' && letters(String(e.session ?? '')) === s.handleId);
      const project = (start as Line | undefined)?.project;
      if (typeof project !== 'string' || !project) throw Error(`BLOCKED: events.read names no project for the session in ${dir}: ${JSON.stringify(start)}`);
      out.push(project);
    }
    if (new Set(out).size !== out.length) throw Error(`BLOCKED: the hub reads ${dirs.join(' and ')} as one project: ${out.join(', ')}`);
    return out;
  } finally {
    await stopHub(hub);
  }
}

// ---- The world: repos A (shop) and B (blog), the seeded home, its hub, and a Codex session in each repo.
export interface World {
  tmp: string;
  home: string;
  root: string;
  repos: Record<'a' | 'b', Repo>;
  projects: Record<'a' | 'b', string>;
  sessions: FixtureSession[];
  hub: Hub;
  /** A Codex session of repo A or B, opened on first use (a new one after a hub restart). */
  codex(repo: 'a' | 'b'): Promise<CodexSession>;
  restart(between?: () => void | Promise<void>): Promise<void>;
}
export async function makeWorld(o: { a?: number; b?: number } = {}): Promise<World> {
  const tmp = tempDir('w');
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(home);
  const t0 = Date.now() - 12 * DAY;
  const sessions = fixtureSessions(t0, o);
  const s1 = sessions.find((s) => s.id === idOf('S1'));
  const s2 = sessions.find((s) => s.id === idOf('S2'));
  const c1 = (s1?.at ?? t0 + 2 * DAY) + 10 * MINUTE;
  const c2 = (s2?.at ?? t0 + 2 * DAY + 30 * MINUTE) + 10 * MINUTE;
  const later = t0 + 10 * DAY;
  // Repo A: C0 before every session; C1 is S1's edit of src/retry.ts; C2 is S2's edit of src/backoff.ts; C3, after
  // every session and made by none, changes src/retry.ts again and is the branch head.
  const a = gitRepo(join(tmp, 'shop'), [
    { at: t0 - DAY, files: { [FILE]: 'export const retries = 3;\n', [UNCHANGED_FILE]: 'export const delay = 100;\n', 'src/pool.ts': 'export const size = 10;\n' } },
    { at: c1, files: { [FILE]: 'export const retries = 3;\nexport const jitter = 0.2;\n' } },
    { at: c2, files: { [UNCHANGED_FILE]: 'export const delay = 250;\n' } },
    { at: later, files: { [FILE]: 'export const retries = 5;\nexport const jitter = 0.2;\n' } },
  ]);
  const b = gitRepo(join(tmp, 'blog'), [{ at: t0 - DAY, files: { 'src/main.ts': 'export {};\n' } }]);
  const repos = { a, b };
  const [pa, pb] = await discoverProjects([a.dir, b.dir]);
  const projects = { a: pa!, b: pb! };
  await seedRecord(root, sessions, repos, projects, (n) => ({ sha: a.commits[n]!, at: n === 1 ? c1 : c2 }));
  const open = new Map<string, Promise<CodexSession>>();
  const w: World = {
    tmp, home, root, repos, projects, sessions,
    hub: await startHub(home),
    codex: (repo) => { if (!open.has(repo)) open.set(repo, CodexSession.open(home, w.hub, repos[repo].dir)); return open.get(repo)!; },
    restart: async (between) => {
      await stopHub(w.hub);
      open.clear();
      await between?.();
      w.hub = await startHub(home);
    },
  };
  return w;
}

// ---- `deep find`, as the built CLI run by you (a child of this test process), with --json and --root.
export interface Found { hits: Line[]; runs: Ran[] }
/** Every page of `deep find <args> --json --root <root>`, run in `cwd` (repo A's folder by default), following `next`. */
export async function find(w: World, args: readonly string[], cwd = w.repos.a.dir): Promise<Found> {
  const hits: Line[] = [];
  const runs: Ran[] = [];
  for (let cursor: string | undefined, page = 0; ; page++) {
    const r = await run(NODE, [CLI, 'find', ...args, ...(cursor === undefined ? [] : ['--slice', cursor]), '--json', '--root', w.root], { env: childEnv(w.home), cwd });
    runs.push(r);
    if (r.code !== 0) throw Error(`deep find ${args.join(' ')} exits 0: ${r.code} ${r.stderr.slice(0, 1500)}`);
    let value: Line;
    try { value = JSON.parse(r.stdout) as Line; } catch { throw Error(`deep find ${args.join(' ')} --json prints JSON: ${r.stdout.slice(0, 500)}`); }
    if (!Array.isArray(value.hits)) throw Error(`deep find ${args.join(' ')} --json prints hits: ${r.stdout.slice(0, 500)}`);
    hits.push(...(value.hits as Line[]));
    cursor = typeof value.next === 'string' ? value.next : undefined;
    if (cursor === undefined || page > 200) return { hits, runs };
  }
}
/** The first page only, as `deep find` prints it. */
export async function findPage(w: World, args: readonly string[], cwd = w.repos.a.dir): Promise<Line> {
  const r = await run(NODE, [CLI, 'find', ...args, '--json', '--root', w.root], { env: childEnv(w.home), cwd });
  if (r.code !== 0) throw Error(`deep find ${args.join(' ')} exits 0: ${r.code} ${r.stderr.slice(0, 1500)}`);
  return JSON.parse(r.stdout) as Line;
}
/** The session ID a handle names: `session:<id>` or `session:<id>#<message>`. */
export const sessionOf = (handle: unknown): string => String(handle).replace(/^session:/, '').split('#')[0]!;

// ---- The index, dropped (README: Readings): every table of ledger.db whose name starts with `archive_`.
export function indexTables(root: string): string[] {
  const db = new Database(join(root, 'ledger.db'), { readonly: true });
  try {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'archive\\_%' ESCAPE '\\' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  } finally {
    db.close();
  }
}
/** Drops the index's tables, virtual tables first (each takes its shadow tables with it); only while no hub runs. */
export function dropIndex(root: string): string[] {
  const db = new Database(join(root, 'ledger.db'));
  try {
    const all = () => db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name LIKE 'archive\\_%' ESCAPE '\\'").all() as { name: string; sql: string | null }[];
    const dropped = all().map((t) => t.name);
    for (const t of all().filter((t) => /^CREATE VIRTUAL TABLE/i.test(t.sql ?? ''))) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    for (const t of all()) db.exec(`DROP TABLE IF EXISTS "${t.name}"`);
    return dropped;
  } finally {
    db.close();
  }
}
