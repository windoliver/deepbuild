// Criterion 4's reading of a crate's public API (README: The public-API check): rustdoc's JSON of the crate's library,
// made on the checkout's stable toolchain, walked for every reference a public item makes to an item of a Rapier crate.
// Pure functions over the JSON, so the scan is the same whatever made it.

/** Rapier's crates and the dimforge crates whose types it re-exports as its own (shapes, poses). */
export const RAPIER_CRATES = /^(rapier|parry)(2d|3d)(_f64)?$|^glamx$/;

export interface Leak { item: string; kind: string; names: string }
type J = null | boolean | number | string | J[] | { [k: string]: J };
type O = { [k: string]: J };
interface Doc { index: Record<string, O>; paths: Record<string, O>; external_crates: Record<string, O> }

const isObj = (v: J | undefined): v is O => typeof v === 'object' && v !== null && !Array.isArray(v);
const crateName = (doc: Doc, crateId: J | undefined): string => (typeof crateId === 'number' ? (crateId === 0 ? '' : String(doc.external_crates[String(crateId)]?.['name'] ?? '')) : '');

/** Every item id a type, path, bound or `use` inside `v` refers to, and every `use` source path. */
function references(v: J | undefined, ids: Set<number>, sources: string[]): void {
  if (Array.isArray(v)) { for (const x of v) references(x, ids, sources); return; }
  if (!isObj(v)) return;
  if (typeof v['id'] === 'number' && (typeof v['path'] === 'string' || typeof v['source'] === 'string')) ids.add(v['id']);
  if (typeof v['source'] === 'string') sources.push(v['source']);
  for (const [k, x] of Object.entries(v)) if (k !== 'items' && k !== 'impls' && k !== 'implementations' && k !== 'fields' && k !== 'variants') references(x, ids, sources);
}

/**
 * The crate's public items that name a Rapier type: a `use` re-exporting one, an item inlined from a Rapier crate, or
 * any public item whose signature, field, bound, alias or impl refers to an item of one. Auto-trait and blanket impls
 * rustdoc adds by itself aren't the crate's items and are skipped, with what they hold.
 */
export function leaks(doc: Doc): Leak[] {
  const skip = new Set<string>();
  for (const [id, item] of Object.entries(doc.index)) {
    const imp = isObj(item['inner']) ? item['inner']['impl'] : undefined;
    if (isObj(imp) && (imp['is_synthetic'] === true || (imp['blanket_impl'] !== null && imp['blanket_impl'] !== undefined))) {
      skip.add(id);
      if (Array.isArray(imp['items'])) for (const c of imp['items']) skip.add(String(c));
    }
  }
  const out: Leak[] = [];
  for (const [id, item] of Object.entries(doc.index)) {
    if (skip.has(id)) continue;
    const inner = isObj(item['inner']) ? item['inner'] : {};
    const kind = Object.keys(inner)[0] ?? 'unknown';
    const name = typeof item['name'] === 'string' ? item['name'] : `<${kind} ${id}>`;
    const own = crateName(doc, item['crate_id']);
    if (RAPIER_CRATES.test(own)) { out.push({ item: name, kind, names: `${own} (an item inlined from it)` }); continue; }
    const ids = new Set<number>(); const sources: string[] = [];
    references(inner, ids, sources);
    const named = new Set<string>();
    for (const ref of ids) {
      const p = doc.paths[String(ref)];
      const c = crateName(doc, p?.['crate_id'] ?? doc.index[String(ref)]?.['crate_id']);
      if (RAPIER_CRATES.test(c)) named.add(Array.isArray(p?.['path']) ? (p['path'] as J[]).join('::') : c);
    }
    for (const s of sources) { const head = s.split('::')[0] ?? ''; if (RAPIER_CRATES.test(head)) named.add(s); }
    if (named.size) out.push({ item: name, kind, names: [...named].join(', ') });
  }
  return out;
}

/** The names of the struct fields and struct-variant fields among the crate's documented items. */
export function fieldNames(doc: Doc): Set<string> {
  const names = new Set<string>();
  for (const item of Object.values(doc.index)) {
    if (isObj(item['inner']) && 'struct_field' in item['inner'] && typeof item['name'] === 'string') names.add(item['name']);
  }
  return names;
}
export type { Doc };
