// The one test-side tool this redraft adds (README): a paired device's signature in the design's current format
// (#1579; docs/technical-design.md, Threats, "The trusted path is a device you paired"):
//
//   signature: {signed: {device, method, hub, at, once, params}, sig}
//
// `method` the method called, `hub` the ID the hub's hello names, `at` milliseconds since the epoch, `once` 16 to 128
// base64url characters the device never uses again, `params` the lower-case hex SHA-256 of the RFC 8785 bytes of the
// call's params with `signature` left out, and `sig` Ed25519 over the RFC 8785 bytes of `signed`, in base64url.
//
// It replaces #34's `signed()` (tests/acceptance/34/helpers.ts), which put `device` and a bare signature among the
// params. The RFC 8785 serializer is written here rather than taken from the implementation, so the bytes signed are
// the design's and not whatever the hub's own canonicalizer makes of them. Nothing here answers an ask or verifies a
// signature: that is the hub's.

import { createHash, randomBytes, sign } from 'node:crypto';
import type { Device, Obj } from '../helpers.ts';

/**
 * RFC 8785 (JCS) for the JSON this test signs: object members sorted by their UTF-16 code units, no whitespace,
 * strings and numbers as ECMAScript's JSON.stringify writes them (RFC 8785 sections 3.2.2 and 3.2.3 adopt exactly
 * that serialization), and members whose value is undefined left out as JSON leaves them out.
 */
export function jcs(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : jcs(v))).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const o = value as Obj;
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(o[k])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error(`RFC 8785 has no form for ${value}`);
  return JSON.stringify(value);
}

/** The fields a device signs, as the design names them. */
export interface Signed { device: string; method: string; hub: string; at: number; once: string; params: string }

/**
 * A call's params with the device's signature for `method` on hub `hub`: the params as they are, plus
 * `signature: {signed, sig}`. `at` defaults to now and `once` to 32 fresh base64url characters.
 */
export function signedFor(method: string, params: Obj, device: Device, hub: string, o: { at?: number; once?: string } = {}): Obj {
  const { signature: _left_out, ...body } = params;
  const signed: Signed = {
    device: device.id ?? '',
    method,
    hub,
    at: o.at ?? Date.now(),
    once: o.once ?? randomBytes(24).toString('base64url'),
    params: createHash('sha256').update(Buffer.from(jcs(body), 'utf8')).digest('hex'),
  };
  const sig = sign(null, Buffer.from(jcs(signed), 'utf8'), device.key).toString('base64url');
  return { ...body, signature: { signed, sig } };
}
