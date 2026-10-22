// The environment kit's fixture server (#314): a small HTTP service the reference environment@1 fill brings
// up. It takes a moment to come up (the warm-up), then listens on the leased port, answers its health route
// with its token and writes its ready marker; so an environment that reports ready before the health check
// answers is caught, and one that binds another port is seen at the lease.
//   node server.mjs <port> <healthPath> <token> <warmupMs> <readyFile> <runToken> [helper]
// It carries the lease's run token on its command line, as every process of an environment does. With `helper`,
// it also starts helper.mjs carrying that token, a grandchild that outlives the server: the planted environment
// that leaves a process after down.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [port, health, token, warmup, ready, run, helper] = process.argv.slice(2);
if (helper === 'helper') spawn(process.execPath, [fileURLToPath(new URL('./helper.mjs', import.meta.url)), run], { detached: true, stdio: 'ignore' }).unref();
const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === health) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, token }));
    return;
  }
  response.writeHead(404);
  response.end();
});
setTimeout(() => {
  server.listen(Number(port), '127.0.0.1', () => {
    writeFileSync(ready, JSON.stringify({ port: Number(port), pid: process.pid }));
  });
}, Number(warmup));
// A fixture server never outlives its run by much.
setTimeout(() => process.exit(0), 60_000).unref();
process.on('SIGTERM', () => process.exit(0));
