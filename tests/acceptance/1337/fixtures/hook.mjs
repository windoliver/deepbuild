// A protocol-level stand-in for deep-hook, run as a child of fixtures/agent.mjs so the hub sees a real process tree
// (its pid, its parent). Copied from tests/acceptance/16/fixtures/client.mjs (hook mode), with one change: given a
// person's credential, it first says hello as that person's hook connection, `{v:1, hello:'hook', token}` (README,
// The surface under test, 3), then sends the request. It decides nothing; it carries lines.
//   node hook.mjs <socket> <request JSON> [<credential>]   prints {pid, ppid, lines, end} once the reply or a refusal is in
import net from 'node:net';

const [address, arg, token] = process.argv.slice(2);
const path = address.startsWith('unix:') ? address.slice(5) : address;
const parse = (line) => { try { return JSON.parse(line); } catch { return undefined; } };

const request = JSON.parse(arg);
request.pid ??= process.pid;
request.ppid ??= process.ppid;
const lines = [];
const sock = net.connect(path);
let finished = false;
const done = (end) => {
  if (finished) return;
  finished = true;
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ppid: process.ppid, lines, end })}\n`, () => process.exit(0));
  sock.destroy();
};
setTimeout(() => done('timeout'), 10_000);
sock.on('error', (error) => done(`error:${error.code}`));
sock.on('close', () => done('close'));
let buffer = '';
sock.setEncoding('utf8');
sock.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    lines.push(line);
    if (lines.length === 1) {
      // The hub's own hello is in: the person's hello (when there is one) and the request, back to back.
      if (token) sock.write(`${JSON.stringify({ v: 1, hello: 'hook', token })}\n`);
      sock.write(`${JSON.stringify(request)}\n`);
      continue;
    }
    const json = parse(line);
    if (json && ('exit' in json || 'error' in json)) done('reply');
  }
});
