// A job's only way out of its sandbox, whose egress filter names no outside host. A job's agent calls its own
// model API with its own sign-in (design: an agent's calls to its model provider aren't capability calls), so this
// is a plain CONNECT tunnel on a port of this machine: it reads the host and port a job asks for, refuses any its
// agent doesn't name, and passes the TLS bytes through unread. Behind a proxy of yours (an http:// HTTPS_PROXY in
// the hub's environment), it asks that proxy for the same tunnel; one it can't use is refused, never gone around.
import net from 'node:net';

export interface Forwarder {
  port: number;
  close(): Promise<void>;
}

/** The most a CONNECT request's head may hold. */
const HEAD_MAX = 8192;

export async function openForwarder(allowed: ReadonlySet<string>, upstream?: string): Promise<Forwarder> {
  const via = upstream && /^http:\/\/[^/@]+(:\d+)?\/?$/.test(upstream) ? new URL(upstream) : undefined;
  // Never the value itself, which may hold a password.
  if (upstream && !via) throw Error("your HTTPS_PROXY isn't a plain http://host:port proxy, the only kind the forwarder can use, and a job never goes around it");
  const open = new Set<net.Socket>();
  const track = (s: net.Socket): net.Socket => { open.add(s); s.on('close', () => open.delete(s)); return s; };
  // A client may send its CONNECT and close its side at once: its side's end is passed on only through the tunnel.
  const server = net.createServer({ allowHalfOpen: true }, (client) => {
    track(client);
    let head = Buffer.alloc(0);
    const refuse = (status: string): void => { client.end(`HTTP/1.1 ${status}\r\n\r\n`); };
    const onData = (chunk: Buffer): void => {
      head = Buffer.concat([head, chunk]);
      const end = head.indexOf('\r\n\r\n');
      if (end < 0) { if (head.length > HEAD_MAX) { client.off('data', onData); refuse('431 Request Header Fields Too Large'); } return; }
      client.off('data', onData);
      client.pause();
      const target = /^CONNECT ([A-Za-z0-9.-]+:\d+) HTTP\/1\.[01]\r\n/.exec(head.subarray(0, end + 2).toString('latin1'))?.[1]?.toLowerCase();
      if (!target || !allowed.has(target)) { refuse('403 Forbidden'); return; }
      const rest = head.subarray(end + 4);
      const [host, port] = [target.slice(0, target.lastIndexOf(':')), Number(target.slice(target.lastIndexOf(':') + 1))];
      const out = track(via ? net.connect(Number(via.port || 80), via.hostname) : net.connect(port, host));
      const joined = (early?: Buffer): void => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (early?.length) client.write(early);
        if (rest.length) out.write(rest);
        client.pipe(out).pipe(client);
        client.resume();
      };
      out.on('error', () => { if (!client.destroyed) refuse('502 Bad Gateway'); });
      client.on('error', () => out.destroy());
      // One side's end ends the other once what it wrote is out.
      out.on('close', () => client.end());
      client.on('close', () => out.end());
      if (!via) { out.once('connect', () => joined()); return; }
      out.once('connect', () => out.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
      let reply = Buffer.alloc(0);
      const onReply = (c: Buffer): void => {
        reply = Buffer.concat([reply, c]);
        const at = reply.indexOf('\r\n\r\n');
        if (at < 0) { if (reply.length > HEAD_MAX) out.destroy(); return; }
        out.off('data', onReply);
        if (!/^HTTP\/1\.[01] 200/.test(reply.toString('latin1'))) { refuse('502 Bad Gateway'); out.destroy(); return; }
        joined(reply.subarray(at + 4));
      };
      out.on('data', onReply);
    };
    client.on('data', onData);
    client.on('error', () => undefined);
  });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => done()); });
  return {
    port: (server.address() as net.AddressInfo).port,
    close: () => new Promise<void>((done) => { for (const s of open) s.destroy(); server.close(() => done()); }),
  };
}
