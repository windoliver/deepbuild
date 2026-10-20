import { createHash } from 'node:crypto';
import { ContractError, issue } from './errors.js';
import { readJson, type JsonValue } from './json.js';

/**
 * RFC 8785 (JCS) text. Keys sort by UTF-16 code units, which is what `Array.prototype.sort` compares,
 * and numbers and strings print as ECMAScript's JSON.stringify prints them, as the RFC specifies.
 */
export function canonicalText(value: JsonValue): string {
  return text(plainJson(value));
}

/** The plain copy `readJson` reads, or a ContractError `not_json` where it isn't JSON. */
export function plainJson(value: unknown): JsonValue {
  let read: ReturnType<typeof readJson>;
  try {
    read = readJson(value);
  } catch {
    // A getter or a proxy that throws: the value can't be read as JSON.
    read = { path: '', value };
  }
  if ('json' in read) return read.json;
  throw new ContractError(issue('not_json', read.path, read.value));
}

// Over a plain copy only, which nothing else can read or change.
const text = (value: JsonValue): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(text).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${text(value[key]!)}`).join(',')}}`;
};

export const canonicalize = (value: JsonValue): Uint8Array => new TextEncoder().encode(canonicalText(value));
export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
