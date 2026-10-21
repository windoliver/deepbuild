// What the slot kits share: a stable text for comparing JSON answers, random words for the seeded parts, and
// the shape refusal a case raises when a fill's answer isn't even the right kind of value.
import type { JsonValue } from '@deepbuild/contracts';
import type { Random } from '../generator.js';
import { Finding } from '../slot-types.js';
import { isObject } from '../types.js';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
/** A lower-case word of `length` letters. */
export const word = (random: Random, length: number): string => Array.from({ length }, () => LETTERS[random.int(0, 25)]!).join('');

const sorted = (v: unknown): unknown => (Array.isArray(v) ? v.map(sorted) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
/** A stable text for a JSON value: keys sorted, so two answers compare as values. */
export const canonical = (value: unknown): string => JSON.stringify(sorted(value)) ?? 'undefined';
export const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);

/** A refusal of an answer's shape, in error@1's closed codes: `what` is the answer or member refused. */
export const shape = (what: string, code: 'type' | 'required' | 'enum' | 'unlisted_field', actual: unknown): Finding =>
  new Finding('FAIL', `${what} refused: ${code} (${JSON.stringify(actual) ?? String(actual)})`, [code]);

/** The answer as a plain object, or the shape refusal. */
export function object(what: string, value: unknown): { [k: string]: unknown } {
  if (!isObject(value as JsonValue)) throw shape(what, 'type', value);
  return value as { [k: string]: unknown };
}
export function text(what: string, value: unknown): string {
  if (typeof value !== 'string') throw shape(what, 'type', value);
  return value;
}
export function list(what: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) throw shape(what, 'type', value);
  return value;
}
