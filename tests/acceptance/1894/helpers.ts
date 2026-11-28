import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEvidenceStore, type EvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, openRecordReader, type Connection, type RecordStore, type TranscriptReader } from '../../../packages/record/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const BASE = 'e87cefc44';
export const GOLDEN = fileURLToPath(new URL('./fixtures/learned-rows.json', import.meta.url));

export const T0 = 1_760_013_451_000;
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulidAt(ms: number, n: number): string {
  let s = '';
  let value = (BigInt(ms) << 80n) | BigInt(n);
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(value & 31n)] + s; value >>= 5n; }
  return s;
}
let counter = 0;
const nextId = (): string => ulidAt(T0, counter++);

export const YOU: Connection = { writer: 'app', actor: 'you', scope: 'you' };
export const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };

const roots: string[] = [];
export function cleanup(): void { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); }
export function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

export interface World { root: string; path: string; store: EvidenceStore; record: RecordStore }
export async function openWorld(readers: readonly TranscriptReader[] | undefined): Promise<World> {
  counter = 0;
  const root = temp('deep-1894-');
  const store = await openEvidenceStore({ root: join(root, 'evidence'), now: () => T0 });
  const path = join(root, 'record.db');
  const record = await openRecord({ path, now: () => T0, evidence: store, ...(readers === undefined ? {} : { readers }) } as Parameters<typeof openRecord>[0]);
  return { root, path, store, record };
}
export function openReader(w: World, readers: readonly TranscriptReader[] | undefined): ReturnType<typeof openRecordReader> {
  return openRecordReader({ path: w.path, evidence: w.store, ...(readers === undefined ? {} : { readers }) } as Parameters<typeof openRecordReader>[0]);
}

export const jsonl = (lines: readonly (object | string)[]): Uint8Array =>
  new Uint8Array(Buffer.from(lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n'));

export async function archive(w: World, agent: string, bytes: Uint8Array): Promise<string> {
  const S = nextId();
  await w.record.append({ writer: 'hook', actor: 'you', scope: 'you', session: S, project: 'shop' }, { v: 1, id: nextId(), kind: 'session.start', ts: T0, data: { agent, worktree: '~/src/shop', branch: 'main', thread: S } });
  const put = await w.store.connect({ role: 'deepbuild', via: 'capture' }).put({ bytes, kind: 'transcript', source: agent, redaction: 'complete', license: { name: 'own', allows: [] } });
  if (put.status !== 'stored') throw Error(`the ${agent} transcript was not stored: ${put.status}`);
  await w.record.append(YOU, { v: 1, id: nextId(), kind: 'transcript.archived', ts: T0, data: { session: `session:${S}`, evidence: put.evidence.sha256 } });
  return S;
}

export interface Change { layer: 'learned' | 'base'; target: string; at: string; quote: string; diff?: string; scope?: string }
export async function learn(w: World, c: Change): Promise<string> {
  const id = nextId();
  const session = /^session:([^#]+)/.exec(c.at)?.[1];
  const base = c.layer === 'base';
  await w.record.append(base ? YOU : CORE, {
    v: 1, id, kind: 'learn.applied', ts: T0 + 1000,
    data: {
      replay: null, supersedes: null, layer: c.layer, target: c.target, diff: c.diff ?? `+ ${c.quote}`,
      evidence: [{ at: c.at, quote: c.quote }], scope: c.scope ?? (base ? 'all' : `session:${session}`), applied_by: base ? 'you' : 'rule:localfirst',
    } as never,
  });
  return id;
}
export async function rowOf(w: World, id: string): Promise<Record<string, unknown> | undefined> {
  return (await w.record.table('learned_layer')).rows.find((r) => r.id === id);
}

export function canonical(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, (v as Record<string, unknown>)[k]]));
    return typeof v === 'bigint' ? v.toString() : v;
  });
}
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

export const AGENT_WORDS: readonly { name: string; pattern: RegExp }[] = [
  { name: 'Claude / Claude Code / claude-code', pattern: /(?<![A-Za-z])(?:[Cc]laude|CLAUDE)(?![a-z])/ },
  { name: 'Codex', pattern: /(?<![A-Za-z])(?:[Cc]odex|CODEX)(?![a-z])/ },
  { name: 'pi', pattern: /(?<![A-Za-z0-9_$.])(?:pi|Pi)(?![A-Za-z0-9_$])/ },
  { name: 'Cursor', pattern: /(?<![A-Za-z])(?:Cursor|CURSOR)(?![a-z])|(?<![A-Za-z])cursor[-_](?:agent|cli)|\.cursor(?![A-Za-z])/ },
  { name: 'Gemini', pattern: /(?<![A-Za-z])(?:[Gg]emini|GEMINI)(?![a-z])/ },
  { name: 'OpenCode', pattern: /(?<![A-Za-z])(?:[Oo]pen[Cc]ode|OPENCODE)(?![a-z])/ },
];
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/g;
const isAdapter = (specifier: string): boolean => /^@deepbuild\/adapters(?:\/|$)/.test(specifier) || /(?:^|\/)packages\/adapters(?:\/|$)/.test(specifier) || /^(?:\.\.\/)+adapters(?:\/|$)/.test(specifier);

export interface Finding { file: string; line: number; what: string; text: string }
export function scanSources(dir: string): Finding[] {
  const found: Finding[] = [];
  const walk = (at: string): void => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      const lines = readFileSync(full, 'utf8').split('\n');
      lines.forEach((text, i) => {
        for (const { name: what, pattern } of AGENT_WORDS) if (pattern.test(text)) found.push({ file: relative(dir, full), line: i + 1, what: `names ${what}`, text: text.trim().slice(0, 160) });
        for (const m of text.matchAll(SPECIFIER)) if (isAdapter(m[2]!)) found.push({ file: relative(dir, full), line: i + 1, what: `imports the adapter ${m[2]}`, text: text.trim().slice(0, 160) });
      });
    }
  };
  walk(dir);
  return found;
}
export const shownFindings = (found: readonly Finding[]): string => found.map((f) => `${f.file}:${f.line} ${f.what}: ${f.text}`).join('\n');

const ts = (i: number): string => new Date(T0 + i * 1000).toISOString();
const cx = (i: number, type: string, payload: object): object => ({ timestamp: ts(i), type, payload });

export const CLAUDE_CODE = [
  { type: 'user', uuid: 'cc-u1', message: { role: 'user', content: 'the billing api listens on port 4100' } },
  { type: 'assistant', uuid: 'cc-a1', message: { role: 'assistant', content: [{ type: 'text', text: 'I will check the port config.' }, { type: 'tool_use', id: 'toolu_f', name: 'WebFetch', input: { url: 'https://example.invalid/docs' } }] } },
  { type: 'user', uuid: 'cc-r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_f', content: 'the docs say port 4200 is the default' }] } },
  { type: 'assistant', uuid: 'cc-a2', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'npm test -- --grep billing' } }] } },
  { type: 'user', uuid: 'cc-r2', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_b', is_error: true, content: [{ type: 'text', text: '1 failing: billing webhook timeout' }] }] } },
  { type: 'user', uuid: 'cc-r3', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_x', content: 'orphan result text' }] } },
  { type: 'assistant', uuid: 'cc-a3', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_g', name: 'Grep', input: { pattern: 'retries' } }] } },
  { type: 'user', uuid: 'cc-r4', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_g', content: 'vendor/x.ts: retries are capped at 3' }] } },
  { type: 'user', uuid: 'cc-s1', isCompactSummary: true, message: { role: 'user', content: 'Summary: the user wants retries capped at 5' } },
  { type: 'user', uuid: 'cc-k1', isSidechain: true, message: { role: 'user', content: 'subagent prompt: list the webhooks' } },
  { type: 'user', uuid: 'cc-m1', isMeta: true, message: { role: 'user', content: 'meta caveat line' } },
  { type: 'assistant', uuid: 'cc-a4', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_r', name: 'Read', input: { file_path: 'src/retry.ts' } }] } },
  { type: 'user', uuid: 'cc-r5', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_r', content: 'src/retry.ts: export const MAX_RETRIES = 5' }] } },
  { type: 'summary', summary: 'billing port talk', leafUuid: 'cc-u1' },
  { type: 'user', uuid: 'cc-u2', message: { role: 'user', content: [{ type: 'text', text: 'deploys go through the staging gate first' }] } },
];
export const CODEX = [
  cx(0, 'session_meta', { id: 'rollout-1894', cwd: '~/src/shop', originator: 'cli' }),
  cx(1, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'the queue worker must stay idempotent' }] }),
  cx(2, 'response_item', { type: 'message', id: 'msg_cx01', role: 'assistant', content: [{ type: 'output_text', text: 'I will look at the worker.' }] }),
  cx(3, 'response_item', { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm run test:worker'] }), call_id: 'call_w1' }),
  cx(4, 'response_item', { type: 'function_call_output', call_id: 'call_w1', output: 'Process exited with code 1\nworker test failed: duplicate delivery' }),
  cx(5, 'response_item', { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: src/worker.ts\n*** End Patch', call_id: 'call_p1', status: 'completed' }),
  cx(6, 'response_item', { type: 'custom_tool_call_output', call_id: 'call_p1', output: 'Success. Updated src/worker.ts' }),
  cx(7, 'response_item', { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'rg idempotent src' }), call_id: 'call_e1' }),
  cx(8, 'response_item', { type: 'function_call_output', call_id: 'call_e1', output: '{"output":"src/worker.ts: idempotent by key","metadata":{"exit_code":0}}' }),
  cx(9, 'response_item', { type: 'function_call', name: 'web_search', arguments: JSON.stringify({ query: 'idempotent queue' }), call_id: 'call_s1' }),
  cx(10, 'response_item', { type: 'function_call_output', call_id: 'call_s1', output: [{ type: 'input_text', text: 'search says queues retry at least once' }] }),
  cx(11, 'response_item', { type: 'function_call_output', call_id: 'call_zz', output: 'stray output' }),
  cx(12, 'response_item', { type: 'custom_tool_call', name: 'exec', input: 'const r = await exec({ cmd: "npm run lint" })', call_id: 'call_x1', status: 'completed' }),
  cx(13, 'response_item', { type: 'custom_tool_call_output', call_id: 'call_x1', output: 'Script failed: lint errors in src/worker.ts' }),
  cx(14, 'event_msg', { type: 'agent_message', message: 'event messages are not turns' }),
  cx(15, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'staging deploys need a green worker suite' }] }),
  cx(16, 'response_item', { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'developer instructions line' }] }),
];
export const PI = [
  { type: 'session', version: 3, id: 'pi-session-1894', timestamp: ts(0), cwd: '~/src/shop' },
  { type: 'message', id: 'pi-1', parentId: null, timestamp: ts(1), message: { role: 'user', content: [{ type: 'text', text: 'prefer small functions over deep class trees' }] } },
  { type: 'message', id: 'pi-2', parentId: 'pi-1', timestamp: ts(2), message: { role: 'assistant', content: [{ type: 'text', text: 'Understood, functions stay small.' }, { type: 'toolCall', id: 'tc1', name: 'bash', arguments: { command: 'npm run lint' } }] } },
  { type: 'message', id: 'pi-3', parentId: 'pi-2', timestamp: ts(3), message: { role: 'toolResult', toolCallId: 'tc1', toolName: 'bash', content: [{ type: 'text', text: 'lint passed with 0 warnings' }] } },
  { type: 'model_change', id: 'pi-4', parentId: 'pi-3', timestamp: ts(4), provider: 'example', modelId: 'example-model' },
  { type: 'message', id: 'pi-5', parentId: 'pi-4', timestamp: ts(5), message: { role: 'user', content: 'name helpers after what they return' } },
];
export const CURSOR = [
  { role: 'user', message: { content: [{ type: 'text', text: 'name test files after the behaviour they prove' }] } },
  { role: 'assistant', message: { content: [{ type: 'text', text: 'I will rename the test files.' }] } },
  { role: 'user', message: { content: 'keep pull requests small and reviewable' } },
  '{"role":"user","message":{"content":"a torn li',
  { role: 'user', message: { content: [{ type: 'text', text: 'after a torn line the numbering holds' }] } },
];

const FILLER = 'x'.repeat(8000);
export const BIG_LINES = 4400;
export function bigCodex(): Uint8Array {
  const lines: object[] = [
    cx(0, 'session_meta', { id: 'rollout-big', cwd: '~/src/shop', originator: 'cli' }),
    cx(1, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'big: the cache key includes the tenant' }] }),
    cx(2, 'response_item', { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm run test:cache'] }), call_id: 'call_big' }),
  ];
  for (let i = 0; i < BIG_LINES; i++) lines.push(cx(3, 'event_msg', { type: 'token_count', note: FILLER }));
  lines.push(cx(4, 'response_item', { type: 'function_call_output', call_id: 'call_big', output: 'Process exited with code 0\ncache suite green' }));
  lines.push(cx(5, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'big: the tail line stays numbered' }] }));
  return jsonl(lines);
}
const BIG_TAIL = `l${3 + BIG_LINES + 1}`;

interface Cite { at: string; quote: string; target?: string }
const SESSIONS: { name: string; agent: string; bytes: () => Uint8Array; handles: string[]; cites: Cite[] }[] = [
  {
    name: 'claude-code', agent: 'claude-code', bytes: () => jsonl(CLAUDE_CODE),
    handles: ['cc-u1', 'cc-a1', 'cc-r1', 'cc-a2', 'cc-r2', 'cc-r3', 'cc-a3', 'cc-r4', 'cc-s1', 'cc-k1', 'cc-m1', 'cc-a4', 'cc-r5', 'cc-u2', 'l13', 'l0', 'nope'],
    cites: [
      { at: 'cc-u1', quote: 'listens on port 4100' }, { at: 'cc-u1', quote: 'listens on port 9999' },
      { at: 'cc-a1', quote: 'check the port config' }, { at: 'cc-r1', quote: 'port 4200 is the default' },
      { at: 'cc-r1', quote: 'port 4200 is the default', target: 'wiki:billing/port' },
      { at: 'cc-a2', quote: 'npm test -- --grep billing' }, { at: 'cc-r2', quote: 'billing webhook timeout' },
      { at: 'cc-r3', quote: 'orphan result text' }, { at: 'cc-r4', quote: 'retries are capped at 3' },
      { at: 'cc-s1', quote: 'retries capped at 5' }, { at: 'cc-k1', quote: 'list the webhooks' }, { at: 'cc-m1', quote: 'meta caveat line' },
      { at: 'cc-r5', quote: 'MAX_RETRIES = 5' }, { at: 'cc-u2', quote: 'through the staging gate' }, { at: 'nope', quote: 'anything' },
    ],
  },
  {
    name: 'codex', agent: 'codex', bytes: () => jsonl(CODEX),
    handles: ['l0', 'l1', 'cx01', 'msg_cx01', 'call_w1', 'call_w1.out', 'call_p1', 'call_p1.out', 'call_e1', 'call_e1.out', 'call_s1', 'call_s1.out', 'call_zz.out', 'call_x1', 'call_x1.out', 'l14', 'l15', 'l16', 'nope'],
    cites: [
      { at: 'l1', quote: 'must stay idempotent' }, { at: 'l1', quote: 'must stay stateless' }, { at: 'cx01', quote: 'look at the worker' },
      { at: 'call_w1', quote: 'npm run test:worker' }, { at: 'call_w1.out', quote: 'duplicate delivery' }, { at: 'call_p1.out', quote: 'Updated src/worker.ts' },
      { at: 'call_e1', quote: 'rg idempotent src' }, { at: 'call_e1.out', quote: 'idempotent by key' }, { at: 'call_s1.out', quote: 'retry at least once' },
      { at: 'call_zz.out', quote: 'stray output' }, { at: 'call_x1', quote: 'npm run lint' }, { at: 'call_x1.out', quote: 'lint errors' },
      { at: 'l15', quote: 'green worker suite' }, { at: 'l16', quote: 'developer instructions' },
    ],
  },
  {
    name: 'pi', agent: 'pi', bytes: () => jsonl(PI),
    handles: ['pi-session-1894', 'pi-1', 'pi-2', 'pi-3', 'pi-4', 'pi-5', 'l1', 'nope'],
    cites: [
      { at: 'pi-1', quote: 'small functions over deep class trees' }, { at: 'pi-1', quote: 'small classes' }, { at: 'pi-2', quote: 'functions stay small' },
      { at: 'pi-3', quote: 'lint passed with 0 warnings' }, { at: 'pi-5', quote: 'after what they return' },
    ],
  },
  {
    name: 'cursor', agent: 'cursor', bytes: () => jsonl(CURSOR),
    handles: ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'nope'],
    cites: [
      { at: 'l0', quote: 'after the behaviour they prove' }, { at: 'l0', quote: 'after the ticket' }, { at: 'l1', quote: 'rename the test files' },
      { at: 'l2', quote: 'small and reviewable' }, { at: 'l4', quote: 'the numbering holds' },
    ],
  },
  {
    name: 'codex-large', agent: 'codex', bytes: bigCodex,
    handles: ['l0', 'l1', 'call_big', 'call_big.out', BIG_TAIL, `l${3 + BIG_LINES}`, 'nope'],
    cites: [
      { at: 'l1', quote: 'cache key includes the tenant' }, { at: 'call_big', quote: 'npm run test:cache' },
      { at: 'call_big.out', quote: 'cache suite green' }, { at: BIG_TAIL, quote: 'stays numbered' }, { at: BIG_TAIL, quote: 'stays unnumbered' },
    ],
  },
];
export const AGENT_SESSIONS = SESSIONS.map((s) => s.name);

export interface Scenario {
  sessions: Record<string, string>;
  learned_layer: string[];
  resolved: Record<string, string>;
  transcripts: Record<string, string>;
  reader: { resolved: Record<string, string>; transcripts: Record<string, string> };
}
export async function runScenario(readers: readonly TranscriptReader[] | undefined): Promise<Scenario> {
  const w = await openWorld(readers);
  const ids: Record<string, string> = {};
  for (const s of SESSIONS) ids[s.name] = await archive(w, s.agent, s.bytes());
  let n = 0;
  for (const s of SESSIONS) {
    for (const c of s.cites) {
      const at = `session:${ids[s.name]}#${c.at}`;
      await learn(w, { layer: 'learned', target: c.target ?? `slice:${s.name}-${n++}`, at, quote: c.quote });
    }
  }
  const first = SESSIONS[0]!;
  await learn(w, { layer: 'base', target: 'rule:port', at: `session:${ids[first.name]}#cc-u1`, quote: 'listens on port 4100' });
  await learn(w, { layer: 'base', target: 'rule:port-wrong', at: `session:${ids[first.name]}#cc-u1`, quote: 'listens on port 4200' });
  const rows = (await w.record.table('learned_layer')).rows.slice().sort((a, b) => Number(a.log_pos) - Number(b.log_pos)).map((r) => JSON.stringify(r, (_, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)));
  const shownTranscript = (name: string, messages: unknown): string => (name === 'codex-large' ? `sha256:${sha256(canonical(messages))} ${canonical((messages as unknown[] | undefined)?.length)}` : canonical(messages));
  const resolved: Record<string, string> = {};
  const transcripts: Record<string, string> = {};
  for (const s of SESSIONS) {
    for (const h of s.handles) resolved[`${s.name}#${h}`] = canonical(await w.record.resolve(`session:${ids[s.name]}#${h}`)) ?? 'undefined';
    transcripts[s.name] = shownTranscript(s.name, await w.record.transcript(ids[s.name]!)) ?? 'undefined';
  }
  await w.record.close();
  const reader = openReader(w, readers);
  const rResolved: Record<string, string> = {};
  const rTranscripts: Record<string, string> = {};
  try {
    for (const s of SESSIONS) {
      for (const h of s.handles) rResolved[`${s.name}#${h}`] = canonical(await reader.resolve(`session:${ids[s.name]}#${h}`)) ?? 'undefined';
      rTranscripts[s.name] = shownTranscript(s.name, await reader.transcript(ids[s.name]!)) ?? 'undefined';
    }
  } finally {
    reader.close();
  }
  return { sessions: ids, learned_layer: rows, resolved, transcripts, reader: { resolved: rResolved, transcripts: rTranscripts } };
}
