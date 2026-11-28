import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [session, factsFile] = process.argv.slice(2);
if (!session || !factsFile) {
  process.stderr.write('usage: claude-code.mjs <session id> <claude-code.facts.json>\n');
  process.exit(2);
}

const configHome = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME ?? '', '.claude');
const settingsFile = join(configHome, 'settings.json');
const settingsEnv = existsSync(settingsFile) ? (JSON.parse(readFileSync(settingsFile, 'utf8')).env ?? {}) : {};
const env = { ...process.env, ...settingsEnv };

const facts = JSON.parse(readFileSync(factsFile, 'utf8'));
const MODEL = Object.keys(facts.modelFamily.families)[0];
const TOOL = 'Bash';

const any = (v) => typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { boolValue: v } : typeof v === 'number' ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : { doubleValue: v.double };
const attrs = (o) => Object.entries(o).map(([key, v]) => ({ key, value: any(v) }));
const hex = (bytes) => randomBytes(bytes).toString('hex');
const nanos = (ms) => (BigInt(Math.round(ms)) * 1_000_000n).toString();
const span = (s) => ({
  traceId: s.traceId, spanId: s.spanId ?? hex(8), ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}), name: s.name, kind: 1,
  startTimeUnixNano: nanos(s.start), endTimeUnixNano: nanos(s.end), attributes: attrs(s.attributes), status: { code: 0 },
});
const RESOURCE = { resource: { attributes: attrs({ 'service.name': 'claude-code', 'service.version': '2.1.308' }) } };
const SCOPE = { name: 'com.anthropic.claude_code', version: '2.1.308' };
const logRecord = (event, at, attributes) => ({
  timeUnixNano: nanos(at), observedTimeUnixNano: nanos(at), severityNumber: 9, body: { stringValue: `claude_code.${event}` },
  attributes: attrs({ 'event.name': event, 'event.timestamp': new Date(at).toISOString(), ...attributes }),
});

const t0 = Date.now() - 10_000;
const traceId = hex(16), root = hex(8), tool = hex(8);
const promptId = randomUUID(), toolUseId = `toolu_${hex(12)}`, requestId = `req_${hex(12)}`;
const common = { 'session.id': session, 'user.account_uuid': '00000000-0000-4000-8000-000000000001', 'organization.id': '00000000-0000-4000-8000-000000000002' };
const traces = { resourceSpans: [{ ...RESOURCE, scopeSpans: [{ scope: SCOPE, spans: [
  span({ name: 'claude_code.interaction', traceId, spanId: root, start: t0, end: t0 + 6000, attributes: { ...common, user_prompt_length: 24, 'interaction.sequence': 1, 'interaction.duration_ms': 6000 } }),
  span({ name: 'claude_code.llm_request', traceId, parentSpanId: root, start: t0 + 100, end: t0 + 1300, attributes: { ...common, model: MODEL, duration_ms: 1200, ttft_ms: 400, input_tokens: 1200, output_tokens: 80, cache_read_tokens: 3000, cache_creation_tokens: 0, request_id: requestId, attempt: 1, success: true, stop_reason: 'tool_use' } }),
  span({ name: 'claude_code.tool', traceId, spanId: tool, parentSpanId: root, start: t0 + 1300, end: t0 + 3000, attributes: { ...common, tool_name: TOOL, tool_use_id: toolUseId, duration_ms: 1700, result_tokens: 12 } }),
  span({ name: 'claude_code.tool.blocked_on_user', traceId, parentSpanId: tool, start: t0 + 1300, end: t0 + 2800, attributes: { ...common, duration_ms: 1500, decision: 'accept', source: 'user_temporary' } }),
  span({ name: 'claude_code.tool.execution', traceId, parentSpanId: tool, start: t0 + 2800, end: t0 + 3000, attributes: { ...common, duration_ms: 200, tool_use_id: toolUseId, success: true } }),
] }] }] };
const events = { ...common, 'prompt.id': promptId };
const logs = { resourceLogs: [{ ...RESOURCE, scopeLogs: [{ scope: SCOPE, logRecords: [
  logRecord('user_prompt', t0, { ...events, 'event.sequence': 1, prompt_length: 24, prompt: '<REDACTED>' }),
  logRecord('api_request', t0 + 1300, { ...events, 'event.sequence': 2, model: MODEL, cost_usd: { double: 0.0123 }, cost_usd_micros: 12300, duration_ms: 1200, input_tokens: 1200, output_tokens: 80, cache_read_tokens: 3000, cache_creation_tokens: 0, request_id: requestId }),
  logRecord('tool_decision', t0 + 2800, { ...events, 'event.sequence': 3, tool_name: TOOL, tool_use_id: toolUseId, decision: 'accept', source: 'user_temporary', tool_source: 'builtin' }),
  logRecord('tool_result', t0 + 3000, { ...events, 'event.sequence': 4, tool_name: TOOL, tool_use_id: toolUseId, success: 'true', duration_ms: 200, decision_type: 'accept', decision_source: 'user_temporary', tool_result_size_bytes: 3 }),
] }] }] };

const MESSAGES = {
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
const varint = (n) => { const out = []; do { let b = Number(n & 0x7fn); n >>= 7n; if (n) b |= 0x80; out.push(b); } while (n); return out; };
const tag = (field, wire) => varint(BigInt((field << 3) | wire));
const delimited = (field, bytes) => [...tag(field, 2), ...varint(BigInt(bytes.length)), ...bytes];
function anyValue(v) {
  if ('stringValue' in v) return Uint8Array.from(delimited(1, Buffer.from(String(v.stringValue), 'utf8')));
  if ('boolValue' in v) return Uint8Array.from([...tag(2, 0), v.boolValue ? 1 : 0]);
  if ('intValue' in v) return Uint8Array.from([...tag(3, 0), ...varint(BigInt(String(v.intValue)))]);
  const d = Buffer.alloc(8); d.writeDoubleLE(Number(v.doubleValue));
  return Uint8Array.from([...tag(4, 1), ...d]);
}
function message(type, value) {
  const out = [];
  for (const [name, [field, wire, sub]] of Object.entries(MESSAGES[type])) {
    const raw = value[name];
    if (raw === undefined) continue;
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      if (wire === 'msg') out.push(...delimited(field, message(sub, item)));
      else if (wire === 'any') out.push(...delimited(field, anyValue(item)));
      else if (wire === 'str') out.push(...delimited(field, Buffer.from(String(item), 'utf8')));
      else if (wire === 'hex') out.push(...delimited(field, Buffer.from(String(item), 'hex')));
      else if (wire === 'varint') out.push(...tag(field, 0), ...varint(BigInt(item)));
      else { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(String(item))); out.push(...tag(field, 1), ...b); }
    }
  }
  return Uint8Array.from(out);
}

const report = { session, sent: {} };
const fail = (why) => {
  report.error = why;
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(1);
};
if (env.CLAUDE_CODE_ENABLE_TELEMETRY !== '1') fail('CLAUDE_CODE_ENABLE_TELEMETRY is not 1: Claude Code exports nothing');

const RETRYABLE = new Set([429, 502, 503, 504]);
const TIMEOUT_MS = 30_000;
async function exportSignal(signal, request) {
  const S = signal.toUpperCase();
  if (!String(env[`OTEL_${S}_EXPORTER`] ?? '').split(',').map((v) => v.trim()).includes('otlp')) return { skipped: `OTEL_${S}_EXPORTER is not otlp` };
  const protocol = env[`OTEL_EXPORTER_OTLP_${S}_PROTOCOL`] ?? env.OTEL_EXPORTER_OTLP_PROTOCOL ?? 'http/protobuf';
  if (protocol !== 'http/protobuf' && protocol !== 'http/json') return { skipped: `protocol ${protocol} is not OTLP/HTTP` };
  const own = env[`OTEL_EXPORTER_OTLP_${S}_ENDPOINT`];
  const url = own ?? `${(env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318').replace(/\/+$/, '')}/v1/${signal}`;
  const json = protocol === 'http/json';
  const body = json ? JSON.stringify(request) : message(signal, request);
  const headers = { 'content-type': json ? 'application/json' : 'application/x-protobuf' };
  const started = Date.now();
  let backoff = 250, last = '';
  for (;;) {
    try {
      const answer = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) });
      if (answer.ok) return { url, status: answer.status };
      last = `${url} answered ${answer.status}`;
      if (!RETRYABLE.has(answer.status)) return { url, error: last };
    } catch (error) {
      last = `${url}: ${error?.cause?.code ?? error?.cause?.message ?? error?.message ?? String(error)}`;
    }
    if (Date.now() - started + backoff > TIMEOUT_MS) return { url, error: `${last} (gave up after ${Date.now() - started} ms of retries)` };
    // deadline: an OTLP exporter retries a refused or retryable export with backoff until its export timeout
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, 4000);
  }
}

const [tracesSent, logsSent] = await Promise.all([exportSignal('traces', traces), exportSignal('logs', logs)]);
report.sent = { traces: tracesSent, logs: logsSent };
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(tracesSent.status && logsSent.status ? 0 : 1);
