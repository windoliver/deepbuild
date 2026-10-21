// The environment kit's fixture server (#314): a small HTTP service the reference environment@1 fill brings
// up. It takes a moment to come up (the warm-up), then listens on the leased port, answers its health route
// with its token and writes its ready marker; so an environment that reports ready before the health check
// answers is caught, and one that binds another port is seen at the lease.
//   node server.mjs <port> <healthPath> <token> <warmupMs> <readyFile>
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const [port, health, token, warmup, ready] = process.argv.slice(2);
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
