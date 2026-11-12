// A stand-in for one agent session's process, as a person runs it: its children carry its hooks (#1337's
// fixtures/hook.mjs, which first says hello with the person's credential when given one) and run its one real
// `deep mcp`, so the hub sees hooks and an MCP server whose parent is this process, as it would from Claude Code.
// It decides nothing; it carries lines. Driven over stdin, one JSON command per line, one JSON answer per line, by `n`:
//   {n, op: 'hook', address, request, token?, cwd}   a hook from a child of this process; answers hook.mjs's {pid, ppid, lines, end}
//   {n, op: 'mcp', argv, line, timeoutMs?}            one JSON-RPC line to this process's deep mcp (started on first use); {reply, ms, pid}
//   {n, op: 'exit'}
// The deep mcp half follows tests/acceptance/26/fixtures/agent.mjs.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../../1337/fixtures/hook.mjs', import.meta.url));
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
let mcp;

createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
});

async function handle(command) {
  switch (command.op) {
    case 'hook': {
      const args = [HOOK, command.address, JSON.stringify(command.request), ...(command.token ? [command.token] : [])];
      const child = spawn(process.execPath, args, { cwd: command.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      return new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
        child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
        child.on('close', (code) => (code === 0 ? resolve(JSON.parse(stdout)) : reject(Error(`hook.mjs exited ${code}: ${stderr}`))));
      });
    }
    case 'mcp':
      return mcpCall(command.argv, command.line, command.timeoutMs ?? 120_000);
    case 'exit':
      mcp?.child.kill();
      setTimeout(() => process.exit(0), 20);
      return {};
    default:
      throw Error(`unknown op ${command.op}`);
  }
}

// This process's own `deep mcp`, started once, as an agent starts its MCP server; one JSON-RPC line, one reply by id.
function mcpCall(argv, line, timeoutMs) {
  if (!mcp) {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    mcp = { child, lines: [], wakers: new Set(), stderr: '' };
    child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
    createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push(l); for (const w of [...mcp.wakers]) w(); });
    child.on('close', () => { for (const w of [...mcp.wakers]) w(); });
  }
  // A notification gets no reply.
  if (line.id === undefined) {
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    return Promise.resolve({ reply: null, ms: 0, pid: mcp.child.pid });
  }
  return new Promise((resolve, reject) => {
    const from = mcp.lines.length;
    const t0 = performance.now();
    const finish = () => { clearTimeout(timer); mcp.wakers.delete(check); };
    const timer = setTimeout(() => { finish(); reject(Error(`deep mcp gave no reply to ${line.id} in ${timeoutMs} ms: ${mcp.stderr}`)); }, timeoutMs);
    const check = () => {
      for (let i = from; i < mcp.lines.length; i++) {
        let json;
        try { json = JSON.parse(mcp.lines[i]); } catch { continue; }
        if (json.id === line.id && ('result' in json || 'error' in json)) { finish(); resolve({ reply: json, ms: performance.now() - t0, pid: mcp.child.pid }); return; }
      }
      if (mcp.child.exitCode !== null) { finish(); reject(Error(`deep mcp exited ${mcp.child.exitCode}: ${mcp.stderr}`)); }
    };
    mcp.wakers.add(check);
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    check();
  });
}
