import { createHash } from 'node:crypto';
import type { JsonValue } from './json.js';

/**
 * RFC 8785 (JCS) text. Keys sort by UTF-16 code units, which is what `Array.prototype.sort` compares,
 * and numbers and strings print as ECMAScript's JSON.stringify prints them, as the RFC specifies.
 */
export function canonicalText(value: JsonValue): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw TypeError(`RFC 8785 has no form for ${value}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalText).join(',')}]`;
  if (typeof value !== 'object') throw TypeError(`not a JSON value: ${typeof value}`);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalText(value[key]!)}`).join(',')}}`;
}

export const canonicalize = (value: JsonValue): Uint8Array => new TextEncoder().encode(canonicalText(value));
export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
