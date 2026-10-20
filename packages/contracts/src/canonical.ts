import { createHash } from 'node:crypto';
import { ContractError, issue } from './errors.js';
import { notJson, type JsonValue } from './json.js';

/**
 * RFC 8785 (JCS) text. Keys sort by UTF-16 code units, which is what `Array.prototype.sort` compares,
 * and numbers and strings print as ECMAScript's JSON.stringify prints them, as the RFC specifies.
 */
export function canonicalText(value: JsonValue): string {
  let found: ReturnType<typeof notJson>;
  let out = '';
  try {
    found = notJson(value);
    if (!found) out = text(value);
  } catch {
    // A getter or a proxy that throws: the value can't be read as JSON.
    found = { path: '', value };
  }
  if (found) throw new ContractError(issue('not_json', found.path, found.value));
  return out;
}

const text = (value: JsonValue): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(text).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${text(value[key]!)}`).join(',')}}`;
};

export const canonicalize = (value: JsonValue): Uint8Array => new TextEncoder().encode(canonicalText(value));
export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
