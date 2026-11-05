#!/usr/bin/env node
// One session's Claude Code, as far as its hooks and its MCP server go (README, Playing Claude Code): a long-lived
// process per session whose children are that session's deep-hook runs and its one `deep mcp`, as a real session's
// hook commands and MCP server are Claude Code's children. So the hub binds the session to this process, never to the
// test runner, and `deep inbox answer` run by the test (a sibling of this process, not its descendant) is your
// terminal, outside every session's process tree. It decides nothing about DeepBuild. Copied from
// tests/acceptance/322/fixtures/agent.mjs (same repo, same license), with the MCP server after
// tests/acceptance/26/fixtures/agent.mjs; this suite keeps its own copy so a redraft of theirs never moves it.
//
//   node agent.mjs <deep-hook> <node> <deep cli>   one JSON command per stdin line, JSON answers per stdout line, by `n`
//
// A hook command: {n, args, cwd, input, timeoutMs}: runs `<deep-hook> <args…>` in `cwd`, `input` on its stdin, this
// process's environment, and stops it (SIGKILL) at `timeoutMs`. Answers {n, pid} once it starts, then
// {n, code, signal, stdout, stderr, ms, timedOut, ended} once it ends.
// An MCP line: {n, mcp, cwd, timeoutMs}: writes the JSON-RPC line `mcp` to this session's `deep mcp` (started once, in
// `cwd`, as `<node> <deep cli> mcp`), and answers {n, reply} with the line whose id is the request's, or {n, reply:
// null} for a notification, or {n, failed} at `timeoutMs`. Several may be pending at once (deep_ask waits for you).
// On SIGTERM, or when stdin closes, it stops every child still going, then exits.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [, , DEEP_HOOK, NODE, CLI] = process.argv;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const running = new Set();
let mcp;

function startMcp(cwd, n) {
  const child = spawn(NODE, [CLI, 'mcp'], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  running.add(child);
  mcp = { child, lines: [], wakers: new Set(), stderr: '' };
  child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
  createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push(l); for (const w of [...mcp.wakers]) w(); });
  child.on('close', () => { running.delete(child); for (const w of [...mcp.wakers]) w(); });
  child.stdin.on('error', () => undefined);
  if (child.pid) out({ n, pid: child.pid });
}

function mcpLine(c) {
  if (!mcp) startMcp(c.cwd, c.n);
  const line = c.mcp;
  if (line.id === undefined) {
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    out({ n: c.n, reply: null });
    return;
  }
  const from = mcp.lines.length;
  const finish = () => { clearTimeout(timer); mcp.wakers.delete(check); };
  const timer = setTimeout(() => { finish(); out({ n: c.n, failed: `deep mcp gave no reply to ${line.id} in ${c.timeoutMs} ms: ${mcp.stderr}` }); }, c.timeoutMs ?? 120_000);
  const check = () => {
    for (let i = from; i < mcp.lines.length; i++) {
      let json;
      try { json = JSON.parse(mcp.lines[i]); } catch { continue; }
      if (json.id === line.id && ('result' in json || 'error' in json)) { finish(); out({ n: c.n, reply: json }); return; }
    }
    if (mcp.child.exitCode !== null) { finish(); out({ n: c.n, failed: `deep mcp exited ${mcp.child.exitCode}: ${mcp.stderr}` }); }
  };
  mcp.wakers.add(check);
  mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
  check();
}

createInterface({ input: process.stdin }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
  if (c.mcp) return mcpLine(c);
  const t0 = performance.now();
  const child = spawn(DEEP_HOOK, c.args, { cwd: c.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  running.add(child);
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, c.timeoutMs ?? 60_000);
  const done = (code, signal, extra = '') => {
    clearTimeout(timer);
    running.delete(child);
    out({ n: c.n, code, signal, stdout, stderr: stderr + extra, ms: performance.now() - t0, timedOut, ended: Date.now() });
  };
  child.on('error', (error) => done(null, null, error.message));
  child.on('close', (code, signal) => done(code, signal));
  if (child.pid) out({ n: c.n, pid: child.pid });
  child.stdin.on('error', () => undefined);
  child.stdin.end(c.input ?? '');
});
const stop = () => {
  for (const child of running) try { child.kill('SIGKILL'); } catch { /* gone */ }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.stdin.on('end', stop);
