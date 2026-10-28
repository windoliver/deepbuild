// The reading tools a reading job gets (#63): a stdio MCP server whose `read` and `find` reach the reading job's own
// socket, the one place in the job's sandbox that reads the record. It imports only Node's own modules, so the job
// is granted Node and this file and nothing of the record, its evidence or its folders.
// Usage: node tools.mjs <socket>. An .mjs file, so Node needs no package.json to read it as a module.
import { request } from 'node:http';
import { createInterface } from 'node:readline';

const socket = process.argv[2] ?? '';
const TOOLS = [
  {
    name: 'read',
    description: 'One slice of what a handle names (session:<id>, session:<id>#<message>, ev:<sha256>, wiki:<page>#<claim>), at most 8,192 characters, as reading.slice@1 JSON. When the reply has `next`, call again with `slice` set to it for the rest.',
    inputSchema: { type: 'object', properties: { handle: { type: 'string' }, slice: { type: 'string' } }, required: ['handle'], additionalProperties: false },
  },
  {
    name: 'find',
    description: 'Message handles of the sessions this job was given whose text holds the query, ignoring case, with a line of context each; `next` continues a cut reply.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, slice: { type: 'string' } }, required: ['query'], additionalProperties: false },
  },
];

/** One call on the job's socket: the reply's text, or an error's. */
function call(name: string, args: unknown): Promise<{ text: string; error: boolean }> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ name, arguments: args });
    const req = request({ socketPath: socket, path: '/call', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => { text += chunk; });
      res.on('end', () => resolve({ text, error: res.statusCode !== 200 }));
    });
    req.on('error', (error) => resolve({ text: `the reading job's socket can't be reached: ${error.message}`, error: true }));
    req.end(body);
  });
}

const send = (message: unknown): void => { process.stdout.write(`${JSON.stringify(message)}\n`); };
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let m: { id?: number | string; method?: string; params?: { protocolVersion?: string; name?: string; arguments?: unknown } };
  try { m = JSON.parse(line) as typeof m; } catch { return; }
  if (m.id === undefined) return; // a notification
  const reply = (result: unknown) => send({ jsonrpc: '2.0', id: m.id, result });
  if (m.method === 'initialize') reply({ protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'deepbuild-reading', version: '1' } });
  else if (m.method === 'ping') reply({});
  else if (m.method === 'tools/list') reply({ tools: TOOLS });
  else if (m.method === 'tools/call') {
    void call(String(m.params?.name), m.params?.arguments ?? {}).then(({ text, error }) => reply({ content: [{ type: 'text', text }], ...(error ? { isError: true } : {}) }));
  } else send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `no method ${String(m.method)}` } });
});
