// The MCP server the corpus recorder gives a Claude Code session to record an elicitation dialog (#992): one tool,
// ask_name, which asks the person for a name through elicitation/create and returns what came back. Stdio,
// newline-delimited JSON-RPC, no dependencies.
import { createInterface } from 'node:readline';

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const calls = new Map();

createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'corpus', version: '1.0.0' } } });
  else if (message.method === 'tools/list') send({ id: message.id, result: { tools: [{ name: 'ask_name', description: 'Asks the person for a name and returns it.', inputSchema: { type: 'object', properties: {} } }] } });
  else if (message.method === 'tools/call') {
    const asked = `elicit-${message.id}`;
    calls.set(asked, message.id);
    send({ id: asked, method: 'elicitation/create', params: { message: 'What name should the corpus use?', requestedSchema: { type: 'object', properties: { name: { type: 'string', title: 'Name' } }, required: ['name'] } } });
  } else if (message.method === 'ping') send({ id: message.id, result: {} });
  else if (calls.has(message.id)) {
    const call = calls.get(message.id);
    calls.delete(message.id);
    const result = message.result ?? {};
    send({ id: call, result: { content: [{ type: 'text', text: result.action === 'accept' ? String(result.content?.name ?? '') : `the person chose ${result.action ?? 'nothing'}` }] } });
  } else if (message.id !== undefined && message.method) send({ id: message.id, error: { code: -32601, message: `no method ${message.method}` } });
});
