// The endpoint a service check meets (#68 acceptance tests): a real HTTP server in a process of its own, so a runner
// that blocks its own thread still reaches it. It listens on every local address, IPv4 and IPv6, on a port the OS
// picks, and prints that port as its first line. GET /orders/1042 answers an order as JSON; GET /__seen answers the
// source address of every other request it got, in order, so a test sees where the check's requests came from.
//
//   node server.mjs fast          every request answered at once
//   node server.mjs slow-for-ipv4 requests from an IPv4 address (where the endpoint's users are) answered after
//                                 300 ms; requests from ::1 at once
import { createServer } from 'node:http';

const mode = process.argv[2];
if (mode !== 'fast' && mode !== 'slow-for-ipv4') {
  process.stderr.write(`unknown mode ${mode}\n`);
  process.exit(2);
}
const ORDER = JSON.stringify({ id: 1042, status: 'shipped', items: [{ sku: 'A-1', qty: 2 }] });
const seen = [];
const plain = (address) => (address ?? '').replace(/^::ffff:/, '');

const server = createServer((req, res) => {
  if (req.url === '/__seen') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(seen));
    return;
  }
  const from = plain(req.socket.remoteAddress);
  seen.push(from);
  const answer = () => {
    if (req.url === '/orders/1042') res.writeHead(200, { 'content-type': 'application/json' }).end(ORDER);
    else res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
  };
  if (mode === 'slow-for-ipv4' && from.includes('.')) setTimeout(answer, 300);
  else answer();
});
server.listen(0, '::', () => {
  process.stdout.write(`${server.address().port}\n`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
