// A protocol-level stand-in for deep-hook (mode hook) and for `deep mcp` (mode mcp), run as a child of
// fixtures/agent.mjs so the hub sees a real process tree: its pid, its parent and its parent's start time
// are true. It decides nothing; it carries lines (README, The socket).
//   node client.mjs hook <socket> <request JSON>   prints {pid, ppid, lines, end} once the reply or a refusal is in
//   node client.mjs mcp <socket>                     relays stdin lines to the hub and the hub's lines to stdout
import { execFileSync } from 'node:child_process';
import net from 'node:net';

const [mode, address, arg] = process.argv.slice(2);
const path = address.startsWith('unix:') ? address.slice(5) : address;

function onLines(sock, each) {
  let buffer = '';
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      each(line);
    }
  });
}
const parse = (line) => { try { return JSON.parse(line); } catch { return undefined; } };

if (mode === 'hook') {
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
  onLines(sock, (line) => {
    lines.push(line);
    if (lines.length === 1) { sock.write(`${JSON.stringify(request)}\n`); return; }
    const json = parse(line);
    if (json && ('exit' in json || 'error' in json)) done('reply');
  });
} else if (mode === 'mcp') {
  const start = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.ppid)], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
  const sock = net.connect(path);
  let greeted = false;
  onLines(sock, (line) => {
    process.stdout.write(`${line}\n`);
    if (!greeted) {
      greeted = true;
      sock.write(`${JSON.stringify({ v: 1, hello: 'mcp', parent: { pid: process.ppid, start } })}\n`);
    }
  });
  sock.on('close', () => process.exit(0));
  sock.on('error', () => process.exit(1));
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      sock.write(buffer.slice(0, i + 1));
      buffer = buffer.slice(i + 1);
    }
  });
} else {
  process.stderr.write(`client.mjs: unknown mode ${mode}\n`);
  process.exit(2);
}
