// Regression tests for the OTLP receiver (#42) beyond its acceptance suite: each one failed on the program it names.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { connect } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRecord } from '@deepbuild/record';
import type { RecordStore } from '@deepbuild/record';
import { doctor, startReceiver } from '../src/index.js';
import type { Receiver } from '../src/index.js';

const roots: string[] = [];
const open: Array<Receiver | RecordStore> = [];
afterEach(async () => {
  for (const o of open.splice(0).reverse()) await o.close();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const temp = (): string => { const dir = mkdtempSync(join(tmpdir(), 'deep-otlp-')); roots.push(dir); return dir; };
async function setUp(): Promise<{ record: RecordStore; url: string }> {
  const record = await openRecord({ path: join(temp(), 'record.db'), now: Date.now });
  open.push(record);
  const receiver = await startReceiver({ record, connection: { writer: 'ext:otlp', actor: 'you', scope: 'you' }, port: 0 });
  open.push(receiver);
  return { record, url: receiver.url };
}
const attrs = (o: Record<string, string | number>) => Object.entries(o).map(([key, v]) => ({ key, value: typeof v === 'string' ? { stringValue: v } : { intValue: String(v) } }));
const nanos = (ms: number) => String(BigInt(ms) * 1_000_000n);
const post = (url: string, signal: 'traces' | 'logs', body: unknown) =>
  fetch(`${url}/v1/${signal}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const logs = (records: unknown[]) => ({ resourceLogs: [{ scopeLogs: [{ logRecords: records }] }] });
const apiRequest = (at: number, a: Record<string, string | number>) => ({ timeUnixNano: nanos(at), attributes: attrs({ 'event.name': 'api_request', 'session.id': 'S1', model: 'claude-haiku-5-5', ...a }) });
const toolSpan = (s: { traceId?: string; spanId?: string; start?: number; end: number }) => ({ resourceSpans: [{ scopeSpans: [{ spans: [{
  traceId: s.traceId ?? 'ab'.repeat(16), spanId: s.spanId ?? 'cd'.repeat(8), name: 'claude_code.tool',
  ...(s.start === undefined ? {} : { startTimeUnixNano: nanos(s.start) }), endTimeUnixNano: nanos(s.end),
  attributes: attrs({ 'session.id': 'S1', tool_name: 'Bash' }),
}] }] }] });
const kinds = async (record: RecordStore, kind: string) => (await record.read({ after: 0 })).filter((e) => e.kind === kind);

describe('the receiver keeps only what the export says', () => {
  // Failed on: every missing count read as an exact 0.
  it('a request log missing a token count records its tokens as not exact', async () => {
    const { record, url } = await setUp();
    expect((await post(url, 'logs', logs([apiRequest(Date.now(), { cost_usd: '0.01', request_id: 'req_1', input_tokens: 10, output_tokens: 5 })]))).status).toBe(200);
    const [cost] = await kinds(record, 'request.cost');
    expect(cost?.data).toMatchObject({ tokens: { input: 10, cached: 0, output: 5, exact: false } });
  });

  // Failed on: a span with no IDs or no start time mapped to an event at time 0 or a duration of decades.
  it.each([
    ['no span ID', { spanId: '', start: Date.now() - 100, end: Date.now() }],
    ['no start time', { end: Date.now() }],
  ])('a tool span with %s is refused with 400 and appends nothing', async (_name, s) => {
    const { record, url } = await setUp();
    expect((await post(url, 'traces', toolSpan(s))).status).toBe(400);
    expect(await record.read({ after: 0 })).toEqual([]);
  });

  // Failed on: a mistyped collection read as an empty one and answered 200, so the exporter dropped the batch.
  it.each([
    ['logs', { resourceLogs: {} }],
    ['traces', { resourceSpans: [{ scopeSpans: {} }] }],
    ['traces', { resourceSpans: [{ scopeSpans: [{ spans: ['not a span'] }] }] }],
    // Failed on: attributes that aren't a list reading as none, so an api_request lost its cost and was dropped with a 200.
    ['logs', logs([{ timeUnixNano: nanos(Date.now()), attributes: { 'event.name': 'api_request', cost_usd: '0.01' } }])],
    ['logs', logs([{ timeUnixNano: nanos(Date.now()), attributes: [{ key: 'event.name', value: 'api_request' }] }])],
    ['logs', logs([{ timeUnixNano: nanos(Date.now()), attributes: [{ key: 7, value: { stringValue: 'api_request' } }] }])],
    // Failed on: a resource that isn't an object reading as one with no attributes, so a session-scoped export lost its session.
    ['logs', { resourceLogs: [{ resource: [], scopeLogs: [] }] }],
    ['traces', { resourceSpans: [{ resource: 'claude-code', scopeSpans: [] }] }],
    ['traces', { resourceSpans: [{ scopeSpans: [{ spans: [{ ...toolSpan({ start: 1, end: 2 }).resourceSpans[0]!.scopeSpans[0]!.spans[0]!, attributes: ['tool_name=Bash'] }] }] }] }],
  ] as const)('a malformed OTLP/JSON %s envelope is refused with 400', async (signal, body) => {
    const { url } = await setUp();
    expect((await post(url, signal, body)).status).toBe(400);
  });

  // Failed on: a null body or attribute value, the protobuf JSON mapping's default, refused with its whole export.
  it('a null body and a null attribute value are skipped, and the export is recorded', async () => {
    const { record, url } = await setUp();
    const request = apiRequest(Date.now(), { cost_usd: '0.01', request_id: 'req_null', input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0 });
    const body = logs([{ ...request, body: null, attributes: [...request.attributes, { key: 'ignored', value: null }] }]);
    expect((await post(url, 'logs', body)).status).toBe(200);
    expect(await kinds(record, 'request.cost')).toHaveLength(1);
  });

  // Failed on: the resource's attributes copied into every record, so a 200 KB export held the event loop for seconds.
  it('a protobuf export of many empty records under a resource with many attributes is read in well under a second', async () => {
    const { url } = await setUp();
    const varint = (n: number): number[] => { const out: number[] = []; do { out.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0)); n >>>= 7; } while (n); return out; };
    const field = (f: number, bytes: number[]): number[] => [(f << 3) | 2, ...varint(bytes.length), ...bytes];
    const resource = field(1, Array.from({ length: 400 }, (_, i) => field(1, [...field(1, [...Buffer.from(`k${i}`)]), ...field(2, field(1, [0x61]))])).flat());
    const records = Array.from({ length: 40_000 }, () => [0x12, 0x00]).flat();
    const body = Buffer.from(field(1, [...resource, ...field(2, records)]));
    const started = performance.now();
    const response = await fetch(`${url}/v1/logs`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf' }, body });
    expect(response.status).toBe(200);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  // Failed on: the fallback key taking the attributes in arrival order, so a reordered retry counted twice.
  it('a request with no request ID, exported again with its attributes in another order, is one event', async () => {
    const { record, url } = await setUp();
    const at = Date.now();
    const a = { cost_usd: '0.02', input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0 };
    const record1 = apiRequest(at, a);
    const record2 = { ...record1, attributes: [...record1.attributes].reverse() };
    expect((await post(url, 'logs', logs([record1]))).status).toBe(200);
    expect((await post(url, 'logs', logs([record2]))).status).toBe(200);
    expect(await kinds(record, 'request.cost')).toHaveLength(1);
  });

  // Failed on: a conflict swallowed and answered 200, so a changed export looked recorded; then on the whole
  // export answered 400 while its other records were already committed.
  it('a request exported again with another cost is reported rejected, the first cost stands, and its sibling is recorded', async () => {
    const { record, url } = await setUp();
    const at = Date.now();
    const a = { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0 };
    expect((await post(url, 'logs', logs([apiRequest(at, { ...a, request_id: 'req_2', cost_usd: '0.03' })]))).status).toBe(200);
    const again = await post(url, 'logs', logs([apiRequest(at, { ...a, request_id: 'req_2', cost_usd: '0.30' }), apiRequest(at, { ...a, request_id: 'req_3', cost_usd: '0.05' })]));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ partialSuccess: { rejectedLogRecords: '1' } });
    const costs = await kinds(record, 'request.cost');
    expect(costs.map((e) => (e.data as { cost: { usd: number } }).cost.usd)).toEqual([0.03, 0.05]);
  });
});

describe('the receiver closes only once its exports are answered', () => {
  // Failed on: close() destroying the sockets at once, so it resolved with an export's appends still running.
  it('close() called while an export is committing resolves after the export is committed and answered', async () => {
    const record = await openRecord({ path: join(temp(), 'record.db'), now: Date.now });
    open.push(record);
    let release!: () => void, appending!: () => void;
    const gate = new Promise<void>((r) => { release = r; }), started = new Promise<void>((r) => { appending = r; });
    const held = Object.create(record) as RecordStore;
    held.append = async (...args: Parameters<RecordStore['append']>) => { appending(); await gate; return record.append(...args); };
    const receiver = await startReceiver({ record: held, connection: { writer: 'ext:otlp', actor: 'you', scope: 'you' }, port: 0 });
    const answer = post(receiver.url, 'logs', logs([apiRequest(Date.now(), { cost_usd: '0.01', request_id: 'req_close', input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0 })]));
    await started;
    let closed = false;
    const closing = receiver.close().then(() => { closed = true; });
    await new Promise((r) => setTimeout(r, 50));
    expect(closed).toBe(false);
    release();
    await closing;
    expect((await answer).status).toBe(200);
    expect(await kinds(record, 'request.cost')).toHaveLength(1);
  });

  // Failed on: close() waiting on the exports in flight when it was called, so a second export pipelined on the
  // same connection was cut mid-commit and never answered.
  it('close() called while the first of two pipelined exports is committing answers both', async () => {
    const record = await openRecord({ path: join(temp(), 'record.db'), now: Date.now });
    open.push(record);
    let release!: () => void, appending!: () => void;
    const gate = new Promise<void>((r) => { release = r; }), started = new Promise<void>((r) => { appending = r; });
    const held = Object.create(record) as RecordStore;
    held.append = async (...args: Parameters<RecordStore['append']>) => { appending(); await gate; return record.append(...args); };
    const receiver = await startReceiver({ record: held, connection: { writer: 'ext:otlp', actor: 'you', scope: 'you' }, port: 0 });
    const a = { cost_usd: '0.01', input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_creation_tokens: 0 };
    const request = (id: string) => {
      const body = JSON.stringify(logs([apiRequest(Date.now(), { ...a, request_id: id })]));
      return `POST /v1/logs HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    };
    const socket = connect(receiver.port, '127.0.0.1');
    let received = '';
    socket.on('data', (chunk) => { received += chunk.toString('utf8'); });
    const ended = new Promise<void>((r) => { socket.on('close', () => r()); });
    socket.write(request('req_pipe_1') + request('req_pipe_2'));
    await started;
    const closing = receiver.close();
    release();
    await closing;
    await ended;
    expect(received.match(/^HTTP\/1\.1 200/gm)).toHaveLength(2);
    expect(await kinds(record, 'request.cost')).toHaveLength(2);
  });
});

describe('deep doctor never shows a secret an endpoint carries', () => {
  const run = (vars: Record<string, string>) => {
    const config = join(temp(), '.claude');
    mkdirSync(config);
    writeFileSync(join(config, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_ENABLE_TELEMETRY: '1', OTEL_LOGS_EXPORTER: 'otlp', OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', ...vars } }));
    return doctor({ HOME: config, CLAUDE_CONFIG_DIR: config })[0]!;
  };
  // Failed on: the healthy path printing the endpoint as given, and the failing path keeping its query.
  it('a password on a readable endpoint and a token in an unreadable one are redacted', () => {
    const healthy = run({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://me:hunter2@127.0.0.1:4318' });
    expect(healthy.level).toBe('ok');
    expect(healthy.evidence).not.toContain('hunter2');
    const failing = run({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4317/?token=hunter2' });
    expect(failing.level).toBe('fail');
    expect(failing.evidence).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
    expect(failing.evidence).not.toContain('hunter2');
  });
  // Failed on: an endpoint's path kept whole, and an endpoint that isn't a URL shown nearly as given.
  it('a token in an endpoint path or in an endpoint that is not a URL is redacted', () => {
    for (const endpoint of ['http://127.0.0.1:4318/token/hunter2', 'me:hunter2@127.0.0.1:4318', '127.0.0.1:4318/hunter2']) {
      const item = run({ OTEL_EXPORTER_OTLP_ENDPOINT: endpoint });
      expect(item.level).toBe('fail');
      expect(item.evidence).toContain('OTEL_EXPORTER_OTLP_ENDPOINT');
      expect(item.evidence).not.toContain('hunter2');
    }
  });
});
