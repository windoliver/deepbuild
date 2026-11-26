// The test repo's dev server, as its .deepbuild/done.yaml `up` line starts it: it listens on 127.0.0.1 at the port
// leased as `web` and answers GET /health with 200 and {ok, cwd, pid}. It writes .pids/server.<pid> in the folder it
// was started in first, so a test knows each stack's PID without asking the hub or the provider.
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';

const port = Number(process.env.web);
if (!Number.isInteger(port) || port <= 0) {
  console.error(`server: no port in $web (${process.env.web})`);
  process.exit(64);
}
mkdirSync('.pids', { recursive: true });
writeFileSync(join('.pids', `server.${process.pid}`), '');
process.on('SIGTERM', () => process.exit(0));
const server = http.createServer((req, res) => {
  if (req.url !== '/health') return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, cwd: process.cwd(), pid: process.pid }));
});
server.on('error', (error) => {
  console.error(`server: ${error.message}`);
  process.exit(65);
});
server.listen(port, '127.0.0.1');
