// #42 AC1 (fixture), AC2, AC4 and AC5: a real receiver on a real socket, appending to a real record.
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { costOf, startReceiver } from '../../../packages/otlp/src/index.ts';
import type { Receiver } from '../../../packages/otlp/src/index.ts';
import type { RecordStore, Row } from '../../../packages/record/src/index.ts';
import {
  allEvents, app, claimMade, claudePrompt, CONTENT_TYPE, costLog, dataOf, exportTo, hex, hook, KNOWN_MODEL, KNOWN_TOOL, logRecord, logs, OTLP,
  openTempRecord, removeRoots, sessionStart, span, taskCreated, traces, type Encoding,
} from './helpers.ts';

const open: Array<Receiver | RecordStore> = [];
afterEach(async () => { for (const o of open.splice(0).reverse()) await o.close(); removeRoots(); });
async function setUp(): Promise<{ record: RecordStore; receiver: Receiver }> {
  const record = await openTempRecord();
  open.push(record);
  const receiver = await startReceiver({ record, connection: OTLP, port: 0 });
  open.push(receiver);
  return { record, receiver };
}
async function accepted(response: Response, encoding: Encoding): Promise<void> {
  expect(response.status, `the export is accepted: ${await response.clone().text()}`).toBe(200);
  expect(response.headers.get('content-type') ?? '', 'the response uses the request\'s content type').toContain(CONTENT_TYPE[encoding]);
}

describe('AC1 a Claude Code session exporting to the receiver produces tool and cost events', () => {
  it.each<Encoding>(['protobuf', 'json'])('AC1 one prompt exported as OTLP/HTTP %s: a tool.span with the time blocked on you, a request.cost with the reported cost', async (encoding) => {
    const { record, receiver } = await setUp();
    const S = crypto.randomUUID();
    const prompt = claudePrompt(S);
    await accepted(await exportTo(receiver.url, prompt.traces, encoding), encoding);
    await accepted(await exportTo(receiver.url, prompt.logs, encoding), encoding);
    const events = await allEvents(record);
    const tools = events.filter((e) => e.kind === 'tool.span' && dataOf(e).tool_use_id === prompt.toolUseId);
    expect(tools, 'one tool.span for the Bash call').toHaveLength(1);
    expect(tools[0]!.data).toMatchObject({ tool: KNOWN_TOOL, duration_ms: 1700, blocked_ms: 1500, decision: 'accept' });
    const costs = events.filter((e) => e.kind === 'request.cost' && dataOf(e).request_id === prompt.requestId);
    expect(costs, 'one request.cost for the model request, though its span and its log both describe it').toHaveLength(1);
    expect(costs[0]!.data).toMatchObject({ model: KNOWN_MODEL, cost: { basis: 'reported', usd: 0.0123 }, tokens: { input: 1200, cached: 3000, output: 80, exact: true } });
    for (const e of [...tools, ...costs]) expect({ writer: e.writer, session: e.session, agent: e.agent }).toEqual({ writer: 'ext:otlp', session: S, agent: 'claude-code' });
  });
});

describe('AC2 the receiver refuses non-local connections', () => {
  const addresses = Object.values(networkInterfaces()).flat().filter((i): i is NonNullable<typeof i> => i !== undefined && !i.internal);
  const external = addresses.find((i) => i.family === 'IPv4') ?? addresses.find((i) => !i.address.startsWith('fe80'));
  it('AC2 binds only 127.0.0.1, and an export sent to this machine\'s own network address is refused and appends nothing', async (ctx) => {
    if (!external) ctx.skip('INCONCLUSIVE: this machine has no non-loopback interface address to connect from');
    const { record, receiver } = await setUp();
    expect(receiver.host).toBe('127.0.0.1');
    const listening = execFileSync('lsof', ['-nP', '-a', '-p', String(process.pid), `-iTCP:${receiver.port}`, '-sTCP:LISTEN', '-Fn'], { encoding: 'utf8' })
      .split('\n').filter((l) => l.startsWith('n')).map((l) => l.slice(1));
    expect(listening, 'every listening socket on the receiver\'s port is 127.0.0.1').toEqual(listening.map(() => `127.0.0.1:${receiver.port}`));
    expect(listening.length).toBeGreaterThan(0);
    const host = external!.family === 'IPv4' ? external!.address : `[${external!.address}]`;
    const prompt = claudePrompt(crypto.randomUUID());
    const outcome = await exportTo(`http://${host}:${receiver.port}`, prompt.traces, 'json').then((r) => `HTTP ${r.status}`, (e: Error) => `refused: ${String((e.cause as Error | undefined)?.message ?? e.message)}`);
    expect(outcome, `an export to ${host} is refused`).toMatch(/^refused/);
    expect(await allEvents(record), 'nothing was appended from the network address').toEqual([]);
    await accepted(await exportTo(receiver.url, prompt.traces, 'json'), 'json');   // and the receiver itself works on 127.0.0.1
  });
});

describe('AC4 model and tool names the facts don\'t list fold to other before they become readings', () => {
  const S4 = crypto.randomUUID();
  // One model request as Claude Code exports it: its claude_code.llm_request span and its api_request log (the
  // README's source of a request's cost), sharing a request_id, both naming `model`.
  const request = (model: string) => {
    const traceId = hex(16), requestId = `req_${hex(12)}`, at = Date.now() - 1000;
    const usage = { model, duration_ms: 1000, input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_creation_tokens: 0, request_id: requestId };
    return {
      traceId,
      span: span({ name: 'claude_code.llm_request', traceId, start: at - 1000, end: at, attributes: { 'session.id': S4, ...usage, success: true } }),
      log: logRecord('api_request', at, { 'session.id': S4, 'prompt.id': crypto.randomUUID(), ...usage, cost_usd: { double: 0.0007 } }),
    };
  };
  // Rows as `table()` returns them: INTEGER columns come back as BigInt, which JSON.stringify can't take.
  const text = (r: Row) => JSON.stringify(r, (_key, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  const keys = (rows: Row[]) => new Set(rows.map((r) => String(r.reading)));
  it('AC4 an unlisted model and tool add readings only under other; 1,000 more made-up model names add no reading', async () => {
    const { record, receiver } = await setUp();
    const known = claudePrompt(S4);
    await accepted(await exportTo(receiver.url, known.traces, 'protobuf'), 'protobuf');
    await accepted(await exportTo(receiver.url, known.logs, 'protobuf'), 'protobuf');
    const before = keys((await record.table('readings')).rows);
    const unlisted = request('made-up-model-0000');
    const toolUseId = `toolu_${hex(12)}`;
    const unlistedTool = span({ name: 'claude_code.tool', traceId: unlisted.traceId, start: Date.now() - 900, end: Date.now() - 800, attributes: { 'session.id': S4, tool_name: 'MadeUpTool', tool_use_id: toolUseId, duration_ms: 100 } });
    const toolResult = logRecord('tool_result', Date.now() - 800, { 'session.id': S4, 'prompt.id': crypto.randomUUID(), tool_name: 'MadeUpTool', tool_use_id: toolUseId, success: 'true', duration_ms: 100 });
    await accepted(await exportTo(receiver.url, traces([unlisted.span, unlistedTool]), 'protobuf'), 'protobuf');
    await accepted(await exportTo(receiver.url, logs([unlisted.log, toolResult]), 'protobuf'), 'protobuf');
    const first = (await record.table('readings')).rows;
    const added = [...keys(first)].filter((k) => !before.has(k));
    for (const k of added) expect(k, 'a reading the unlisted names added is under other').toMatch(/other/i);
    expect(first.some((r) => /other/i.test(text(r))), 'the unlisted names are read under other').toBe(true);
    for (let batch = 0; batch < 10; batch++) {
      const encoding: Encoding = batch % 2 ? 'json' : 'protobuf';
      const requests = Array.from({ length: 100 }, (_, i) => request(`made-up-model-${String(batch * 100 + i + 1).padStart(4, '0')}`));
      await accepted(await exportTo(receiver.url, traces(requests.map((q) => q.span)), encoding), encoding);
      await accepted(await exportTo(receiver.url, logs(requests.map((q) => q.log)), encoding), encoding);
    }
    const after = (await record.table('readings')).rows;
    // A receiver keying readings by the raw name, from the spans or from the cost logs, has about 1,000 more distinct readings here.
    expect(keys(after).size, 'distinct readings after 1,000 more made-up model names').toBe(keys(first).size);
    expect(after.filter((r) => /made-up|MadeUpTool/.test(text(r))).map(text), 'no reading names a raw unlisted name').toEqual([]);
  });
});

describe('AC5 telemetry on but never arriving reads "not captured", never $0', () => {
  it('AC5 a session whose exports never arrive reads its request cost "not captured" on its row and its task; one whose exports arrived reads their sum', async () => {
    const { record, receiver } = await setUp();
    const [A, B] = [crypto.randomUUID(), crypto.randomUUID()];
    const [TA, TB] = ['task:01K74FX2B4D6F8H0K2M4P6R8TA', 'task:01K74FX2B4D6F8H0K2M4P6R8TB'];
    for (const [S, T] of [[A, TA], [B, TB]] as const) {
      await record.append(app(), taskCreated(T));
      await record.append(hook(S), sessionStart());
      await record.append(app(S), claimMade(T));
    }
    await accepted(await exportTo(receiver.url, costLog(B, '0.0123'), 'json'), 'json');
    await accepted(await exportTo(receiver.url, costLog(B, '0.0045'), 'protobuf'), 'protobuf');
    for (const of of [{ session: A }, { task: TA }]) {
      const cost = await costOf(record, of);
      expect(cost, `${JSON.stringify(of)} reads not captured`).toEqual({ captured: false, text: 'not captured' });
    }
    for (const of of [{ session: B }, { task: TB }]) {
      const cost = await costOf(record, of);
      expect(cost.captured, `${JSON.stringify(of)} has its cost`).toBe(true);
      if (cost.captured) expect(cost.usd).toBeCloseTo(0.0168, 10);
    }
  });
});
