// A stand-in for an agent's process, adapted from tests/acceptance/331/fixtures/agent.mjs (same repo, same
// license): a Claude Code session whose hooks are its child processes sending one hook.request line each over the
// hub's socket (deep-hook's wire, with `pid` and `ppid` their own), and whose shell commands (`deep env up` run
// through its Bash tool) are its children too, so the hub sees what it would see from a real agent. It decides
// nothing; it carries lines.
//   node agent.mjs                               the agent: one JSON command per stdin line, one JSON answer per stdout line, by `n`
//   node agent.mjs hook <socket> <request JSON>  a hook client (deep-hook's wire): sends the request with its own pid and this agent's, prints the hub's lines
import { spawn } from 'node:child_process';
import net from 'node:net';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const NODE = process.execPath;

if (process.argv[2] === 'hook') {
  const [, , , socket, json] = process.argv;
  const request = { ...JSON.parse(json), pid: process.pid, ppid: process.ppid };
  const lines = [];
  const sock = net.connect(socket);
  let buffer = '';
  let finished = false;
  const done = (end) => {
    if (finished) return;
    finished = true;
    process.stdout.write(`${JSON.stringify({ lines, end, pid: process.pid, ppid: process.ppid })}\n`, () => process.exit(0));
    sock.destroy();
  };
  setTimeout(() => done('timeout'), 10_000);
  sock.on('error', (error) => done(`error:${error.code}`));
  sock.on('close', () => done('close'));
  sock.setEncoding('utf8').on('data', (chunk) => {
    buffer += chunk;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      lines.push(line);
      if (lines.length === 1) sock.write(`${JSON.stringify(request)}\n`);
      else if (/"(exit|error)"/.test(line)) done('reply');
    }
  });
} else {
  const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
  const collect = (child) => new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr, pid: child.pid }));
  });
  createInterface({ input: process.stdin }).on('line', (line) => {
    const command = JSON.parse(line);
    handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
  });
  async function handle(command) {
    switch (command.op) {
      case 'hook': {
        // A hook as the agent runs it: a direct child of this process, as deep-hook is when the agent starts it.
        const r = await collect(spawn(NODE, [SELF, 'hook', command.socket, JSON.stringify(command.request)], { cwd: command.cwd, stdio: ['ignore', 'pipe', 'pipe'] }));
        try { return JSON.parse(r.stdout); } catch { return { lines: [], end: `client exited ${r.code}: ${r.stderr}` }; }
      }
      case 'exec':
        // A shell command the agent's Bash tool runs: a direct child of this process, in `cwd`, with its environment.
        return collect(spawn(command.argv[0], command.argv.slice(1), { cwd: command.cwd, stdio: ['ignore', 'pipe', 'pipe'] }));
      case 'exit':
        setTimeout(() => process.exit(0), 20);
        return {};
      default:
        throw Error(`unknown op ${command.op}`);
    }
  }
}
