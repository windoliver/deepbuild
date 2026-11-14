// A stand-in for one Claude Code process (adapted from tests/acceptance/26/fixtures/agent.mjs). Its hooks are the
// real deep-hook, run as its direct children with the hook JSON on stdin, as Claude Code runs a hook command; its one
// `deep mcp` is its child too, started once and kept for the process's life, as Claude Code keeps its MCP servers
// across `/clear`. So the hub sees what it would see from a real Claude Code: hooks and an MCP server whose parent is
// this process, with this process's PID and start time across every session ID it runs. It decides nothing; it
// carries lines. One JSON command per stdin line, one JSON answer per stdout line, by `n`.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
let mcp;

createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
});

async function handle(command) {
  switch (command.op) {
    case 'hook':
      return hook(command.argv, command.input, command.cwd);
    case 'mcp':
      return mcpCall(command.argv, command.line, command.timeoutMs ?? 120_000);
    case 'mcp-pid':
      return { pid: mcp?.child.pid ?? null, alive: mcp ? mcp.child.exitCode === null : false };
    default:
      throw Error(`unknown op ${command.op}`);
  }
}

// deep-hook as a hook entry runs it: `deep-hook claude-code <event>` in the session's folder, its JSON on stdin.
function hook(argv, input, cwd) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${error}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

// This process's own `deep mcp`, started once; one JSON-RPC line, one reply by id. `ms` is from the line written to
// the reply read, both in this process.
function mcpCall(argv, line, timeoutMs) {
  if (!mcp) {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    mcp = { child, lines: [], wakers: new Set(), stderr: '' };
    child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
    createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push({ raw: l, at: performance.now() }); for (const w of [...mcp.wakers]) w(); });
    child.on('close', () => { for (const w of [...mcp.wakers]) w(); });
  }
  if (line.id === undefined) {
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    return Promise.resolve({ reply: null, ms: 0, pid: mcp.child.pid });
  }
  return new Promise((resolve, reject) => {
    const from = mcp.lines.length;
    let t0 = performance.now();
    const finish = () => { clearTimeout(timer); mcp.wakers.delete(check); };
    const timer = setTimeout(() => { finish(); reject(Error(`deep mcp gave no reply to ${line.id} in ${timeoutMs} ms`)); }, timeoutMs);
    const check = () => {
      for (let i = from; i < mcp.lines.length; i++) {
        let json;
        try { json = JSON.parse(mcp.lines[i].raw); } catch { continue; }
        if (json.id === line.id && ('result' in json || 'error' in json)) { finish(); resolve({ reply: json, ms: mcp.lines[i].at - t0, pid: mcp.child.pid }); return; }
      }
      if (mcp.child.exitCode !== null) { finish(); reject(Error(`deep mcp exited ${mcp.child.exitCode}: ${mcp.stderr}`)); }
    };
    mcp.wakers.add(check);
    t0 = performance.now();
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    check();
  });
}

// Its children go with it: when the test stops this process by PID, its deep mcp's stdin closes and it exits.
process.on('SIGTERM', () => { mcp?.child.kill(); process.exit(0); });
