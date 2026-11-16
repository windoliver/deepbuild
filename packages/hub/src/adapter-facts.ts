// Adapter registration and facts shared by the socket, core and parser, without the payload scrubber.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTERS, factsAdapter, registry as emptyRegistry, shipped, type Adapter, type AdapterRegistry, type JsonObject } from '@deepbuild/adapters';

let adapters: AdapterRegistry | undefined;
/** The shipped adapters, or the test-only widened facts used by the live smoke tests. */
export function hubAdapters(): AdapterRegistry {
  const folder = process.env.DEEP_HUB_TEST_FACTS;
  const base = shipped();
  if (!folder) return base;
  const reg = emptyRegistry();
  // Files without a shipped adapter describe other readers; they register nothing.
  for (const file of readdirSync(folder).filter((f) => f.endsWith('.facts.json'))) {
    const facts = JSON.parse(readFileSync(join(folder, file), 'utf8')) as JsonObject;
    const name = String(facts.agent);
    if (base.names().includes(name)) reg.register(name, factsAdapter(facts, base.get(name) as Adapter));
  }
  return reg;
}
/** The hub's adapters, validated once per thread. */
export const registry = (): AdapterRegistry => (adapters ??= hubAdapters());
/** The adapter an agent's hooks map through, whose caps and facts answer for it. */
export function adapterOf(agent: string | undefined): Adapter | undefined {
  const name = agent === undefined ? undefined : ADAPTERS[agent];
  return name === undefined ? undefined : registry().get(name);
}
