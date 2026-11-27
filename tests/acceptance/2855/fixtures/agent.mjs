#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const children = new Set();
let mcp;
const stop = () => {
  for (const child of children) try { child.kill('SIGKILL'); } catch {}
  process.exit(0);
};
createInterface({ input: process.stdin }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
  if (c.op === 'exit') return stop();
  const work = c.op === 'hook' ? hook(c) : mcpLine(c);
  work.then((a) => out({ n: c.n, ...a }), (e) => out({ n: c.n, failed: String(e?.stack ?? e) }));
});
process.on('SIGTERM', stop);
process.stdin.on('end', stop);

function hook({ binary, args, payload, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(binary, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs ?? 90_000);
    const done = (code, signal, extra = '') => { clearTimeout(timer); children.delete(child); resolve({ code, signal, stdout, stderr: stderr + extra, ms: performance.now() - t0, ended: Date.now() }); };
    child.on('error', (e) => done(null, null, e.message));
    child.on('close', done);
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(payload));
  });
}

function mcpLine({ argv, line, timeoutMs }) {
  if (!mcp) {
    const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'ignore'] });
    children.add(child);
    mcp = { child, wait: new Map() };
    createInterface({ input: child.stdout }).on('line', (l) => {
      let v;
      try { v = JSON.parse(l); } catch { return; }
      mcp.wait.get(JSON.stringify(v.id))?.(v);
    });
    child.stdin.on('error', () => undefined);
  }
  const t0 = performance.now();
  if (line.id === undefined) { mcp.child.stdin.write(`${JSON.stringify(line)}\n`); return Promise.resolve({ reply: null, pid: mcp.child.pid, ms: 0 }); }
  return new Promise((resolve) => {
    const key = JSON.stringify(line.id);
    const timer = setTimeout(() => { mcp.wait.delete(key); resolve({ reply: null, pid: mcp.child.pid, ms: performance.now() - t0 }); }, timeoutMs ?? 150_000);
    mcp.wait.set(key, (reply) => { clearTimeout(timer); mcp.wait.delete(key); resolve({ reply, pid: mcp.child.pid, ms: performance.now() - t0 }); });
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
  });
}
