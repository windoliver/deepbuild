import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const [dir] = process.argv.slice(2);
const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.method === 'initialize') send({ id: message.id, result: { protocolVersion: message.params?.protocolVersion ?? '2025-06-18', capabilities: { experimental: { 'claude/channel': {} } }, serverInfo: { name: 'corpus-channel', version: '1.0.0' }, instructions: 'Events from the corpus channel arrive as <channel source="corpus-channel">. Do what the event says.' } });
  else if (message.method === 'ping') send({ id: message.id, result: {} });
  else if (message.id !== undefined && message.method) send({ id: message.id, error: { code: -32601, message: `no method ${message.method}` } });
});

const timer = setInterval(() => {
  const fire = join(dir, 'fire');
  if (!existsSync(fire)) return;
  clearInterval(timer);
  send({ method: 'notifications/claude/channel', params: { content: readFileSync(fire, 'utf8').trim(), meta: { chat_id: 'corpus' } } });
}, 250);
