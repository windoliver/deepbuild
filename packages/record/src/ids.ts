// Event identity, without the record's database, schemas or projections. Socket clients use this public subpath.
import { randomBytes } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A ULID at an integer millisecond: 48 bits of time and 80 bits of entropy (20 hex digits, or fresh randomness). */
export function ulid(ms: number, hex = randomBytes(10).toString('hex')): string {
  let out = '';
  let time = BigInt(ms);
  for (let i = 0; i < 10; i++) { out = CROCKFORD[Number(time & 31n)] + out; time >>= 5n; }
  let random = BigInt(`0x${hex}`);
  let tail = '';
  for (let i = 0; i < 16; i++) { tail = CROCKFORD[Number(random & 31n)] + tail; random >>= 5n; }
  return out + tail;
}
/** The timestamp of an already validated ULID, in milliseconds. */
export function ulidTime(id: string): number {
  return [...id.slice(0, 10)].reduce((ms, c) => ms * 32 + CROCKFORD.indexOf(c), 0);
}
