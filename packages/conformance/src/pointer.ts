// JSON Pointer reads over plain JSON values.
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
