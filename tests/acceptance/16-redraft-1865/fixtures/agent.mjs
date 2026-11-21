// A stand-in for an agent process: a Claude Code session, or Codex's shared daemon serving several. Its
// children carry its hooks (fixtures/client.mjs hook) and its deep mcp (fixtures/client.mjs mcp), so the hub
// sees what it would see from a real agent: hooks whose parent is this process, an MCP server whose parent
// is this process, and, for a hook "run by hand", a hook whose parent is a shell this process started.
// The test drives it over stdin with one JSON command per line and reads one JSON answer per line, by `n`.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const CLIENT = fileURLToPath(new URL('./client.mjs', import.meta.url));
const NODE = process.execPath;
let mcp;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
});

async function handle(command) {
  switch (command.op) {
    case 'hook': return hook(command);
    case 'mcp-open': return mcpOpen(command);
    case 'mcp': return mcpCall(command);
    case 'mcp-raw': return { lines: mcp ? [...mcp.lines] : [] };
    case 'exit':
      mcp?.child.kill();
      setTimeout(() => process.exit(0), 20);
      return {};
    default: throw Error(`unknown op ${command.op}`);
  }
}

function collect(child) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('close', (code) => (code === 0 ? resolve(stdout) : reject(Error(`client exited ${code}: ${stderr}`))));
  });
}

async function hook({ address, request, via, cwd }) {
  const args = [CLIENT, 'hook', address, JSON.stringify(request)];
  // `; true` keeps the shell from exec'ing the client, so the client's parent is the shell, not this agent.
  const child = via === 'shell'
    ? spawn('/bin/sh', ['-c', '"$0" "$@"; true', NODE, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(NODE, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(await collect(child));
}

function mcpOpen({ address, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(NODE, [CLIENT, 'mcp', address], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    mcp = { child, lines: [], wakers: new Set() };
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    createInterface({ input: child.stdout }).on('line', (line) => {
      mcp.lines.push(line);
      for (const wake of [...mcp.wakers]) wake();
    });
    child.on('close', (code) => {
      for (const wake of [...mcp.wakers]) wake();
      if (mcp.lines.length < 2) reject(Error(`mcp client exited ${code} after ${mcp.lines.length} lines: ${stderr}`));
    });
    const check = () => {
      if (mcp.lines.length >= 2) {
        mcp.wakers.delete(check);
        resolve({ lines: mcp.lines.slice(0, 2) });
      }
    };
    mcp.wakers.add(check);
    check();
  });
}

function mcpCall({ line, timeoutMs = 15_000 }) {
  if (!mcp) return Promise.reject(Error('no deep mcp open'));
  return new Promise((resolve, reject) => {
    const from = mcp.lines.length;
    const timer = setTimeout(() => { finish(); reject(Error(`no reply to ${line.id} in ${timeoutMs} ms`)); }, timeoutMs);
    const finish = () => { clearTimeout(timer); mcp.wakers.delete(check); };
    const check = () => {
      for (let i = from; i < mcp.lines.length; i++) {
        let json;
        try { json = JSON.parse(mcp.lines[i]); } catch { continue; }
        if (json.id === line.id && ('result' in json || 'error' in json)) { finish(); resolve({ line: json }); return; }
      }
      if (mcp.child.exitCode !== null) { finish(); reject(Error('the deep mcp connection closed')); }
    };
    mcp.wakers.add(check);
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    check();
  });
}
