// #42 AC1 live, the issue's Proof: a real `claude -p` session with its OTLP export turned on and pointed at the
// receiver produces tool and cost events in the record. It spends plan usage, so it runs only with
// DEEP_OTLP_LIVE=1 and is skipped (never passed) otherwise.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { startReceiver } from '../../../packages/otlp/src/index.ts';
import type { Receiver } from '../../../packages/otlp/src/index.ts';
import type { Event, RecordStore } from '../../../packages/record/src/index.ts';
import { allEvents, dataOf, OTLP, openTempRecord, removeRoots, tempRoot } from './helpers.ts';

const LIVE = process.env.DEEP_OTLP_LIVE === '1';
const open: Array<Receiver | RecordStore> = [];
afterEach(async () => { for (const o of open.splice(0).reverse()) await o.close(); removeRoots(); });

describe('AC1 live: a Claude Code session exporting to the receiver', () => {
  it('AC1 live: claude -p with telemetry on runs Bash once; the record holds its tool.span and a request.cost for that session', async (ctx) => {
    if (!LIVE) ctx.skip('INCONCLUSIVE: the live session spends plan usage; set DEEP_OTLP_LIVE=1 to run it');
    const record = await openTempRecord();
    open.push(record);
    const receiver = await startReceiver({ record, connection: OTLP, port: 0 });
    open.push(receiver);
    const env = {
      ...process.env, CLAUDE_CODE_ENABLE_TELEMETRY: '1', CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: '1',
      OTEL_TRACES_EXPORTER: 'otlp', OTEL_LOGS_EXPORTER: 'otlp', OTEL_METRICS_EXPORTER: 'none',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/protobuf', OTEL_EXPORTER_OTLP_ENDPOINT: receiver.url,
      OTEL_TRACES_EXPORT_INTERVAL: '1000', OTEL_LOGS_EXPORT_INTERVAL: '1000',
    };
    // Async, so the receiver in this process keeps serving while the session runs.
    const { stdout } = await promisify(execFile)('claude', ['-p', 'Run the shell command `echo deep-otlp-live` with the Bash tool, then reply with its output only.',
      '--model', 'haiku', '--output-format', 'json', '--allowedTools', 'Bash(echo deep-otlp-live)'], { cwd: tempRoot(), env, encoding: 'utf8', timeout: 240_000, maxBuffer: 16 * 1024 * 1024 });
    const session = (JSON.parse(stdout) as { session_id: string }).session_id;
    let events: Event[] = [];
    for (let waited = 0; waited < 15_000; waited += 500) {
      events = (await allEvents(record)).filter((e) => e.session === session);
      if (events.some((e) => e.kind === 'tool.span') && events.some((e) => e.kind === 'request.cost')) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const kinds = events.map((e) => e.kind);
    expect(events.filter((e) => e.kind === 'tool.span' && dataOf(e).tool === 'Bash'), `a Bash tool.span for session ${session}; kinds seen: ${kinds.join(', ')}`).toHaveLength(1);
    const costs = events.filter((e) => e.kind === 'request.cost');
    expect(costs.length, 'at least one request.cost').toBeGreaterThan(0);
    for (const c of costs) expect(dataOf(c).cost).toMatchObject({ basis: 'reported', usd: expect.any(Number) });
  }, 300_000);
});
