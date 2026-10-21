// JSON Pointer reads and copies over plain JSON values.
import type { JsonValue } from '@deepbuild/contracts';
import { isObject } from './types.js';

export const segment = (key: string | number): string => `/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
export const segments = (pointer: string): string[] => (pointer === '' ? [] : pointer.slice(1).split('/').map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')));

export function getAt(value: JsonValue | undefined, pointer: string): JsonValue | undefined {
  let node: JsonValue | undefined = value;
  for (const key of segments(pointer)) {
    if (Array.isArray(node)) node = node[Number(key)];
    else if (isObject(node)) node = Object.hasOwn(node, key) ? node[key] : undefined;
    else return undefined;
  }
  return node;
}

/** A deep copy with the member at `pointer` replaced, or added to its parent object. */
export function setAt(value: JsonValue, pointer: string, next: JsonValue): JsonValue {
  const keys = segments(pointer);
  const last = keys.pop();
  if (last === undefined) return structuredClone(next);
  const copy = structuredClone(value);
  const parent = getAt(copy, keys.map(segment).join(''));
  if (Array.isArray(parent)) parent[Number(last)] = next;
  else if (isObject(parent)) parent[last] = next;
  else throw Error(`no parent at ${pointer}`);
  return copy;
}

/** A deep copy without the member at `pointer`. */
export function deleteAt(value: JsonValue, pointer: string): JsonValue {
  const keys = segments(pointer);
  const last = keys.pop();
  const copy = structuredClone(value);
  const parent = getAt(copy, keys.map(segment).join(''));
  if (last !== undefined && isObject(parent)) delete parent[last];
  return copy;
}
