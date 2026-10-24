// A repo's own dev server, as the environment block of a test repo's .deepbuild/done.yaml starts it (`up`). It
// reads its leased port from the variable `web`, listens on 127.0.0.1 there, and answers GET /health with 200 and
// {ok, cwd, port, pid}, cwd being the folder it was started in (so a test sees which tree a stack served). Every
// process it makes writes <pid-dir>/<role>.<pid> first, so the test knows each PID without trusting the hub.
//
//   --pid-dir <dir>    where the PID files go (relative to its folder); default .pids
//   --child            also starts a child (role "child") that stays, carrying the same environment
//   --build-ms <n>     a long build: waits n ms before it listens
//   --unhealthy        listens, but /health answers 503 for as long as it runs
//   --as-child         (internal) run as the child
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const dir = resolve(value('--pid-dir', '.pids'));
mkdirSync(dir, { recursive: true });
const mark = (role) => writeFileSync(join(dir, `${role}.${process.pid}`), '');
process.on('SIGTERM', () => process.exit(0));

if (flag('--as-child')) {
  mark('child');
  setInterval(() => undefined, 60_000);
} else {
  mark('server');
  if (flag('--child')) spawn(process.execPath, [fileURLToPath(import.meta.url), '--as-child', '--pid-dir', dir], { stdio: 'ignore' });
  const port = Number(process.env.web);
  if (!Number.isInteger(port) || port <= 0) { console.error(`server: no port in $web (${process.env.web})`); process.exit(64); }
  const build = Number(value('--build-ms', '0'));
  setTimeout(() => {
    const server = http.createServer((req, res) => {
      if (req.url !== '/health') { res.writeHead(404).end(); return; }
      const healthy = !flag('--unhealthy');
      res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: healthy, cwd: process.cwd(), port, pid: process.pid }));
    });
    server.on('error', (error) => { console.error(`server: ${error.message}`); process.exit(65); });
    server.listen(port, '127.0.0.1');
  }, build);
}
