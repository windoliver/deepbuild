// A fake Anthropic Messages endpoint: plays a script of tool calls, one per request that carries N tool results.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
const script = JSON.parse(process.env.FAKE_SCRIPT ?? '[]'); // [{name, input}] then end
const log = process.env.FAKE_LOG;
const srv = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    let j = {}; try { j = JSON.parse(body || '{}'); } catch {}
    if (log) appendFileSync(log, `${req.method} ${req.url} tools=${(j.tools ?? []).length}\n`);
    if (!req.url.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ input_tokens: 10 })); return;
    }
    const n = (body.match(/"type":"tool_result"/g) ?? []).length;
    const step = (j.tools ?? []).length ? script[n] : undefined;
    const content = step ? [{ type: 'tool_use', id: `toolu_${n}`, name: step.name, input: step.input }] : [{ type: 'text', text: 'done' }];
    const stop = step ? 'tool_use' : 'end_turn';
    const message = { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: j.model ?? 'claude-haiku-4-5', content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
    if (!j.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`);
    ev('message_start', { message: { ...message, content: [], stop_reason: null } });
    if (step) {
      ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: `toolu_${n}`, name: step.name, input: {} } });
      ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(step.input) } });
    } else {
      ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'done' } });
    }
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } });
    ev('message_stop', {});
    res.end();
  });
});
srv.listen(Number(process.env.FAKE_PORT ?? 0), '127.0.0.1', () => console.log(srv.address().port));
