// A check command for the #56 acceptance tests. The tests put it in a hold's `check.argv`, and
// the hub under test runs it once per attempt with the leased port in PORT.
//
//   node check.mjs <marker> <config JSON>
//
// config: { log, key, counter, script, grandchildren }
//   log            file it appends one JSON line to per thing it does
//   key            the hold this check belongs to, copied into every line
//   counter        file that counts this hold's attempts across retries
//   script         one step per attempt, the last repeated: "pass", "fail" or "hang", each with an
//                  optional ":<ms>" delay before it exits ("pass:150")
//   grandchildren  how many children it leaves behind in its own process group
//
// It ignores SIGTERM, SIGHUP and SIGINT, and so do its grandchildren (`sh` loops whose argv carries
// the marker), so only a SIGKILL to the process group or to each PID stops them. It binds PORT on
// 127.0.0.1 for as long as it runs, so a port leased to two live attempts at once shows as a
// `conflict` line.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';

const [marker, raw] = process.argv.slice(2);
const { log, key, counter, script = ['pass'], grandchildren = 0 } = JSON.parse(raw);
for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(signal, () => {});
const record = (event, extra = {}) => appendFileSync(log, `${JSON.stringify({ event, key, marker, pid: process.pid, t: Date.now(), ...extra })}\n`);

const attempt = (existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0) + 1;
writeFileSync(counter, String(attempt));
const step = script[Math.min(attempt, script.length) - 1];
const [kind, delay = '0'] = step.split(':');
record('start', { attempt, port: process.env.PORT ?? null, step });

for (let index = 0; index < grandchildren; index++) {
  const child = spawn('/bin/sh', ['-c', 'trap "" TERM HUP INT; while :; do sleep 1; done', marker], { stdio: 'ignore' });
  record('grandchild', { attempt, pid: child.pid, parent: process.pid });
}

const port = Number(process.env.PORT);
if (!Number.isSafeInteger(port) || port <= 0) {
  record('noport', { attempt });
  process.exit(4);
}
const server = createServer();
server.on('error', (error) => {
  record('conflict', { attempt, port, code: error.code });
  process.exit(3);
});
server.listen(port, '127.0.0.1', () => {
  record('bound', { attempt, port });
  if (kind === 'hang') {
    setInterval(() => {}, 1 << 30);
    return;
  }
  setTimeout(() => {
    const code = kind === 'pass' ? 0 : 1;
    record('end', { attempt, code });
    process.exit(code);
  }, Number(delay));
});
