import { readFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import type * as Tls from 'node:tls';
import { expect, test, vi } from 'vitest';
import { openEgress } from './egress.js';

// The credential's host is not ours: the filter's look at its certificate and its request to it are stood in for, and
// the request it would send is kept. The run's side (CONNECT, TLS under the run CA, the request) is real.
const upstream = vi.hoisted(() => ({ sent: (_headers: string[]): void => undefined }));
vi.mock('node:https', () => ({ default: { request: (o: { headers: string[] }) => { upstream.sent(o.headers); return { on: () => undefined, end: () => undefined }; } } }));
vi.mock('node:tls', async (actual) => ({
  ...(await actual<typeof Tls>()),
  connect: (_o: unknown, connected: () => void) => { queueMicrotask(connected); return { getPeerCertificate: () => ({}), destroy: () => undefined, on: () => undefined }; },
}));

test('a credential holding $ patterns reaches its host byte for byte', async () => {
  const value = 'k$&$$v$`$\'-12345678';
  const egress = await openEgress([{ env: 'API_KEY', value, hosts: ['127.0.0.1'] }], () => undefined);
  let run: Tls.TLSSocket | undefined;
  try {
    const sent = new Promise<string[]>((done) => { upstream.sent = done; });
    const { connect } = await vi.importActual<typeof Tls>('node:tls');
    const tunnel = http.request({ host: '127.0.0.1', port: egress.port, method: 'CONNECT', path: '127.0.0.1:443' });
    tunnel.on('connect', (_res, socket) => {
      const tls = (run = connect({ socket, host: '127.0.0.1', ca: readFileSync(join(egress.dir, 'run-ca.pem')) }, () => {
        tls.write(`GET / HTTP/1.1\r\nhost: 127.0.0.1\r\nauthorization: Bearer ${egress.standIns.API_KEY}; x\r\n\r\n`);
      }));
      tls.on('error', () => undefined);
    });
    tunnel.end();
    const headers = await sent;
    expect(headers[headers.indexOf('authorization') + 1]).toBe(`Bearer ${value}; x`);
  } finally {
    // The run hangs up before its filter closes, as a run that ended has.
    if (run) await new Promise<void>((closed) => { run!.once('close', () => closed()); run!.destroy(); });
    await egress.close();
  }
});
