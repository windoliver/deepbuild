// A stand-in for a Claude Code process, adapted from tests/acceptance/26/fixtures/agent.mjs (same repo, same
// license). It decides nothing; it carries lines. Its hooks are the real deep-hook binary, run as its direct
// children (`deep-hook claude-code <event>`, the hook JSON on stdin), as Claude Code runs a hook command, and its one
// `deep mcp` is its child too, as Claude Code starts an MCP server. So the hub sees a true process tree: hooks and an
// MCP server with the same parent, this process.
//   node agent.mjs   one JSON command per stdin line, one JSON answer per stdout line, matched by `n`
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
      return hook(command.binary, command.event, command.payload, command.cwd);
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

/** deep-hook as Claude Code runs a hook entry: a direct child of this process, the payload on stdin, waited for. */
function hook(binary, event, payload, cwd) {
  return new Promise((resolve) => {
    const child = spawn(binary, ['claude-code', event], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${String(error)}` }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(payload));
  });
}

/** This agent's own `deep mcp`, started once; one JSON-RPC line, one reply by id. */
function mcpCall(argv, line, timeoutMs) {
  if (!mcp) {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
    mcp = { child, lines: [], wakers: new Set(), stderr: '' };
    child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
    createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push(l); for (const w of [...mcp.wakers]) w(); });
    child.on('close', () => { for (const w of [...mcp.wakers]) w(); });
  }
  if (line.id === undefined) {
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    return Promise.resolve({ reply: null, pid: mcp.child.pid });
  }
  return new Promise((resolve, reject) => {
    const from = mcp.lines.length;
    const finish = () => { clearTimeout(timer); mcp.wakers.delete(check); };
    const timer = setTimeout(() => { finish(); reject(Error(`deep mcp gave no reply to ${line.id} in ${timeoutMs} ms`)); }, timeoutMs);
    const check = () => {
      for (let i = from; i < mcp.lines.length; i++) {
        let json;
        try { json = JSON.parse(mcp.lines[i]); } catch { continue; }
        if (json.id === line.id && ('result' in json || 'error' in json)) { finish(); resolve({ reply: json, pid: mcp.child.pid }); return; }
      }
      if (mcp.child.exitCode !== null) { finish(); reject(Error(`deep mcp exited ${mcp.child.exitCode}: ${mcp.stderr}`)); }
    };
    mcp.wakers.add(check);
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    check();
  });
}
