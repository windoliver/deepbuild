// The OTLP receiver (#42): an optional first-party extension that takes an agent's own OpenTelemetry as
// events, with no parsing of its output. It listens on 127.0.0.1 alone for OTLP/HTTP traces and logs, in
// protobuf or JSON, and maps Claude Code's tool spans (with the time each waited on you) to `tool.span` and
// each model request's reported cost to `request.cost`. A model or tool name Claude Code's facts don't list
// folds to `other` before it names a reading. Nothing here reads a clock for an event: every time comes from
// the export, so a retried export appends nothing new.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { gunzipSync } from 'node:zlib';
import type { Connection, EventInput, RecordStore } from '@deepbuild/record';
import { readLogs, readSpans, WireError, type Encoding, type Log, type Scalar, type Span } from './wire.js';

export { doctor } from './doctor.js';

/** OTLP/HTTP's own port; 4317 is gRPC, which this receiver doesn't speak. */
const DEFAULT_PORT = 4318;
const HOST = '127.0.0.1';
const AGENT = 'claude-code';
const MAX_BODY = 16 * 1024 * 1024;
/** Tool-call waits held for a tool span still to come, oldest dropped first. */
const MAX_WAITS = 10_000;

export interface ReceiverOptions {
  record: RecordStore;
  /** What the hub proved for the extension's writer; each append adds the export's session and agent. */
  connection: Connection;
  /** Default 4318; 0 takes a free port. There is no host option: always 127.0.0.1. */
  port?: number;
}
export interface Receiver {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

// ---- Claude Code's facts: the names a reading may carry -----------------------------------------------------
const facts = JSON.parse(readFileSync(new URL('../../../adapters/claude-code.facts.json', import.meta.url), 'utf8')) as {
  modelFamily: { families: Record<string, string> };
  toolKinds: { tools: Record<string, string> };
};
const title = (name: string): string => (/^[0-9A-Za-z]+$/.test(name) ? name[0]!.toUpperCase() + name.slice(1) : 'Other');
const toolReading = (tool: string): string => `reading:otlpBlocked${Object.hasOwn(facts.toolKinds.tools, tool) ? title(tool) : 'Other'}`;
const costReading = (model: string): string => {
  const family = Object.hasOwn(facts.modelFamily.families, model) ? facts.modelFamily.families[model]! : 'other';
  return `reading:otlpCost${title(family)}`;
};

// ---- Mapping ------------------------------------------------------------------------------------------------
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID whose time is the event's and whose rest is a digest of what identifies it, so a retry has the same ID. */
function ulidOf(ms: number, ...key: string[]): string {
  let t = Math.max(0, Math.min(Math.floor(ms), 2 ** 48 - 1)), time = '';
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32]! + time; t = Math.floor(t / 32); }
  const digest = createHash('sha256').update(key.join('\u0000')).digest();
  let rest = '';
  for (let i = 0; i < 16; i++) rest += CROCKFORD[digest[i]! % 32]!;
  return time + rest;
}

interface Wait { blocked_ms: number | null; decision: string | null }
interface Mapped { session: string | null; event: EventInput }

function toolSpan(span: Span, wait: Wait | undefined): Mapped {
  const tool = text(span.attrs.tool_name) ?? 'unknown';
  const data: Record<string, EventInput['data']> = {
    tool, tool_use_id: text(span.attrs.tool_use_id), duration_ms: num(span.attrs.duration_ms) ?? Math.max(0, span.endMs - span.startMs),
    blocked_ms: wait?.blocked_ms ?? null, decision: wait?.decision ?? null, reading: toolReading(tool),
  };
  return { session: text(span.attrs['session.id']), event: { v: 1, id: ulidOf(span.endMs, 'tool.span', span.traceId, span.spanId), kind: 'tool.span', ts: span.endMs, data } };
}
const isApiRequest = (log: Log): boolean => log.attrs['event.name'] === 'api_request' || log.attrs['event.name'] === 'claude_code.api_request' || log.body === 'claude_code.api_request';
function requestCost(log: Log): Mapped | null {
  const usd = num(log.attrs.cost_usd);
  if (usd === null) return null;
  const model = text(log.attrs.model) ?? 'unknown';
  const requestId = text(log.attrs.request_id);
  const session = text(log.attrs['session.id']);
  // A count the export left out or sent unreadable is not the agent's own zero: the tokens are then not exact.
  let exact = true;
  const count = (name: string): number => {
    const n = num(log.attrs[name]);
    if (n === null) exact = false;
    return Math.round(n ?? 0);
  };
  const data: Record<string, EventInput['data']> = {
    model, request_id: requestId, cost: { basis: 'reported', usd },
    tokens: { input: count('input_tokens') + count('cache_creation_tokens'), cached: count('cache_read_tokens'), output: count('output_tokens'), exact },
    reading: costReading(model),
  };
  // One request is one event however often its export is retried: keyed by its request ID, else by the log itself.
  // Attributes are unordered in OTLP, so the fallback key sorts them: a retry in another order is the same request.
  const all: Array<[string, Scalar]> = [];
  for (const name in log.attrs) all.push([name, log.attrs[name]!]);
  const key = requestId ?? JSON.stringify([log.timeMs, all.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]);
  return { session, event: { v: 1, id: ulidOf(log.timeMs, 'request.cost', session ?? '', key), kind: 'request.cost', ts: log.timeMs, data } };
}

// ---- The server ---------------------------------------------------------------------------------------------
const LOOPBACK = new Set(['127.0.0.1', '::ffff:127.0.0.1']);
const MAPPED_SPANS = new Set(['claude_code.tool', 'claude_code.tool.blocked_on_user']);
const CONTENT: Record<string, Encoding> = { 'application/x-protobuf': 'protobuf', 'application/json': 'json' };
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
/** The record's codes for an event it will never take, however often it's sent. */
const REFUSED = new Set(['schema', 'forged', 'writer', 'conflict']);
/** An Export*ServiceResponse: empty, or partial_success (field 1) with the rejected count (1) and why (2). */
function response(encoding: Encoding, rejected: 'rejectedSpans' | 'rejectedLogRecords', refused: string[]): string | Buffer {
  const errorMessage = refused.length ? `${refused.length} refused by the record; the first: ${refused[0]}` : '';
  if (encoding === 'json') return JSON.stringify(refused.length ? { partialSuccess: { [rejected]: String(refused.length), errorMessage } } : {});
  if (!refused.length) return Buffer.alloc(0);
  const varint = (n: number): number[] => { const out: number[] = []; do { out.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0)); n = Math.floor(n / 128); } while (n); return out; };
  const message = Buffer.from(errorMessage, 'utf8');
  const partial = Buffer.concat([Buffer.from([0x08, ...varint(refused.length), 0x12, ...varint(message.length)]), message]);
  return Buffer.concat([Buffer.from([0x0a, ...varint(partial.length)]), partial]);
}

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, `an export over ${MAX_BODY} bytes`);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  const encoding = String(req.headers['content-encoding'] ?? 'identity').toLowerCase();
  if (encoding === 'gzip') {
    try { return gunzipSync(raw, { maxOutputLength: MAX_BODY }); } catch (error) { throw new HttpError(400, `the gzip body does not inflate: ${(error as Error).message}`); }
  }
  if (encoding !== 'identity') throw new HttpError(415, `content encoding ${encoding} is not gzip or none`);
  return raw;
}

export function startReceiver(options: ReceiverOptions): Promise<Receiver> {
  const { record, connection } = options;
  const waits = new Map<string, Wait>();

  const mapSpans = (spans: Span[]): Mapped[] => {
    // A span's IDs and times are its identity: one without them can't be told from another, so the export is refused.
    for (const s of spans) if (!/^[0-9a-f]{32}$/.test(s.traceId) || !/^[0-9a-f]{16}$/.test(s.spanId) || s.startMs <= 0 || s.endMs < s.startMs) throw new WireError(`span ${s.name} has no valid trace ID, span ID, start or end time`);
    for (const s of spans) {
      if (s.name !== 'claude_code.tool.blocked_on_user') continue;
      waits.delete(`${s.traceId}/${s.parentSpanId}`);
      waits.set(`${s.traceId}/${s.parentSpanId}`, { blocked_ms: num(s.attrs.duration_ms) ?? Math.max(0, s.endMs - s.startMs), decision: text(s.attrs.decision) });
      if (waits.size > MAX_WAITS) waits.delete(waits.keys().next().value!);
    }
    return spans.filter((s) => s.name === 'claude_code.tool').map((s) => toolSpan(s, waits.get(`${s.traceId}/${s.spanId}`)));
  };
  const mapLogs = (logs: Log[]): Mapped[] => logs.filter(isApiRequest).flatMap((l) => {
    if (l.timeMs <= 0) throw new WireError('an api_request log has no time');
    return requestCost(l) ?? [];
  });

  // A retry of what the log holds is the same event and appends nothing; the same span or request with other
  // content is a conflict the export is refused for, never a silent success.
  const append = async ({ session, event }: Mapped): Promise<void> => {
    await record.append({ ...connection, agent: AGENT, ...(session ? { session } : {}) }, event);
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) throw new HttpError(403, 'the receiver takes exports from this machine only');
    if (req.headers.origin !== undefined) throw new HttpError(403, 'the receiver takes no request a browser page sent');
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/v1/traces' && path !== '/v1/logs') throw new HttpError(404, `no OTLP signal at ${path}`);
    if (req.method !== 'POST') throw new HttpError(405, 'OTLP/HTTP exports are POSTs');
    const type = String(req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
    const encoding = CONTENT[type];
    if (!encoding) throw new HttpError(415, `content type ${type || '(none)'} is not application/x-protobuf or application/json`);
    const buf = await body(req);
    let mapped: Mapped[];
    try {
      mapped = path === '/v1/traces' ? mapSpans(readSpans(buf, encoding, (name) => MAPPED_SPANS.has(name))) : mapLogs(readLogs(buf, encoding));
    } catch (error) {
      if (error instanceof WireError) throw new HttpError(400, `the export does not decode: ${error.message}`);
      throw error;
    }
    // Each event commits on its own, so the answer counts them: an event the record refuses (a schema, writer
    // or conflict) is reported in partial_success, the rest stand. A record that failed answers 503: the
    // exporter retries, and what did commit dedupes by ID.
    const refused: string[] = [];
    for (const outcome of await Promise.allSettled(mapped.map(append))) {
      if (outcome.status === 'fulfilled') continue;
      const error = outcome.reason as { code?: string; message?: string };
      if (!REFUSED.has(error.code ?? '')) throw new HttpError(503, `the record failed: ${error.message ?? String(error)}`);
      refused.push(error.message ?? String(error));
    }
    // Only now, with every other event committed: an Export*ServiceResponse in the request's own encoding.
    res.writeHead(200, { 'content-type': type });
    res.end(response(encoding, path === '/v1/traces' ? 'rejectedSpans' : 'rejectedLogRecords', refused));
  }

  // Exports being handled: close() answers each before it drops a connection, so none is cut mid-commit.
  const inFlight = new Set<Promise<void>>();
  const server = createServer((req, res) => {
    const handled = handle(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(error instanceof Error ? error.message : String(error));
    });
    // Answered once the response is flushed (finish) or its connection is gone (close), not when it is written.
    const answered = new Promise<void>((done) => { res.once('finish', done); res.once('close', done); });
    const export_ = Promise.all([handled, answered]).then(() => undefined);
    inFlight.add(export_);
    void export_.finally(() => inFlight.delete(export_));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? DEFAULT_PORT, HOST, () => {
      server.off('error', reject);
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        host: HOST, port, url: `http://${HOST}:${port}`,
        // No new connection is taken; each export in flight is committed and answered; then the idle
        // keep-alive connections that would hold the server open are dropped.
        close: async () => {
          const closed = new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())));
          // A request pipelined behind one being answered is taken as that one's response finishes, so it is
          // in the set before this wait ends.
          await Promise.all(inFlight);
          server.closeAllConnections();
          await closed;
        },
      });
    });
  });
}

// ---- Reading cost back --------------------------------------------------------------------------------------
/** A session's or a task's request cost, as its row and its task show it. */
export type Cost = { captured: true; usd: number } | { captured: false; text: 'not captured' };
const NOT_CAPTURED: Cost = { captured: false, text: 'not captured' };

/** The reported cost of the session, or of every session with an attempt at the task; none at all is not captured, never $0. */
export async function costOf(record: RecordStore, of: { session: string } | { task: string }): Promise<Cost> {
  const sessions = 'session' in of
    ? [of.session]
    : (await record.table('attempts')).rows.filter((r) => r.task_ref === of.task).map((r) => String(r.session_id));
  const wanted = new Set(sessions);
  const costs = (await record.table('session_costs')).rows.filter((r) => wanted.has(String(r.session_id))).map((r) => Number(r.usd));
  return costs.length ? { captured: true, usd: costs.reduce((a, b) => a + b, 0) } : NOT_CAPTURED;
}
