// Test-side tools for the blind redraft of #306's AC3 tests after #1958 (REDRAFT.md). Everything that drives the
// binary is #306's own helpers, imported unchanged: `deep-show` built per build set, the scenario, the test packs, the
// board, the calls and the reply readers. What this folder adds are the readers of what #1958's open gives and #306's
// readers don't take: a `pack_missing` that may come as a notice (severity `notice`) or a `blocked` row rather than an
// error, an `expansions` row looked up without requiring the field, and a reply's one snapshot hash. Nothing here
// stands in for the store, the loader, the check or the draw.

import { arr, canon, isObject, obj, str, type JsonObject, type JsonValue } from '../306/helpers.ts';

export * from '../306/helpers.ts';

/** One `pack_missing` entry, wherever the reply carries it: its `ids` and its whole JSON. */
export interface Missing { where: string; ids: string[]; raw: JsonObject }

/** Every `pack_missing` a reply carries among its `notices`, its `issues` and its `blocked` rows, any severity. */
export function packMissing(reply: JsonObject, what = 'the reply'): Missing[] {
  const out: Missing[] = [];
  for (const where of ['notices', 'issues', 'blocked'] as const) {
    arr(reply[where] ?? [], `${what}: ${where}`).forEach((v, i) => {
      const o = obj(v, `${what}: ${where}[${i}]`);
      if (o['code'] !== 'pack_missing') return;
      out.push({ where, ids: Array.isArray(o['ids']) ? o['ids'].map(String) : [], raw: o });
    });
  }
  return out;
}

/** Whether a value's canonical JSON text holds `needle` (a pack ID, a version). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => canon(value).includes(needle);

/** The `expansions` row of one instance, or undefined when the reply has none (or no `expansions` at all). */
export function expansionRow(reply: JsonObject, instance: string): JsonObject | undefined {
  const rows = Array.isArray(reply['expansions']) ? reply['expansions'] : [];
  return rows.find((e) => isObject(e) && e['instance'] === instance) as JsonObject | undefined;
}

/** The reply's one snapshot sha256, or '' when it carries none or more than one. */
export function shot(reply: JsonObject, what: string): string {
  const shots = Array.isArray(reply['snapshots']) ? reply['snapshots'] : [];
  if (shots.length !== 1) return '';
  return str(obj(shots[0], `${what}: snapshots[0]`)['sha256'], `${what}: the snapshot's sha256`);
}

/** An item as it was sent, from a stored document: the stored item less the `layer` the hub stamps on it. */
export function asSent(item: JsonValue | undefined, what: string): JsonObject {
  const { layer: _layer, ...rest } = obj(item, what);
  return rest;
}
