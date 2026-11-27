// One agent's process, as far as its processes go (README: Stand-ins): a long-lived process whose children are its
// sessions' deep-hook runs and the shells its calls start, as Claude Code is the parent of one session's and Codex's
// shared process of every thread's. It decides nothing about DeepBuild and never edits a file. Adapted from
// tests/acceptance/3229/fixtures/agent.mjs and tests/acceptance/39/fixtures/daemon.mjs (same repo, same license); this
// suite keeps its own copy so a redraft of theirs never moves it.
//
//   node agent.mjs <deep-hook>      one JSON command per stdin line, one JSON answer per stdout line, by `n`
//
//   {n, op: 'hook', args, cwd, input}   runs `<deep-hook> <args…>`, `input` on its stdin: {n, code, stdout, stderr}
//   {n, op: 'shell', command, cwd}      runs `/bin/sh -c <command>` to its end, as a shell call does: {n, code, stdout, stderr}
//   {n, op: 'open', command, cwd}       starts `/bin/sh -c <command>` with its stdin held open, a call that is still
//                                       running, and answers with its first line of output: {n, id, line}; one that
//                                       ends before it prints a line answers {n, failed, code, stdout, stderr}
//   {n, op: 'close', id}                ends that command's stdin and answers once it has ended: {n, code, stdout, stderr}
//
// A child still going at LIMIT is stopped with SIGKILL, by its PID, and its answer says so. On SIGTERM, or when stdin
// closes, it stops its children and exits.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const LIMIT = 600_000;
const [, , DEEP_HOOK] = process.argv;
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const running = new Set();
const held = new Map();
let opened = 0;

/** Starts a child whose output is kept; `ended` is called once with its exit code and what it printed. */
function start(file, args, cwd, ended) {
  const child = spawn(file, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  running.add(child);
  const kept = { child, stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8').on('data', (d) => { kept.stdout += d; kept.printed?.(); });
  child.stderr.setEncoding('utf8').on('data', (d) => (kept.stderr += d));
  const timer = setTimeout(() => { kept.stderr += `\nstopped at ${LIMIT} ms`; child.kill('SIGKILL'); }, LIMIT); // deadline: a child that never ends is stopped, so its answer comes
  let over = false;
  const done = (code, extra = '') => {
    if (over) return;
    over = true;
    clearTimeout(timer);
    running.delete(child);
    ended({ code, stdout: kept.stdout, stderr: kept.stderr + extra });
  };
  child.on('error', (error) => done(null, error.message));
  child.on('close', (code) => done(code));
  child.stdin.on('error', () => undefined);
  return kept;
}

function open(n, command, cwd) {
  const id = ++opened;
  const entry = { answered: false };
  held.set(id, entry);
  const kept = start('/bin/sh', ['-c', command], cwd, (ended) => {
    entry.ended = ended;
    if (!entry.answered) {
      entry.answered = true;
      held.delete(id);
      out({ n, failed: `the command ended (exit ${ended.code}) before it printed a line`, ...ended });
    }
    entry.closing?.();
  });
  entry.child = kept.child;
  kept.printed = () => {
    const end = kept.stdout.indexOf('\n');
    if (entry.answered || end < 0) return;
    entry.answered = true;
    out({ n, id, line: kept.stdout.slice(0, end) });
  };
}

function close(n, id) {
  const entry = held.get(id);
  if (!entry) return out({ n, failed: `no open command ${id}` });
  const answer = () => { held.delete(id); out({ n, ...entry.ended }); };
  if (entry.ended) return answer();
  entry.closing = answer;
  entry.child.stdin.end();
}

createInterface({ input: process.stdin }).on('line', (raw) => {
  let c;
  try { c = JSON.parse(raw); } catch { return; }
  if (c.op === 'hook') start(DEEP_HOOK, c.args, c.cwd, (ended) => out({ n: c.n, ...ended })).child.stdin.end(c.input ?? '');
  else if (c.op === 'shell') start('/bin/sh', ['-c', c.command], c.cwd, (ended) => out({ n: c.n, ...ended })).child.stdin.end();
  else if (c.op === 'open') open(c.n, c.command, c.cwd);
  else if (c.op === 'close') close(c.n, c.id);
  else out({ n: c.n, failed: `unknown op ${c.op}` });
});
const stop = () => {
  for (const child of running) try { child.kill('SIGKILL'); } catch { /* gone */ }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.stdin.on('end', stop);
