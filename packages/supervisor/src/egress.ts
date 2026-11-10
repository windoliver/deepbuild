// A run's credential stand-ins (#1106). A credential the environment gives hosts reaches the run's processes only as
// a random token; the run's egress filter, the one way out its sandbox grants, ends their TLS with a certificate
// authority made for this run alone, trusted only through the variables the run is given, and puts the value in place
// of the stand-in in one request header, only on HTTPS requests to the credential's own hosts and methods. A stand-in
// anywhere else (the URL, the body, a routing header, twice, another host) is refused, and the refusal is reported.
import { createHash, createPublicKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { isIP, type AddressInfo, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as tlsConnect, createSecureContext, TLSSocket, type SecureContext } from 'node:tls';

/** A credential as the run takes it: by value with no hosts, else by stand-in. */
interface Credential { env: string; value: string; hosts?: string[]; methods?: string[] }
/** What the filter refused: the sandbox's word for it, and where, never the value or the stand-in. */
interface Refusal { operation: string; target: string }
export interface Egress {
  port: number;
  /** The folder holding the run CA's certificate (never its key): the run reads it. */
  dir: string;
  /** Each stand-in by its variable. */
  standIns: Record<string, string>;
  /** The variables that send the run's HTTPS through the filter and trust the run CA, inside the run alone. */
  env: Record<string, string>;
  close(): Promise<void>;
}
/** Tests only: the planted filter that substitutes a stand-in on every allowed host. */
type EgressPlant = 'standin-every-host';

/** Headers that steer where a request goes or say where it came from: a stand-in there could be logged or bounced elsewhere. */
const ROUTING = /^(host|forwarded|via|referer|origin|x-forwarded-.*|x-original-.*|x-rewrite-url|x-host|x-http-method-override)$/i;
/** Hop-by-hop headers, not passed on; the body is sent whole with its length. */
const HOP = /^(connection|keep-alive|proxy-.*|te|trailer|transfer-encoding|upgrade|content-length)$/i;
/** The most a request body may hold: it is read whole before anything is sent on. */
const BODY_MAX = 64 * 1024 * 1024;

// ---- The run CA: X.509 in DER, by hand, so no dependency makes the certificates (ECDSA P-256, SHA-256).

const der = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  const n = body.length;
  const len = n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255];
  return Buffer.concat([Buffer.from([tag, ...len]), body]);
};
const seq = (...p: Buffer[]): Buffer => der(0x30, ...p);
const int = (b: Buffer): Buffer => der(0x02, b[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
const oid = (s: string): Buffer => {
  const [a, b, ...rest] = s.split('.').map(Number);
  const out = [40 * a! + b!];
  for (let n of rest) {
    const v = [n & 127];
    while ((n >>= 7)) v.unshift((n & 127) | 128);
    out.push(...v);
  }
  return der(0x06, Buffer.from(out));
};
const bits = (b: Buffer, unused = 0): Buffer => der(0x03, Buffer.from([unused]), b);
const name = (cn: string): Buffer => seq(der(0x31, seq(oid('2.5.4.3'), der(0x0c, Buffer.from(cn)))));
const utc = (t: number): Buffer => der(0x17, Buffer.from(`${new Date(t).toISOString().slice(2, 19).replace(/[-T:]/g, '')}Z`));
const ext = (id: string, critical: boolean, value: Buffer): Buffer => seq(oid(id), ...(critical ? [der(0x01, Buffer.from([0xff]))] : []), der(0x04, value));
const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));
const keyId = (key: KeyObject): Buffer => createHash('sha1').update(key.export({ type: 'spki', format: 'der' })).digest();

/** An IPv4 or IPv6 address's bytes. */
function ipBytes(ip: string): Buffer {
  if (isIP(ip) === 4) return Buffer.from(ip.split('.').map(Number));
  const [head, tail] = ip.includes('::') ? ip.split('::') : [ip, undefined];
  const groups = (t: string | undefined) => (t ? t.split(':') : []);
  const all = tail === undefined ? groups(head) : [...groups(head), ...Array<string>(8 - groups(head).length - groups(tail).length).fill('0'), ...groups(tail)];
  return Buffer.concat(all.map((g) => { const b = Buffer.alloc(2); b.writeUInt16BE(parseInt(g, 16)); return b; }));
}

/** A certificate for `subject`'s key, signed by `issuer`: the CA itself when `names` is unset, else a server certificate for those names. */
function certificate(subject: KeyObject, issuer: { key: KeyObject; id: Buffer }, names?: string[]): string {
  const host = names?.[0];
  const now = Date.now();
  const id = keyId(subject);
  const serial = randomBytes(16);
  // Positive, and its first byte never zero, so DER's minimal integer holds every byte.
  serial[0] = (serial[0]! & 0x7f) | 0x40;
  const exts = host === undefined
    ? [ext('2.5.29.19', true, seq(der(0x01, Buffer.from([0xff])))), ext('2.5.29.15', true, bits(Buffer.from([0x06]), 1))]
    : [
      ext('2.5.29.19', true, seq()),
      ext('2.5.29.15', true, bits(Buffer.from([0x80]), 7)),
      ext('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),
      ext('2.5.29.17', false, seq(...names!.map((n) => (isIP(n) ? der(0x87, ipBytes(n)) : der(0x82, Buffer.from(n)))))),
      ext('2.5.29.35', false, seq(der(0x80, issuer.id))),
    ];
  const tbs = seq(
    der(0xa0, int(Buffer.from([2]))), int(serial), ECDSA_SHA256,
    name('DeepBuild run CA'), seq(utc(now - 3_600_000), utc(now + 30 * 86_400_000)), name(host ?? 'DeepBuild run CA'),
    subject.export({ type: 'spki', format: 'der' }),
    der(0xa3, seq(ext('2.5.29.14', false, der(0x04, id)), ...exts)),
  );
  const cert = seq(tbs, ECDSA_SHA256, bits(sign('sha256', tbs, issuer.key)));
  return `-----BEGIN CERTIFICATE-----\n${cert.toString('base64').replace(/.{1,64}/g, '$&\n')}-----END CERTIFICATE-----\n`;
}

// ---- The filter.

/** "Host" or "host:port" as `host:port`, lower-case, 443 when unnamed. */
function hostPort(h: string): string {
  const m = /^\[?([^\]]+?)\]?(?::(\d{1,5}))?$/.exec(h.trim().toLowerCase());
  return m ? `${m[1]}:${m[2] ?? '443'}` : h;
}

/** Counts `needle` in `hay`. */
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

/**
 * Opens the run's egress filter on a port of this machine, its CA's certificate written to a folder the run reads.
 * `refused` hears each refusal. Its own calls upstream trust what the hub's process trusts.
 */
export async function openEgress(credentials: Credential[], refused: (r: Refusal) => void, plant?: EgressPlant): Promise<Egress> {
  const ca = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const issuer = { key: ca.privateKey, id: keyId(ca.publicKey) };
  const caPem = certificate(ca.publicKey, issuer);
  const leaf = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const leafKey = leaf.privateKey.export({ type: 'pkcs8', format: 'pem' });
  // Each host's certificate carries the names the host's own certificate does, so the app checks it as it would the
  // host's; the host's certificate is checked first against what the hub trusts, and one that fails is refused.
  const contexts = new Map<string, Promise<SecureContext>>();
  const contextFor = (target: string): Promise<SecureContext> => {
    let c = contexts.get(target);
    if (!c) {
      const host = target.slice(0, target.lastIndexOf(':'));
      c = new Promise<string[]>((done, fail) => {
        const probe = tlsConnect({ host, port: Number(target.slice(target.lastIndexOf(':') + 1)), ...(isIP(host) ? {} : { servername: host }), ALPNProtocols: ['http/1.1'], timeout: 10_000 }, () => {
          const alt = probe.getPeerCertificate().subjectaltname ?? '';
          probe.destroy();
          done([...new Set([host, ...alt.split(', ').flatMap((n) => { const m = /^(DNS|IP Address):(.+)$/.exec(n); return m ? [m[2]!] : []; })])]);
        });
        probe.on('error', fail);
        probe.on('timeout', () => probe.destroy(Error(`no TLS answer from ${target}`)));
      }).then((names) => createSecureContext({ key: leafKey, cert: certificate(createPublicKey(leafKey), issuer, names) }));
      contexts.set(target, c);
      c.catch(() => contexts.delete(target));
    }
    return c;
  };
  const dir = mkdtempSync(join(tmpdir(), 'deep-egress-'));
  const caFile = join(dir, 'run-ca.pem');
  writeFileSync(caFile, caPem, { mode: 0o644 });

  const held = credentials.filter((c) => c.hosts?.length).map((c) => ({
    ...c, standIn: `deep_standin_${randomBytes(20).toString('hex')}`, hosts: new Set(c.hosts!.map(hostPort)),
    methods: c.methods?.length ? new Set(c.methods.map((m) => m.toUpperCase())) : undefined,
  }));
  const allowed = new Set(held.flatMap((c) => [...c.hosts]));
  const targets = new WeakMap<Socket, string>();
  const open = new Set<Socket>();
  const track = (s: Socket): void => { open.add(s); s.on('close', () => open.delete(s)); };

  const inner = http.createServer((req, res) => {
    const target = targets.get(req.socket)!;
    const deny = (operation: string, env: string): void => {
      refused({ operation, target: `${env} to https://${target}` });
      res.writeHead(403, { 'content-type': 'text/plain', connection: 'close' }).end(`DeepBuild's egress filter refused this request: ${operation.replace(/-/g, ' ')} (${env})\n`);
    };
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size <= BODY_MAX) chunks.push(c); });
    req.on('end', () => {
      if (size > BODY_MAX) { res.writeHead(413, { connection: 'close' }).end(); return; }
      const body = Buffer.concat(chunks);
      const headers = [...req.rawHeaders];
      const text = body.toString('latin1');
      for (const c of held) {
        if (count(req.url ?? '', c.standIn)) return deny('stand-in-in-url', c.env);
        if (count(text, c.standIn)) return deny('stand-in-in-body', c.env);
        let seen = 0;
        let at = -1;
        for (let i = 0; i < headers.length; i += 2) {
          const n = count(headers[i + 1]!, c.standIn) + count(headers[i]!, c.standIn);
          if (!n) continue;
          if (ROUTING.test(headers[i]!)) return deny('stand-in-in-routing-header', c.env);
          seen += n;
          at = i + 1;
        }
        if (!seen) continue;
        if (seen > 1) return deny('stand-in-twice', c.env);
        if (!c.hosts.has(target) && plant !== 'standin-every-host') return deny('stand-in-to-other-host', c.env);
        if (c.methods && !c.methods.has(req.method ?? '')) return deny('stand-in-method', c.env);
        headers[at] = headers[at]!.replace(c.standIn, () => c.value);
      }
      const out: string[] = [];
      for (let i = 0; i < headers.length; i += 2) if (!HOP.test(headers[i]!)) out.push(headers[i]!, headers[i + 1]!);
      if (body.length || req.headers['content-length'] !== undefined) out.push('content-length', String(body.length));
      const host = target.slice(0, target.lastIndexOf(':'));
      const upstream = https.request({ host, port: Number(target.slice(target.lastIndexOf(':') + 1)), servername: isIP(host) ? undefined : host, method: req.method, path: req.url, headers: out, agent: false }, (answer) => {
        const back: string[] = [];
        for (let i = 0; i < answer.rawHeaders.length; i += 2) if (!/^(connection|keep-alive|transfer-encoding)$/i.test(answer.rawHeaders[i]!)) back.push(answer.rawHeaders[i]!, answer.rawHeaders[i + 1]!);
        res.writeHead(answer.statusCode ?? 502, back);
        answer.pipe(res);
      });
      upstream.on('error', (e) => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }).end(`DeepBuild's egress filter couldn't reach ${target}: ${e.message}\n`); else res.destroy(); });
      upstream.end(body);
    });
  });

  const server = http.createServer((req, res) => {
    // Plain HTTP carries no stand-in out, and goes nowhere: the filter takes HTTPS tunnels to the credentials' hosts.
    const where = (() => { try { return hostPort(new URL(req.url ?? '').host); } catch { return req.headers.host ?? '(none)'; } })();
    refused({ operation: 'egress-plain-http', target: where });
    res.writeHead(403, { connection: 'close' }).end();
  });
  server.on('connect', (req: http.IncomingMessage, socket: Socket, head: Buffer) => {
    track(socket);
    socket.on('error', () => undefined);
    const target = hostPort(req.url ?? '');
    if (!allowed.has(target)) {
      refused({ operation: 'egress-host', target });
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    socket.pause();
    contextFor(target).then((secureContext) => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) socket.unshift(head);
      const tls = new TLSSocket(socket, { isServer: true, secureContext, ALPNProtocols: ['http/1.1'] });
      tls.on('error', () => socket.destroy());
      targets.set(tls, target);
      track(tls);
      inner.emit('connection', tls);
      socket.resume();
    }, (e: Error) => socket.end(`HTTP/1.1 502 Bad Gateway\r\ncontent-type: text/plain\r\n\r\nDeepBuild's egress filter couldn't reach ${target}: ${e.message}\n`));
  });
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => done()); });
  const port = (server.address() as AddressInfo).port;
  const proxy = `http://127.0.0.1:${port}`;
  return {
    port, dir,
    standIns: Object.fromEntries(held.map((c) => [c.env, c.standIn])),
    env: {
      HTTPS_PROXY: proxy, https_proxy: proxy, NODE_USE_ENV_PROXY: '1',
      NODE_EXTRA_CA_CERTS: caFile, SSL_CERT_FILE: caFile, CURL_CA_BUNDLE: caFile, REQUESTS_CA_BUNDLE: caFile,
    },
    close: () => new Promise<void>((done) => {
      for (const s of open) s.destroy();
      inner.close();
      server.close(() => { rmSync(dir, { recursive: true, force: true }); done(); });
    }),
  };
}
