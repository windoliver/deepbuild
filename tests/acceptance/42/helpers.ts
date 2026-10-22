// Test-side tools for the issue #42 acceptance tests: OTLP export requests built here (as OTLP/JSON and as
// hand-encoded OTLP protobuf, with no dependency), a Claude Code export shaped per its monitoring docs, a real
// record at a temp root, event builders from the contracts fixtures, and the reference-Mac gate and judge
// (as tests/acceptance/14). None of them stands in for the receiver.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { Connection, Event, EventInput, RecordStore } from '../../../packages/record/src/index.ts';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
type Obj = { [key: string]: JsonValue };

// ---- Temp roots and a real record ------------------------------------------------------------------
const roots: string[] = [];
export function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deep-42-'));
  roots.push(dir);
  return dir;
}
export const removeRoots = (): void => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); };
export const openTempRecord = (): Promise<RecordStore> => openRecord({ path: join(tempRoot(), 'record.db'), now: Date.now });
export async function allEvents(record: RecordStore): Promise<Event[]> {
  const out: Event[] = [];
  for (let batch = await record.read({ after: 0 }); batch.length; batch = await record.read({ after: batch.at(-1)!.log_pos })) out.push(...batch);
  return out;
}
export const dataOf = (e: Event): Obj => e.data as Obj;

// ---- Connections and events the hub and the app would append ------------------------------------------
export const YOU = { actor: 'you', scope: 'you' } as const;
export const OTLP: Connection = { writer: 'ext:otlp', ...YOU };
export const hook = (session: string): Connection => ({ writer: 'hook', ...YOU, session, agent: 'claude-code' });
export const app = (session?: string): Connection => (session === undefined ? { writer: 'app', ...YOU } : { writer: 'app', ...YOU, session });
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let counter = 0;
export function ulid(): string {
  let t = BigInt(Date.now()), r = BigInt(++counter), s = '';
  for (let i = 0; i < 16; i++) { s = CROCKFORD[Number(r & 31n)] + s; r >>= 5n; }
  for (let i = 0; i < 10; i++) { s = CROCKFORD[Number(t & 31n)] + s; t >>= 5n; }
  return s;
}
function fromFixture(schema: string, data: Obj): EventInput {
  const f = structuredClone(fixtures(schema)[0]) as Obj;
  const kind = schema.split('@')[0]!;
  return { v: f.v as number, id: ulid(), kind, ts: Date.now(), data: { ...(f.data as Obj), ...data } };
}
export const sessionStart = (): EventInput => fromFixture('session.start@1', { agent: 'claude-code', worktree: '~/src/app', branch: 'main', thread: ulid() });
export const taskCreated = (task: string): EventInput => fromFixture('task.created@1', { task_ref: task, thread: ulid(), title: 'A task' });
export const claimMade = (task: string): EventInput => fromFixture('claim.made@1', { task_ref: task, attempt: 1 });

// ---- Claude Code's facts: the models and tools it lists --------------------------------------------------
const facts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { modelFamily: { families: Record<string, string> }; toolKinds: { tools: Record<string, string> } };
export const KNOWN_MODEL = Object.keys(facts.modelFamily.families)[0]!;
export const KNOWN_TOOL = 'Bash';
expect(facts.toolKinds.tools[KNOWN_TOOL], 'the facts list Bash').toBeDefined();

// ---- OTLP requests in the OTLP/JSON shape (lowerCamelCase, hex IDs, int64 as decimal strings) ------------
export type Value = string | number | boolean | { double: number };
export type Attr = { key: string; value: Obj };
const any = (v: Value): Obj =>
  typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { boolValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : { doubleValue: v.double };
export const attrs = (o: Record<string, Value>): Attr[] => Object.entries(o).map(([key, v]) => ({ key, value: any(v) }));
export const hex = (bytes: number): string => randomBytes(bytes).toString('hex');
const nanos = (ms: number): string => (BigInt(Math.round(ms)) * 1_000_000n).toString();
export interface SpanIn { name: string; traceId: string; spanId?: string; parentSpanId?: string; start: number; end: number; attributes: Record<string, Value> }
export const span = (s: SpanIn): Obj => ({
  traceId: s.traceId, spanId: s.spanId ?? hex(8), ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}), name: s.name, kind: 1,
  startTimeUnixNano: nanos(s.start), endTimeUnixNano: nanos(s.end), attributes: attrs(s.attributes) as unknown as JsonValue, status: { code: 0 },
});
const RESOURCE = { resource: { attributes: attrs({ 'service.name': 'claude-code', 'service.version': '2.1.304' }) as unknown as JsonValue } };
const SCOPE = { name: 'com.anthropic.claude_code', version: '2.1.304' };
export const traces = (spans: Obj[]): Obj => ({ resourceSpans: [{ ...RESOURCE, scopeSpans: [{ scope: SCOPE, spans }] }] });
export const logRecord = (event: string, at: number, attributes: Record<string, Value>): Obj => ({
  timeUnixNano: nanos(at), observedTimeUnixNano: nanos(at), severityNumber: 9, body: { stringValue: `claude_code.${event}` },
  attributes: attrs({ 'event.name': event, 'event.timestamp': new Date(at).toISOString(), ...attributes }) as unknown as JsonValue,
});
export const logs = (logRecords: Obj[]): Obj => ({ resourceLogs: [{ ...RESOURCE, scopeLogs: [{ scope: SCOPE, logRecords }] }] });

// ---- The same requests as binary OTLP protobuf (opentelemetry-proto field numbers) ------------------------
type Wire = 'msg' | 'str' | 'hex' | 'fixed64' | 'varint' | 'any';
const MESSAGES: Record<string, Record<string, [number, Wire, string?]>> = {
  traces: { resourceSpans: [1, 'msg', 'ResourceSpans'] },
  logs: { resourceLogs: [1, 'msg', 'ResourceLogs'] },
  ResourceSpans: { resource: [1, 'msg', 'Resource'], scopeSpans: [2, 'msg', 'ScopeSpans'] },
  ResourceLogs: { resource: [1, 'msg', 'Resource'], scopeLogs: [2, 'msg', 'ScopeLogs'] },
  Resource: { attributes: [1, 'msg', 'KeyValue'] },
  ScopeSpans: { scope: [1, 'msg', 'Scope'], spans: [2, 'msg', 'Span'] },
  ScopeLogs: { scope: [1, 'msg', 'Scope'], logRecords: [2, 'msg', 'LogRecord'] },
  Scope: { name: [1, 'str'], version: [2, 'str'] },
  Span: { traceId: [1, 'hex'], spanId: [2, 'hex'], parentSpanId: [4, 'hex'], name: [5, 'str'], kind: [6, 'varint'], startTimeUnixNano: [7, 'fixed64'], endTimeUnixNano: [8, 'fixed64'], attributes: [9, 'msg', 'KeyValue'], status: [15, 'msg', 'Status'] },
  Status: { code: [3, 'varint'] },
  LogRecord: { timeUnixNano: [1, 'fixed64'], severityNumber: [2, 'varint'], body: [5, 'any'], attributes: [6, 'msg', 'KeyValue'], observedTimeUnixNano: [11, 'fixed64'] },
  KeyValue: { key: [1, 'str'], value: [2, 'any'] },
};
const varint = (n: bigint): number[] => { const out: number[] = []; do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; out.push(b); } while (n); return out; };
const tag = (field: number, wire: number): number[] => varint(BigInt((field << 3) | wire));
const delimited = (field: number, bytes: Uint8Array): number[] => [...tag(field, 2), ...varint(BigInt(bytes.length)), ...bytes];
function anyValue(v: Obj): Uint8Array<ArrayBuffer> {
  if ('stringValue' in v) return Uint8Array.from(delimited(1, Buffer.from(String(v.stringValue), 'utf8')));
  if ('boolValue' in v) return Uint8Array.from([...tag(2, 0), v.boolValue ? 1 : 0]);
  if ('intValue' in v) return Uint8Array.from([...tag(3, 0), ...varint(BigInt(String(v.intValue)))]);
  const d = Buffer.alloc(8); d.writeDoubleLE(Number(v.doubleValue));
  return Uint8Array.from([...tag(4, 1), ...d]);
}
function message(type: string, value: Obj): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  for (const [name, [field, wire, sub]] of Object.entries(MESSAGES[type]!)) {
    const raw = value[name];
    if (raw === undefined) continue;
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      if (wire === 'msg') out.push(...delimited(field, message(sub!, item as Obj)));
      else if (wire === 'any') out.push(...delimited(field, anyValue(item as Obj)));
      else if (wire === 'str') out.push(...delimited(field, Buffer.from(String(item), 'utf8')));
      else if (wire === 'hex') out.push(...delimited(field, Buffer.from(String(item), 'hex')));
      else if (wire === 'varint') out.push(...tag(field, 0), ...varint(BigInt(item as number)));
      else { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(String(item))); out.push(...tag(field, 1), ...b); }
    }
  }
  return Uint8Array.from(out);
}
export const protobuf = (request: Obj): Uint8Array<ArrayBuffer> => message('resourceSpans' in request ? 'traces' : 'logs', request);

export type Encoding = 'json' | 'protobuf';
export const CONTENT_TYPE: Record<Encoding, string> = { json: 'application/json', protobuf: 'application/x-protobuf' };
/** POSTs one export to a receiver at `base` (http://host:port), as OTLP/HTTP does: /v1/traces or /v1/logs. */
export async function exportTo(base: string, request: Obj, encoding: Encoding): Promise<Response> {
  const path = 'resourceSpans' in request ? '/v1/traces' : '/v1/logs';
  const body = encoding === 'json' ? JSON.stringify(request) : protobuf(request);
  return fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': CONTENT_TYPE[encoding] }, body });
}

// ---- One Claude Code prompt, shaped per code.claude.com/docs/en/monitoring-usage ---------------------------
export interface Prompt { session: string; promptId: string; toolUseId: string; requestId: string; traces: Obj; logs: Obj }
/** A prompt that ran Bash after 1,500 ms blocked on the user, and one model request costing $0.0123. */
export function claudePrompt(session: string, t0 = Date.now() - 10_000): Prompt {
  const traceId = hex(16), root = hex(8), tool = hex(8);
  const promptId = crypto.randomUUID(), toolUseId = `toolu_${hex(12)}`, requestId = `req_${hex(12)}`;
  const common = { 'session.id': session, 'user.account_uuid': '00000000-0000-4000-8000-000000000001', 'organization.id': '00000000-0000-4000-8000-000000000002' };
  const spans = [
    span({ name: 'claude_code.interaction', traceId, spanId: root, start: t0, end: t0 + 6000, attributes: { ...common, 'user_prompt_length': 24, 'interaction.sequence': 1, 'interaction.duration_ms': 6000 } }),
    span({ name: 'claude_code.llm_request', traceId, parentSpanId: root, start: t0 + 100, end: t0 + 1300, attributes: { ...common, model: KNOWN_MODEL, duration_ms: 1200, ttft_ms: 400, input_tokens: 1200, output_tokens: 80, cache_read_tokens: 3000, cache_creation_tokens: 0, request_id: requestId, attempt: 1, success: true, stop_reason: 'tool_use' } }),
    span({ name: 'claude_code.tool', traceId, spanId: tool, parentSpanId: root, start: t0 + 1300, end: t0 + 3000, attributes: { ...common, tool_name: KNOWN_TOOL, tool_use_id: toolUseId, duration_ms: 1700, result_tokens: 12 } }),
    span({ name: 'claude_code.tool.blocked_on_user', traceId, parentSpanId: tool, start: t0 + 1300, end: t0 + 2800, attributes: { ...common, duration_ms: 1500, decision: 'accept', source: 'user_temporary' } }),
    span({ name: 'claude_code.tool.execution', traceId, parentSpanId: tool, start: t0 + 2800, end: t0 + 3000, attributes: { ...common, duration_ms: 200, tool_use_id: toolUseId, success: true } }),
  ];
  const events = { ...common, 'prompt.id': promptId };
  const records = [
    logRecord('user_prompt', t0, { ...events, 'event.sequence': 1, prompt_length: 24, prompt: '<REDACTED>' }),
    logRecord('api_request', t0 + 1300, { ...events, 'event.sequence': 2, model: KNOWN_MODEL, cost_usd: { double: 0.0123 }, cost_usd_micros: 12300, duration_ms: 1200, input_tokens: 1200, output_tokens: 80, cache_read_tokens: 3000, cache_creation_tokens: 0, request_id: requestId }),
    logRecord('tool_decision', t0 + 2800, { ...events, 'event.sequence': 3, tool_name: KNOWN_TOOL, tool_use_id: toolUseId, decision: 'accept', source: 'user_temporary', tool_source: 'builtin' }),
    logRecord('tool_result', t0 + 3000, { ...events, 'event.sequence': 4, tool_name: KNOWN_TOOL, tool_use_id: toolUseId, success: 'true', duration_ms: 200, decision_type: 'accept', decision_source: 'user_temporary', tool_result_size_bytes: 3 }),
  ];
  return { session, promptId, toolUseId, requestId, traces: traces(spans), logs: logs(records) };
}
/** One api_request log for `session` costing `usd`, its values as strings, as an exporter may send them. */
export const costLog = (session: string, usd: string): Obj =>
  logs([logRecord('api_request', Date.now() - 1000, { 'session.id': session, 'prompt.id': crypto.randomUUID(), model: KNOWN_MODEL, cost_usd: usd, input_tokens: '10', output_tokens: '5', cache_read_tokens: '0', cache_creation_tokens: '0', duration_ms: '300', request_id: `req_${hex(12)}` })]);

// ---- The reference-Mac gate and the design's judge for timing results (as tests/acceptance/14) ------------
const REFERENCE_MACS = [{ model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 }, { model: 'Mac15,12', chip: 'Apple M3', gib: 16 }];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = read('sysctl', '-n', 'hw.model'); chip = read('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = read('pmset', '-g', 'batt'); power = read('pmset', '-g'); therm = read('pmset', '-g', 'therm');
  } catch (e) { return `cannot read the machine: ${(e as Error).message}`; }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(batt)) return 'not on mains power';
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  if ([...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100) || !/No thermal warning level/.test(therm)) return 'thermal state not nominal';
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
