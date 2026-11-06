#!/usr/bin/env node
// One session's Claude Code, as far as its hooks and its MCP server go (README, Playing Claude Code): a long-lived
// process per session whose children are that session's deep-hook runs and its one `deep mcp`, as a real session's
// hook commands and MCP server are Claude Code's children. So the hub binds the session (and its deep_ask) to this
// process, never to the test runner, and `deep inbox answer` run by the test is outside every session's process
// tree. It decides nothing about DeepBuild. Copied from tests/acceptance/325/fixtures/agent.mjs (itself after #322's and
// #26's), same repo, same license; this suite keeps its own copy. Codex sessions run through it too (`deep-hook codex`).
//
//   node agent.mjs <deep-hook>      one JSON command per stdin line, JSON answers per stdout line, by `n`
//
// A hook: {n, args, cwd, input, timeoutMs} runs `<deep-hook> <args…>` in `cwd`, `input` on its stdin, and stops it
// (SIGKILL) at `timeoutMs`. Answers {n, pid} once it starts, then {n, code, signal, stdout, stderr, ms, timedOut, ended}.
// An MCP line: {n, op: 'mcp', argv, line, timeoutMs} writes one JSON-RPC line to this process's `deep mcp` (started
// from `argv` on first use) and answers {n, mcp_pid, reply} with the reply of the same id, or {n, mcp_pid, reply: null}
// for a notification, or {n, failed}. On SIGTERM, or when stdin closes, it stops every child, then exits.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const [, , DEEP_HOOK] = process.argv;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const running = new Set();
let mcp;

function hook(c) {
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
}

function mcpLine(c) {
  if (!mcp) {
    const child = spawn(c.argv[0], c.argv.slice(1), { cwd: c.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    running.add(child);
    mcp = { child, lines: [], wakers: new Set(), stderr: '' };
    child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
    createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push(l); for (const w of [...mcp.wakers]) w(); });
    child.on('close', () => { for (const w of [...mcp.wakers]) w(); });
  }
  const m = mcp;
  if (c.line.id === undefined) {
    m.child.stdin.write(`${JSON.stringify(c.line)}\n`);
    out({ n: c.n, mcp_pid: m.child.pid, reply: null });
    return;
  }
  const from = m.lines.length;
  const finish = () => { clearTimeout(timer); m.wakers.delete(check); };
  const timer = setTimeout(() => { finish(); out({ n: c.n, mcp_pid: m.child.pid, failed: `deep mcp gave no reply to ${c.line.id} in ${c.timeoutMs} ms` }); }, c.timeoutMs ?? 120_000);
  const check = () => {
    for (let i = from; i < m.lines.length; i++) {
      let json;
      try { json = JSON.parse(m.lines[i]); } catch { continue; }
      if (json.id === c.line.id && ('result' in json || 'error' in json)) { finish(); out({ n: c.n, mcp_pid: m.child.pid, reply: json }); return; }
    }
    if (m.child.exitCode !== null) { finish(); out({ n: c.n, mcp_pid: m.child.pid, failed: `deep mcp exited ${m.child.exitCode}: ${m.stderr}` }); }
  };
  m.wakers.add(check);
  m.child.stdin.write(`${JSON.stringify(c.line)}\n`);
  check();
}

createInterface({ input: process.stdin }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
  if (c.op === 'mcp') mcpLine(c);
  else hook(c);
});
const stop = () => {
  for (const child of running) try { child.kill('SIGKILL'); } catch { /* gone */ }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.stdin.on('end', stop);
