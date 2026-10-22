// The environment kit's probes (#314), answered from one worker thread: the kit's judge runs synchronously
// (the preflight's kit check is synchronous), and a Node process per probe cost more than the probe. The kit
// posts a request and waits on the shared buffer; this thread does the asynchronous network work and writes
// the answer back as JSON: a loopback port leased by binding it once, a GET's status and body, or whether
// something accepts connections on a port.
import { createServer, connect } from 'node:net';
import { parentPort, workerData } from 'node:worker_threads';

const flags = new Int32Array(workerData, 0, 2); // [0] answered, [1] the answer's byte length
const out = new Uint8Array(workerData, 8);

const lease = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve({ port })); });
});
// One connection, closed after the answer (a kept-alive socket would hold an environment's graceful close open);
// a redirect is an error, since the answer must come from the leased port itself.
// The token is read from the whole body here, where it is whole: the body that crosses the buffer may be cut.
const tokenIn = (body) => { try { const parsed = JSON.parse(body); return parsed !== null && typeof parsed === 'object' && 'token' in parsed ? parsed.token : undefined; } catch { return undefined; } };
// A request given up on after the limit is marked so: the kit reads it as its own limit reached, not as the environment's answer.
const timedOut = (e) => [e?.name, e?.cause?.name].some((name) => name === 'TimeoutError' || name === 'AbortError');
const probe = ({ port, path }) => fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2500), headers: { connection: 'close' }, redirect: 'error' })
  .then((r) => r.text().then((body) => ({ status: r.status, body, token: tokenIn(body), error: null, timedOut: false })))
  .catch((e) => ({ status: null, body: '', token: undefined, error: String(e), timedOut: timedOut(e) }));
// Open, or the error code the connect gave: only a refusal proves nothing listens; the kit reads anything else as unknown.
const listening = ({ port }) => new Promise((resolve) => {
  const socket = connect(port, '127.0.0.1');
  socket.setTimeout(1000, () => { socket.destroy(); resolve({ open: false, code: 'ETIMEDOUT' }); });
  socket.once('connect', () => { socket.destroy(); resolve({ open: true, code: null }); });
  socket.once('error', (e) => resolve({ open: false, code: e.code ?? String(e) }));
});
const OPS = { lease, probe, listening };
// The first fetch of a thread loads the HTTP client; done here, against a port nothing serves on, so the first health
// answer the kit measures is the environment's time and not the client's loading.
fetch('http://127.0.0.1:9/', { signal: AbortSignal.timeout(500) }).catch(() => undefined);

parentPort.on('message', async (request) => {
  let answer;
  try { answer = await OPS[request.op](request); } catch (error) { answer = { error: String(error) }; }
  let bytes = Buffer.from(JSON.stringify(answer));
  // An answer past the shared buffer keeps its status and loses its body, marked so, rather than arriving cut.
  if (bytes.length > out.length) bytes = Buffer.from(JSON.stringify({ ...answer, body: '', truncated: true }));
  const length = bytes.copy(out, 0, 0, out.length);
  Atomics.store(flags, 1, length);
  Atomics.store(flags, 0, 1);
  Atomics.notify(flags, 0);
});
