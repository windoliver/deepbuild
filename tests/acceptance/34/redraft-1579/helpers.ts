// The blind redraft's own tools (README). What changed is only how a paired device signs: per the design (Socket
// roles and contract versions, The trusted path is a device you paired) a call carries
// `signature: {signed: {device, method, hub, at, once, params}, sig}` beside its params. Everything else (the hub,
// the asks, the OS stand-in, pairing, the judges) is the earlier suite's ../helpers.ts, imported as it is.
import { createHash, randomBytes, sign } from 'node:crypto';
import net from 'node:net';
import { join } from 'node:path';
import { canonicalize, type JsonValue } from '../../../../packages/contracts/src/index.ts';
import type { Conn, Device, Line, Plant } from '../helpers.ts';

/** The hub's ID, as the hub's hello on this connection names it (`hub`). */
export function hubOf(conn: Conn): string {
  const id = conn.hello?.hub;
  if (typeof id !== 'string' || !id) throw Error(`BLOCKED: setup: the hub's hello names no hub ID: ${JSON.stringify(conn.hello)}`);
  return id;
}

/** Lower-case hex SHA-256 of the RFC 8785 bytes of the call's params, `signature` left out. */
export function paramsHash(params: Line): string {
  const { signature: _s, ...rest } = params;
  return createHash('sha256').update(canonicalize(rest as JsonValue)).digest('hex');
}

/**
 * The call's params with a paired device's signature in the design's shape: `signed` names the device, the method,
 * the hub's ID, the time in ms since the epoch, a fresh once-only ID (16 random bytes, 22 base64url characters) and
 * the params' hash; `sig` is Ed25519 over the RFC 8785 bytes of `signed`, base64url. `as.id` signs as another device
 * ID than the one `device` was paired as.
 */
export function signed(params: Line, device: Device, hub: string, as: { id?: string; method?: string } = {}): Line {
  const { signature: _s, ...body } = params;
  const what = {
    device: as.id ?? device.id ?? '',
    method: as.method ?? 'ask.answer',
    hub,
    at: Date.now(),
    once: randomBytes(16).toString('base64url'),
    params: paramsHash(body),
  };
  const sig = sign(null, canonicalize(what as JsonValue), device.key).toString('base64url');
  return { ...body, signature: { signed: what, sig } };
}

/**
 * "A hub that counts one carrying only the control token" (AC2's wrong program): the real hub behind a socket that
 * holds a paired key and signs, in the design's format, every `ask.answer` that comes without a signature, taking
 * the hub's ID from the real hub's hello as a client would.
 */
export function tokenOnlySigner(dir: string, target: string, device: Device): Promise<Plant> {
  const path = join(dir, 'sign.sock');
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const hub = net.connect(target);
    sockets.add(client); sockets.add(hub);
    let hubId = '';
    const lines = (from: net.Socket, each: (line: string) => void) => {
      let buffer = '';
      from.setEncoding('utf8').on('data', (d: string) => {
        buffer += d;
        let i: number;
        while ((i = buffer.indexOf('\n')) >= 0) { each(buffer.slice(0, i + 1)); buffer = buffer.slice(i + 1); }
      });
    };
    lines(hub, (line) => {
      const parsed = safeParse(line);
      if (!hubId && parsed?.hello === 'deep-hub' && typeof parsed.hub === 'string') hubId = parsed.hub;
      if (!client.destroyed) client.write(line);
    });
    lines(client, (line) => {
      const parsed = safeParse(line);
      let out = line;
      if (parsed?.method === 'ask.answer' && parsed.params && !parsed.params.signature) {
        const { device: _d, ...params } = parsed.params as Line;
        out = `${JSON.stringify({ ...parsed, params: signed(params, device, hubId) })}\n`;
      }
      if (!hub.destroyed) hub.write(out);
    });
    client.on('error', () => hub.destroy()); hub.on('error', () => client.destroy());
    client.on('close', () => hub.end()); hub.on('close', () => client.end());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve({ path, close: () => new Promise((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); }) }));
  });
}
function safeParse(line: string): Line | undefined {
  try { return JSON.parse(line) as Line; } catch { return undefined; }
}
