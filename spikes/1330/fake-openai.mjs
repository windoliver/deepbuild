// A fake OpenAI Responses endpoint: one scripted shell call per request that carries N function outputs.
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';
const script = JSON.parse(process.env.FAKE_SCRIPT ?? '[]'); // [command string]
const log = process.env.FAKE_LOG;
createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    let j = {}; try { j = JSON.parse(body || '{}'); } catch {}
    const tools = (j.tools ?? []).map((t) => t.name ?? t.type);
    if (log) appendFileSync(log, `${req.method} ${req.url} tools=${tools.join(',')}\n`);
    if (!req.url.includes('/responses')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[]}'); return; }
    const n = (j.input ?? []).filter((i) => i.type === 'function_call_output' || i.type === 'custom_tool_call_output').length;
    const cmd = script[n];
    const tool = ['shell_command', 'shell', 'exec_command'].find((t) => tools.includes(t));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (d) => res.write(`event: ${d.type}\ndata: ${JSON.stringify(d)}\n\n`);
    ev({ type: 'response.created', response: { id: `resp_${n}` } });
    let item;
    if (cmd !== undefined && tool) {
      const args = tool === 'shell' ? { command: ['bash', '-lc', cmd.command ?? cmd], ...(cmd.escalate ? { with_escalated_permissions: true, justification: 'x' } : {}) }
        : tool === 'exec_command' ? { cmd: cmd.command ?? cmd, ...(cmd.escalate ? { sandbox_permissions: 'require_escalated', justification: 'x' } : {}) }
        : { command: cmd.command ?? cmd, ...(cmd.escalate ? { sandbox_permissions: 'require_escalated', justification: 'x' } : {}) };
      item = { type: 'function_call', id: `fc_${n}`, name: tool, arguments: JSON.stringify(args), call_id: `call_${n}` };
    } else item = { type: 'message', id: `m_${n}`, role: 'assistant', content: [{ type: 'output_text', text: 'done', annotations: [] }] };
    ev({ type: 'response.output_item.added', output_index: 0, item });
    ev({ type: 'response.output_item.done', output_index: 0, item });
    ev({ type: 'response.completed', response: { id: `resp_${n}`, usage: { input_tokens: 10, input_tokens_details: { cached_tokens: 0 }, output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 15 } } });
    res.end();
  });
}).listen(0, '127.0.0.1', function () { console.log(this.address().port); });
