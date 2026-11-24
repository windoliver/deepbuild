// A stand-in for one agent process (one Claude Code session), copied from tests/acceptance/1015/fixtures/agent.mjs (same
// repo, same license; that suite adapted it from #18's), with each shell command's start and end times added. It decides
// nothing; it carries lines. Its hooks are the real deep-hook binary, run as its direct children (`deep-hook <agent>
// <event>`, the hook JSON on stdin), and its shell tool's commands are its children too, each `/bin/sh -c <command>` in
// a process group of its own, as an agent's Bash tool runs one. So every process a command starts, deep-show and `deep
// lease` included, has this session's agent among its ancestors, as under a real agent.
//   node agent.mjs   one JSON command per stdin line; one JSON answer per stdout line, matched by `n`. A `bash`
//                    command also sends {n, started: <pid>, t0: <ms>} as its shell starts and {n, output: <text>} as it
//                    prints; its answer carries t0 and t1, the times (ms since the Unix epoch) it started and ended.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  const c = JSON.parse(line);
  if (c.op === 'exit') { process.stdout.write('', () => process.exit(0)); return; }
  const work = c.op === 'hook' ? hook(c) : c.op === 'bash' ? bash(c) : Promise.reject(Error(`unknown op ${c.op}`));
  work.then((a) => out({ n: c.n, done: true, ...a }), (e) => out({ n: c.n, done: true, failed: String(e?.stack ?? e) }));
});

/** deep-hook as the agent runs a hook entry: a direct child of this process, the payload on stdin, waited for. */
function hook({ binary, agent, event, payload, cwd, env }) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const child = spawn(binary, [agent, event], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 90_000); // deadline: a hook that never ends is killed, and the test reads what it printed
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: `${stderr}${String(error)}`, ms: performance.now() - t0 }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, ms: performance.now() - t0 }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(payload));
  });
}

/** The shell tool: `/bin/sh -c <command>` in a process group of its own; its output, stdout and stderr in order, is the tool result. */
function bash({ n, command, cwd, env }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const child = spawn('/bin/sh', ['-c', command], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    out({ n, started: child.pid, t0 });
    let output = '';
    const take = (d) => { output += d; out({ n, output: d }); };
    child.stdout.setEncoding('utf8').on('data', take);
    child.stderr.setEncoding('utf8').on('data', take);
    child.on('error', (error) => resolve({ code: null, signal: null, output: `${output}${String(error)}`, pid: child.pid, t0, t1: Date.now() }));
    child.on('exit', () => { child.t1 = Date.now(); });
    child.on('close', (code, signal) => resolve({ code, signal, output, pid: child.pid, t0, t1: child.t1 ?? Date.now() }));
  });
}
