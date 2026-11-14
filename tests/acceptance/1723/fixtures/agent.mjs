#!/usr/bin/env node
// One session's Claude Code, as far as DeepBuild sees it: a long-lived process whose children are the session's
// deep-hook runs (its hooks), its one `deep mcp` (its MCP server) and the commands it runs through a shell (a `deep
// show`), as a real session's are Claude Code's children. So the hub binds the session, its deep mcp and its deep show
// to this process. It decides nothing about DeepBuild; it carries lines. After tests/acceptance/322/fixtures/agent.mjs
// (the hook runs) and tests/acceptance/806/fixtures/agent.mjs (the mcp and exec ops), same repo, same license; this
// suite keeps its own copy so a redraft of theirs never moves it.
//
//   node agent.mjs <deep-hook>      one JSON command per stdin line, JSON answers per stdout line, by `n`
//
// {n, op: 'hook', args, cwd, input, timeoutMs}: `<deep-hook> <args…>` in `cwd`, `input` on its stdin.
// {n, op: 'mcp', argv, line, timeoutMs}: one JSON-RPC line to this agent's `deep mcp`, started from `argv` on first use;
//   the reply is the line with the request's id (null for a notification).
// {n, op: 'exec', argv, cwd, env, timeoutMs}: `argv` through `/bin/sh -c`, the shell this process's child, as a tool runs.
// Each answers {n, pid} for every process it starts, then {n, done: {...}} or {n, failed}. On SIGTERM, or when stdin
// closes, it stops everything it started, then exits.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [, , DEEP_HOOK] = process.argv;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const running = new Set();
let mcp;

const started = (n, child) => {
  running.add(child);
  child.on('close', () => running.delete(child));
  if (child.pid) out({ n, pid: child.pid });
};
const collect = (child, timeoutMs) => new Promise((resolve) => {
  const t0 = performance.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs ?? 120_000);
  child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, stdout, stderr: stderr + error.message, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
  child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ms: performance.now() - t0, timedOut, ended: Date.now() }); });
});

async function handle(c) {
  switch (c.op) {
    case 'hook': {
      const child = spawn(DEEP_HOOK, c.args, { cwd: c.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      started(c.n, child);
      child.stdin.on('error', () => undefined);
      child.stdin.end(c.input ?? '');
      return collect(child, c.timeoutMs);
    }
    case 'exec': {
      // agent -> shell -> command: the shell stays between, because it runs one more thing after the command.
      const child = spawn('/bin/sh', ['-c', '"$@"; exit $?', 'sh', ...c.argv], { cwd: c.cwd, env: c.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      started(c.n, child);
      return collect(child, c.timeoutMs);
    }
    case 'mcp':
      return mcpCall(c);
    default:
      throw Error(`unknown op ${c.op}`);
  }
}

// This agent's own `deep mcp`, started once, as an agent starts its MCP server.
function mcpCall(c) {
  if (!mcp) {
    const child = spawn(c.argv[0], c.argv.slice(1), { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    started(c.n, child);
    mcp = { child, lines: [], wakers: new Set(), stderr: '' };
    child.stdin.on('error', () => undefined);
    child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
    createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push(l); for (const w of [...mcp.wakers]) w(); });
    child.on('close', () => { for (const w of [...mcp.wakers]) w(); });
  }
  const m = mcp;
  if (c.line.id === undefined) {
    m.child.stdin.write(`${JSON.stringify(c.line)}\n`);
    return Promise.resolve({ reply: null, ms: 0, pid: m.child.pid });
  }
  return new Promise((resolve, reject) => {
    const from = m.lines.length;
    const t0 = performance.now();
    const finish = () => { clearTimeout(timer); m.wakers.delete(check); };
    const timer = setTimeout(() => { finish(); reject(Error(`deep mcp gave no reply to ${c.line.id} in ${c.timeoutMs} ms`)); }, c.timeoutMs ?? 120_000);
    const check = () => {
      for (let i = from; i < m.lines.length; i++) {
        let json;
        try { json = JSON.parse(m.lines[i]); } catch { continue; }
        if (json.id === c.line.id && ('result' in json || 'error' in json)) { finish(); resolve({ reply: json, ms: performance.now() - t0, pid: m.child.pid }); return; }
      }
      if (m.child.exitCode !== null) { finish(); reject(Error(`deep mcp exited ${m.child.exitCode}: ${m.stderr}`)); }
    };
    m.wakers.add(check);
    m.child.stdin.write(`${JSON.stringify(c.line)}\n`);
    check();
  });
}

createInterface({ input: process.stdin }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
  handle(c).then((done) => out({ n: c.n, done }), (error) => out({ n: c.n, failed: String(error?.stack ?? error) }));
});
const stop = () => {
  for (const child of running) try { child.kill('SIGKILL'); } catch { /* gone */ }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.stdin.on('end', stop);
