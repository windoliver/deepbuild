// The repo's app, adapted from tests/acceptance/1106/fixtures/app.mjs (same repo, same license). It listens on $web,
// holds what the stack gave it in SHOP_API_KEY, and reaches outside HTTPS only through the egress filter its
// environment names: an HTTP CONNECT proxy in HTTPS_PROXY, trusting the CA bundles in NODE_EXTRA_CA_CERTS and
// SSL_CERT_FILE. Its one argument (done.yaml's `up`) is the sample API's host:port.
//   GET /health  200 {ok}
//   GET /env     200 {env}: its whole environment, as its process holds it
//   GET /call    200 {status, upstream, error}: one HTTPS request to the sample API with `Authorization: Bearer <it>`
//   GET /leak    200 {reversed, xor_hex}: SHOP_API_KEY reversed and XOR'd with 0x5a, also written to leak.txt
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import tls from 'node:tls';

mkdirSync('.pids', { recursive: true });
writeFileSync(join('.pids', `app.${process.pid}`), '');
process.on('SIGTERM', () => process.exit(0));
const port = Number(process.env.web);
const trust = () => ['NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'].flatMap((v) => { try { return process.env[v] ? [readFileSync(process.env[v], 'utf8')] : []; } catch { return []; } });

async function call() {
  const held = process.env.SHOP_API_KEY;
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  const to = process.argv[2] ?? '';
  if (held === undefined) return { error: 'the app holds no SHOP_API_KEY' };
  if (!proxyUrl) return { error: 'the app has no HTTPS_PROXY: no egress filter to send through' };
  const cut = to.lastIndexOf(':');
  const [host, toPort] = [to.slice(0, cut), Number(to.slice(cut + 1))];
  const proxy = new URL(proxyUrl);
  const auth = proxy.username ? { 'proxy-authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}` } : {};
  try {
    const { res, sock } = await new Promise((done, fail) => {
      const req = http.request({ host: proxy.hostname.replace(/^\[|\]$/g, ''), port: Number(proxy.port || 80), method: 'CONNECT', path: to, headers: { host: to, ...auth }, timeout: 15_000 });
      req.on('connect', (r, s) => done({ res: r, sock: s }));
      req.on('response', (r) => { r.resume(); done({ res: r, sock: undefined }); });
      req.on('timeout', () => req.destroy(Error('CONNECT timed out')));
      req.on('error', fail);
      req.end();
    });
    if (res.statusCode !== 200 || !sock) return { status: res.statusCode, upstream: null, error: `the filter answered CONNECT ${res.statusCode}` };
    const secure = await new Promise((done, fail) => {
      const s = tls.connect({ socket: sock, ca: [...tls.rootCertificates, ...trust()], servername: host, port: toPort });
      s.once('secureConnect', () => done(s));
      s.once('error', fail);
    });
    return await new Promise((done, fail) => {
      const req = http.request({ createConnection: () => secure, method: 'GET', path: '/v1/items', headers: { host: to, connection: 'close', authorization: `Bearer ${held}` }, timeout: 15_000 }, (r) => {
        r.resume();
        r.on('end', () => done({ status: r.statusCode, upstream: r.headers['x-dh1156-upstream'] ?? null }));
      });
      req.on('timeout', () => req.destroy(Error('request timed out')));
      req.on('error', fail);
      req.end();
    });
  } catch (e) {
    return { error: `${to}: ${e?.code ?? e?.message ?? e}` };
  }
}

function leak() {
  const held = process.env.SHOP_API_KEY ?? '';
  const reversed = [...held].reverse().join('');
  const xor = Buffer.from(Buffer.from(held, 'utf8').map((b) => b ^ 0x5a));
  writeFileSync('leak.txt', `reversed=${reversed}\nxor_hex=${xor.toString('hex')}\nxor_raw=`);
  appendFileSync('leak.txt', Buffer.concat([xor, Buffer.from('\n')]));
  return { reversed, xor_hex: xor.toString('hex') };
}

http.createServer(async (req, res) => {
  const send = (body) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const path = new URL(req.url ?? '/', 'http://app.invalid').pathname;
  if (path === '/health') return send({ ok: true });
  if (path === '/env') return send({ env: process.env });
  if (path === '/call') return send(await call());
  if (path === '/leak') return send(leak());
  res.writeHead(404);
  res.end();
}).listen(port, '127.0.0.1', () => writeFileSync('.app-port', `${port}\n`));
