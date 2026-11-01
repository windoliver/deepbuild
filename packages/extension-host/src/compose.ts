// Composition (#103): the rules the host wires edges by, as data in and data out. A use matches a provider only when
// its `name@major` is the provider's, the provider's minor is the use's or a later one, and the digest the provider
// keeps for the use's minor is the use's; any other difference is named by the first schema path that differs. A
// reading reaches its user at the minor the use was built against, and the graph of edges has no cycle.

/** A `uses` row of a manifest, with extension.compose@1's fields beside it. */
export interface UseRow { interface: string; minor?: number; digest?: string; schema?: unknown; from?: string; optional?: boolean }
/** A `provides` row of a manifest, with extension.compose@1's fields beside it. */
export interface ProvideRow { interface: string; kind: string; minor?: number; schema?: unknown; digests?: Record<string, string>; adapter?: { from: string } }
/** A piece as composition reads it: its id and its manifest's rows. */
export interface Piece { id: string; provides: ProvideRow[]; uses: UseRow[] }

/** Annotations a frozen digest leaves out, so a reworded description is no difference. */
const ANNOTATIONS = new Set(['title', 'description', 'examples', '$comment']);
const base = (iface: string): string => iface.slice(0, iface.lastIndexOf('@'));
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const pointer = (key: string): string => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** The first JSON Pointer at which two schemas differ, the use's keys first in their own order; null when they don't. */
export function firstDiff(a: unknown, b: unknown, at = ''): string | null {
  if (isObject(a) && isObject(b)) {
    const keys = [...Object.keys(a), ...Object.keys(b).filter((k) => !(k in a))].filter((k) => !ANNOTATIONS.has(k));
    for (const k of keys) {
      if (!(k in a) || !(k in b)) return `${at}/${pointer(k)}`;
      const found = firstDiff(a[k], b[k], `${at}/${pointer(k)}`);
      if (found !== null) return found;
    }
    return null;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length) return `${at}/${i}`;
      const found = firstDiff(a[i], b[i], `${at}/${i}`);
      if (found !== null) return found;
    }
    return null;
  }
  return a === b ? null : at || '/';
}

/**
 * Why a provider's row doesn't serve a use, as the first schema path that differs, or null when it does. A row that
 * keeps no digests (a manifest from before #103) is held to its name and minor alone. `namesAlone` is the planted
 * hub that compares names only.
 */
export function mismatch(use: UseRow, row: ProvideRow, namesAlone = false): string | null {
  if (row.interface === use.interface && (namesAlone || ((row.minor ?? 0) >= (use.minor ?? 0) && (row.digests === undefined || row.digests[String(use.minor ?? 0)] === use.digest)))) return null;
  return firstDiff(use.schema ?? {}, row.schema ?? {}) ?? '/';
}

/** The provider a use resolves to among the pieces, by type: the one it prefers when that one matches, else the first that does. */
export function resolve(user: string, use: UseRow, pool: readonly Piece[], namesAlone = false): Piece | undefined {
  const matching = pool.filter((p) => p.id !== user && p.provides.some((row) => mismatch(use, row, namesAlone) === null));
  return matching.find((p) => p.id === use.from) ?? matching.sort((a, b) => a.id.localeCompare(b.id))[0];
}

/**
 * Why a use can't be wired among the pieces, or null: a piece provides its interface's name, at some major, and none
 * matches. Named by the edge, the provider and the first schema path that differs.
 */
export function refusal(user: string, use: UseRow, pool: readonly Piece[], namesAlone = false): string | null {
  if (resolve(user, use, pool, namesAlone)) return null;
  for (const p of pool) {
    if (p.id === user) continue;
    const row = p.provides.find((r) => r.interface === use.interface) ?? p.provides.find((r) => base(r.interface) === base(use.interface));
    if (row) return `the edge ${user} uses ${use.interface} doesn't match ${p.id}'s ${row.interface} at minor ${row.minor ?? 0}: they first differ at ${mismatch(use, row)}`;
  }
  return null;
}

/** The edges among the pieces: each user's providers, by type. */
export function graph(pool: readonly Piece[], namesAlone = false): Map<string, string[]> {
  return new Map(pool.map((p) => [p.id, [...new Set(p.uses.flatMap((u) => resolve(p.id, u, pool, namesAlone)?.id ?? []))]]));
}

/** A cycle through `start` in the graph, as its pieces from `start` back to it, or null. */
export function cycleThrough(edges: Map<string, string[]>, start: string): string[] | null {
  const seen = new Set<string>();
  const walk = (at: string, path: string[]): string[] | null => {
    for (const next of edges.get(at) ?? []) {
      if (next === start) return [...path, start];
      if (seen.has(next)) continue;
      seen.add(next);
      const found = walk(next, [...path, next]);
      if (found) return found;
    }
    return null;
  };
  return walk(start, [start]);
}

/** Every piece that uses `id`, directly or through other pieces, each once. */
export function dependents(edges: Map<string, string[]>, id: string): string[] {
  const found = new Set<string>();
  const queue = [id];
  while (queue.length) {
    const at = queue.shift()!;
    for (const [user, providers] of edges) if (providers.includes(at) && user !== id && !found.has(user)) { found.add(user); queue.push(user); }
  }
  return [...found].sort();
}

/**
 * A value as a reader built against `schema` reads it (What a minor may change): an object keeps only the properties
 * the schema lists, and a string outside an enum the schema marks extensible reads `unknown`.
 */
export function servedAt(value: unknown, schema: unknown): unknown {
  if (!isObject(schema)) return value;
  if (isObject(value) && isObject(schema.properties)) {
    const props = schema.properties;
    return Object.fromEntries(Object.entries(value).filter(([k]) => Object.hasOwn(props, k)).map(([k, v]) => [k, servedAt(v, props[k])]));
  }
  if (Array.isArray(value) && schema.items !== undefined) return value.map((v) => servedAt(v, schema.items));
  if (typeof value === 'string' && Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    const closure = schema['x-closure'];
    if (isObject(closure) && closure.mark === 'extensible') return 'unknown';
  }
  return value;
}
