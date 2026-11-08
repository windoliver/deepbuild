#!/usr/bin/env node
// A process whose children are deep-hook runs: one Claude Code session's process, or Codex's shared app-server daemon
// serving several sessions, as the agent is the parent of its hook commands. The hub can bind a session to it and read
// its PID and start time. It decides nothing about DeepBuild. After tests/acceptance/321/fixtures/agent.mjs (same repo,
// same license).
//
//   FIXTURE_DEEP_HOOK=<deep-hook> FIXTURE_SIGNALS=<file> node <copy of agent.mjs> [arguments that only name it]
//
// One JSON command per stdin line, {n, args, cwd, input, timeoutMs}: runs `<deep-hook> <args...>` in `cwd` with
// `input` on its stdin, and answers {n, code, signal, stdout, stderr} on stdout once it ends. Every catchable signal
// it receives is appended to FIXTURE_SIGNALS as one JSON line and otherwise ignored, so a test can say whether anything
// signalled it; the test itself stops it with SIGKILL, by its PID.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const HOOK = process.env.FIXTURE_DEEP_HOOK;
const SIGNALS = process.env.FIXTURE_SIGNALS;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2', 'SIGCONT', 'SIGWINCH', 'SIGALRM', 'SIGPIPE']) {
  process.on(signal, () => { if (SIGNALS) appendFileSync(SIGNALS, `${JSON.stringify({ signal, at: Date.now() })}\n`); });
}

createInterface({ input: process.stdin }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
  const child = spawn(HOOK, c.args, { cwd: c.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  const timer = setTimeout(() => child.kill('SIGKILL'), c.timeoutMs ?? 150_000);
  child.on('error', (error) => { clearTimeout(timer); out({ n: c.n, code: null, signal: null, stdout, stderr: `${stderr}${error.message}` }); });
  child.on('close', (code, signal) => { clearTimeout(timer); out({ n: c.n, code, signal, stdout, stderr }); });
  child.stdin.on('error', () => undefined);
  child.stdin.end(c.input ?? '');
});
// It outlives its stdin only as long as the test holds it; the test stops it by PID.
process.stdin.on('end', () => process.exit(0));
