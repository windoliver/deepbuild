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
// One connection, closed after the answer (a kept-alive socket would hold an environment's graceful close open),
// and a body cut to what the shared buffer holds.
const probe = ({ port, path }) => fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2500), headers: { connection: 'close' } })
  .then((r) => r.text().then((body) => ({ status: r.status, body: body.slice(0, 16_384), error: null })))
  .catch((e) => ({ status: null, body: '', error: String(e) }));
const listening = ({ port }) => new Promise((resolve) => {
  const socket = connect(port, '127.0.0.1');
  socket.setTimeout(1000, () => { socket.destroy(); resolve({ open: false }); });
  socket.once('connect', () => { socket.destroy(); resolve({ open: true }); });
  socket.once('error', () => resolve({ open: false }));
});
const OPS = { lease, probe, listening };

parentPort.on('message', async (request) => {
  let answer;
  try { answer = await OPS[request.op](request); } catch (error) { answer = { error: String(error) }; }
  const bytes = Buffer.from(JSON.stringify(answer));
  const length = bytes.copy(out, 0, 0, out.length);
  Atomics.store(flags, 1, length);
  Atomics.store(flags, 0, 1);
  Atomics.notify(flags, 0);
});
