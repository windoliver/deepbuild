// The repo's own dev server, as env-local starts it from a test repo's .deepbuild/done.yaml (`up`): the stack only
// env-local runs. First it leaves its marker, .envlocal/ran.<pid> in the folder it was started in, so a test can
// prove env-local did or did not run; then it listens on 127.0.0.1 at the port in `web` and answers GET /health 200.
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';

const dir = join(process.cwd(), '.envlocal');
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `ran.${process.pid}`), `${process.cwd()}\n`);
process.on('SIGTERM', () => process.exit(0));
const port = Number(process.env.web);
if (!Number.isInteger(port) || port <= 0) { console.error(`local-server: no port in $web (${process.env.web})`); process.exit(64); }
const server = http.createServer((req, res) => {
  if (req.url !== '/health') { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, by: 'env-local', cwd: process.cwd(), pid: process.pid }));
});
server.on('error', (error) => { console.error(`local-server: ${error.message}`); process.exit(65); });
server.listen(port, '127.0.0.1');
