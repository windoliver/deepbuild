// One OTLP receiver workload per run, for the perf lane's budgets (issue #42): node benchmarks/otlp.mjs <task>.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startReceiver } from '../packages/otlp/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';

const T0 = 1_760_013_451_000;

// ---- OTLP protobuf, encoded by opentelemetry-proto's field numbers ---------------------------------------------
const varint = (n) => { const out = []; let v = BigInt(n); do { let b = Number(v & 0x7fn); v >>= 7n; if (v) b |= 0x80; out.push(b); } while (v); return out; };
const tag = (field, wire) => varint((field << 3) | wire);
const delimited = (field, bytes) => [...tag(field, 2), ...varint(bytes.length), ...bytes];
const text = (field, s) => delimited(field, [...Buffer.from(s, 'utf8')]);
const hexId = (field, n, bytes) => delimited(field, [...Buffer.from(n.toString(16).padStart(bytes * 2, '0'), 'hex')]);
const fixed64 = (field, ms) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(ms) * 1_000_000n); return [...tag(field, 1), ...b]; };
const attr = (key, value) => delimited(9, [...text(1, key), ...delimited(2, typeof value === 'string' ? text(1, value) : [...tag(3, 0), ...varint(value)])]);
let ids = 0;
/** One Claude Code prompt's five spans: the interaction, a model request, and a Bash call with its wait and run. */
function prompt(session, at) {
  const trace = ++ids, root = ++ids, tool = ++ids;
  const span = (id, parent, name, start, end, attrs) => delimited(2, [
    ...hexId(1, trace, 16), ...hexId(2, id, 8), ...(parent ? hexId(4, parent, 8) : []), ...text(5, name), ...tag(6, 0), 1,
    ...fixed64(7, start), ...fixed64(8, end), ...Object.entries({ 'session.id': session, ...attrs }).flatMap(([k, v]) => attr(k, v)),
  ]);
  return [
    ...span(root, 0, 'claude_code.interaction', at, at + 6000, { 'interaction.sequence': 1 }),
    ...span(++ids, root, 'claude_code.llm_request', at + 100, at + 1300, { model: 'claude-haiku-5-5', input_tokens: 1200, output_tokens: 80, request_id: `req_${ids}` }),
    ...span(tool, root, 'claude_code.tool', at + 1300, at + 3000, { tool_name: 'Bash', tool_use_id: `toolu_${tool}`, duration_ms: 1700 }),
    ...span(++ids, tool, 'claude_code.tool.blocked_on_user', at + 1300, at + 2800, { duration_ms: 1500, decision: 'accept' }),
    ...span(++ids, tool, 'claude_code.tool.execution', at + 2800, at + 3000, { duration_ms: 200 }),
  ];
}
/** An ExportTraceServiceRequest of `prompts` prompts across 8 sessions. */
const request = (n, prompts) => Buffer.from(delimited(1, delimited(2, Array.from({ length: prompts }, (_, p) => prompt(`session-${p % 8}`, T0 + n * 100)).flat())));

const workloads = {
  // 20,000 spans, 200 to an export as the AC6 load sends them, each export awaited before the next.
  async 'receive-20k-spans'(receiver) {
    const bodies = Array.from({ length: 100 }, (_, n) => request(n, 40));
    for (const body of bodies) {
      const response = await fetch(`${receiver.url}/v1/traces`, { method: 'POST', headers: { 'content-type': 'application/x-protobuf' }, body });
      if (response.status !== 200) throw Error(`the receiver answered ${response.status}: ${await response.text()}`);
    }
  },
};

const task = process.argv[2];
if (!workloads[task]) throw Error(`Unknown task ${task}; one of: ${Object.keys(workloads).join(', ')}`);
const root = mkdtempSync(join(tmpdir(), 'deep-otlp-bench-'));
try {
  const record = await openRecord({ path: join(root, 'record.db'), now: () => T0 });
  const receiver = await startReceiver({ record, connection: { writer: 'ext:otlp', actor: 'you', scope: 'you' }, port: 0 });
  await workloads[task](receiver);
  await receiver.close();
  await record.close();
} finally {
  rmSync(root, { recursive: true, force: true });
}
