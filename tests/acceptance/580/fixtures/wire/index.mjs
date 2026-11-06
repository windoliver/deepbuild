// dh-wire: the sample app's one dependency, packed into a tarball by the test, so `npm ci` needs no registry and the
// app can't run without an install. A Postgres client (simple query protocol, trust auth) and a Redis client (RESP)
// in the fewest lines that talk to the real servers.
import { readFileSync } from 'node:fs';
import net from 'node:net';

export const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

const connect = (port, host = '127.0.0.1') => new Promise((resolve, reject) => {
  const sock = net.connect({ port: Number(port), host });
  sock.once('connect', () => { sock.removeListener('error', reject); resolve(sock); });
  sock.once('error', reject);
});
const int32 = (n) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };

/** A Postgres connection to a postgres:// URL: `query(sql)` resolves with its rows, each an array of strings or null. */
export async function pg(url) {
  const u = new URL(url);
  const sock = await connect(u.port || 5432, u.hostname);
  let buffer = Buffer.alloc(0);
  let rows = [];
  let failure = null;
  let waiter = null;
  const settle = (ok) => { const w = waiter; waiter = null; if (ok) w?.[0](rows); else w?.[1](failure); };
  sock.on('error', (e) => { failure = e; settle(false); });
  sock.on('close', () => { failure ??= Error('connection closed'); settle(false); });
  sock.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 5) {
      const type = String.fromCharCode(buffer[0]);
      const length = buffer.readInt32BE(1);
      if (buffer.length < 1 + length) return;
      const body = buffer.subarray(5, 1 + length);
      buffer = buffer.subarray(1 + length);
      if (type === 'R' && body.readInt32BE(0) !== 0) { failure = Error('only trust auth is spoken'); sock.destroy(); }
      else if (type === 'E') failure = Error(body.toString('utf8').split('\0').find((f) => f.startsWith('M'))?.slice(1) ?? 'error');
      else if (type === 'D') {
        const row = [];
        let at = 2;
        for (let i = 0, n = body.readInt16BE(0); i < n; i++) {
          const size = body.readInt32BE(at);
          at += 4;
          row.push(size < 0 ? null : body.toString('utf8', at, at + size));
          at += Math.max(size, 0);
        }
        rows.push(row);
      } else if (type === 'Z') {
        if (failure) { settle(false); failure = null; } else settle(true);
      }
    }
  });
  const ready = new Promise((resolve, reject) => { waiter = [resolve, reject]; });
  const startup = Buffer.concat([int32(196608), Buffer.from(`user\0${decodeURIComponent(u.username) || 'postgres'}\0database\0${u.pathname.slice(1)}\0\0`)]);
  sock.write(Buffer.concat([int32(startup.length + 4), startup]));
  await ready;
  return {
    query(sql) {
      rows = [];
      return new Promise((resolve, reject) => {
        waiter = [resolve, reject];
        const text = Buffer.from(`${sql}\0`);
        sock.write(Buffer.concat([Buffer.from('Q'), int32(text.length + 4), text]));
      });
    },
    close() { sock.destroy(); },
  };
}

/** A Redis connection on 127.0.0.1:port: `command('GET', 'k')` resolves with its reply. */
export async function redis(port) {
  const sock = await connect(port);
  let buffer = '';
  const waiting = [];
  sock.on('error', () => undefined);
  sock.setEncoding('utf8');
  sock.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const end = buffer.indexOf('\r\n');
      if (end < 0) return;
      const head = buffer.slice(0, end);
      let reply;
      let used = end + 2;
      if (head[0] === '$') {
        const size = Number(head.slice(1));
        if (size < 0) reply = null;
        else {
          if (buffer.length < used + size + 2) return;
          reply = buffer.slice(used, used + size);
          used += size + 2;
        }
      } else if (head[0] === ':') reply = Number(head.slice(1));
      else reply = head.slice(1);
      buffer = buffer.slice(used);
      const w = waiting.shift();
      if (head[0] === '-') w?.[1](Error(reply)); else w?.[0](reply);
    }
  });
  return {
    command(...args) {
      return new Promise((resolve, reject) => {
        waiting.push([resolve, reject]);
        sock.write(`*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(String(a))}\r\n${a}\r\n`).join('')}`);
      });
    },
    close() { sock.destroy(); },
  };
}

/** Tries until the server answers: a service is reachable a moment after its container starts. */
export async function retry(open, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) {
    try { return await open(); } catch (e) {
      if (Date.now() > end) throw e;
      await new Promise((done) => setTimeout(done, 200));
    }
  }
}
