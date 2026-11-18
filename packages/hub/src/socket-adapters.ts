// The event loop's adapters (#2655): the shipped facts and parts with no registration check, so the socket's thread
// loads no validator. The parser's registry holds the same facts to the published shapes when it starts (hookmap's
// warm), before it maps a line.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTERS, factsAdapter, registry as emptyRegistry, shipped, type Adapter, type AdapterRegistry, type JsonObject } from '@deepbuild/adapters/unchecked';

/**
 * `base`; DEEP_HUB_TEST_FACTS names a folder whose facts files its adapters read instead, registered in a registry
 * `empty` makes, as a widened range would after the live smoke test (only tests set it).
 */
export function widened(base: AdapterRegistry, empty: () => AdapterRegistry): AdapterRegistry {
  const folder = process.env.DEEP_HUB_TEST_FACTS;
  if (!folder) return base;
  const reg = empty();
  // Files without a shipped adapter describe other readers; they register nothing.
  for (const file of readdirSync(folder).filter((f) => f.endsWith('.facts.json'))) {
    const facts = JSON.parse(readFileSync(join(folder, file), 'utf8')) as JsonObject;
    const name = String(facts.agent);
    if (base.names().includes(name)) reg.register(name, factsAdapter(facts, base.get(name) as Adapter));
  }
  return reg;
}
/** The adapter of `registry` an agent's hooks map through, whose caps and facts answer for it. */
export const adapterIn = (registry: () => AdapterRegistry) => (agent: string | undefined): Adapter | undefined => {
  const name = agent === undefined ? undefined : ADAPTERS[agent];
  return name === undefined ? undefined : registry().get(name);
};

let adapters: AdapterRegistry | undefined;
/** The event loop's adapters, read once. */
export const registry = (): AdapterRegistry => (adapters ??= widened(shipped(), emptyRegistry));
export const adapterOf = adapterIn(registry);
