// node diagnose.mjs <out> <command...>: run under measureOnce, it runs the budget's command as its waited-for
// child, then copies the counter's log of that run to <out> as JSON { pid, log, alive }: this process's pid,
// the log's text (null when the counter set no DEEP_COUNT_LOG), and which processes the log saw start with no
// end line are still running 5 s after the command ended. It exits as the command did.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [out, program, ...args] = process.argv.slice(2);
const result = spawnSync(program, args, { stdio: 'inherit' });
const path = process.env.DEEP_COUNT_LOG;
const read = () => (path ? readFileSync(path, 'utf8') : null);
const running = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};
const open = (log) => {
  const rows = (log ?? '').split('\n').filter(Boolean).map((line) => line.split(' '));
  const ended = new Set(rows.filter(([kind]) => ['reap', 'unread'].includes(kind)).map(([, , child]) => child).concat(rows.filter(([kind]) => kind === 'exit').map(([, child]) => child)));
  return rows.filter(([kind, , child]) => kind === 'start' && !ended.has(child)).map(([, , child]) => Number(child));
};
const deadline = Date.now() + 5000;
let alive = open(read()).filter(running);
while (alive.length && Date.now() < deadline) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  alive = open(read()).filter(running);
}
writeFileSync(out, JSON.stringify({ pid: process.pid, log: read(), alive }));
process.exit(result.status ?? 1);
