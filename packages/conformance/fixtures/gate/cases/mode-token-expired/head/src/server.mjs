// The shop's web server: its health route and the cart total, on the port the stack leases it.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const { total } = createRequire(import.meta.url)('./cart.js');
createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/health') return res.end('ok');
  if (url.pathname === '/total') return res.end(String(total((url.searchParams.get('items') ?? '').split(',').map((cents) => ({ cents: Number(cents) })))));
  res.statusCode = 404;
  res.end();
}).listen(Number(process.env.web), '127.0.0.1');
