// A key of one's own (#1338): the hub's, which names it to every client before any credential is sent, and each
// client's, which a credential is bound to. Each is an Ed25519 key with a self-signed certificate, made here with
// node:crypto alone, so mutual TLS proves both: the hub's certificate is pinned by its ID, and a client's handshake
// signature proves it holds the key its credential names. An ID is the SHA-256 of the certificate's DER bytes.
import { createHash, generateKeyPairSync, sign, X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Identity { key: string; cert: string; id: string }

const length = (n: number): Buffer => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]));
const tlv = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const seq = (...parts: Buffer[]): Buffer => tlv(0x30, ...parts);
const ED25519 = seq(Buffer.from([0x06, 0x03, 0x2b, 0x65, 0x70]));
const name = (cn: string): Buffer => seq(tlv(0x31, seq(Buffer.from([0x06, 0x03, 0x55, 0x04, 0x03]), tlv(0x0c, Buffer.from(cn)))));
const time = (ms: number): Buffer => tlv(0x18, Buffer.from(`${new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`));

/** A certificate's ID, and so its key's: what a pin, an invite and a credential's binding name. */
export const idOf = (cert: X509Certificate): string => createHash('sha256').update(cert.raw).digest('hex');

/** A new Ed25519 key and its self-signed X.509 v3 certificate, good for 100 years: only its key is ever checked. */
function made(cn: string): Identity {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const now = Date.now();
  const tbs = seq(tlv(0xa0, tlv(0x02, Buffer.from([2]))), tlv(0x02, Buffer.from([1])), ED25519, name(cn), seq(time(now - 86_400_000), time(now + 100 * 365 * 86_400_000)), name(cn), spki);
  const der = seq(tbs, ED25519, tlv(0x03, Buffer.from([0]), sign(null, tbs, privateKey)));
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, cert, id: createHash('sha256').update(der).digest('hex') };
}

/** The key at `file` (its certificate beside it, `<file>.cert`), made once, readable only by you. */
export function identityAt(file: string, cn: string): Identity {
  if (existsSync(file) && existsSync(`${file}.cert`)) {
    const cert = readFileSync(`${file}.cert`, 'utf8');
    return { key: readFileSync(file, 'utf8'), cert, id: idOf(new X509Certificate(cert)) };
  }
  const fresh = made(cn);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  for (const [path, text] of [[`${file}.cert`, fresh.cert], [file, fresh.key]] as const) {
    writeFileSync(`${path}.${process.pid}`, text, { mode: 0o600 });
    renameSync(`${path}.${process.pid}`, path);
  }
  return fresh;
}
