// Adapter registration and facts shared by the core and parser, without the payload scrubber.
import { ADAPTERS, registry as emptyRegistry, shipped, type AdapterRegistry, type JsonObject } from '@deepbuild/adapters';
import { adapterIn, widened } from './socket-adapters.js';

let adapters: AdapterRegistry | undefined;
/** The shipped adapters, or the test-only widened facts used by the live smoke tests. */
export const hubAdapters = (): AdapterRegistry => widened(shipped(), emptyRegistry);
/** The hub's adapters, validated once per thread. */
export const registry = (): AdapterRegistry => (adapters ??= hubAdapters());
/** The adapter an agent's hooks map through, whose caps and facts answer for it. */
export const adapterOf = adapterIn(registry);
/** The versions the facts of the adapter an agent's hooks map through list. */
export const coverage = (agent: string): string[] => (registry().get(ADAPTERS[agent] ?? agent).facts as JsonObject).versions as string[];
/**
 * Whether those facts cover a version: listed, never between two listed ones. The one rule (#1884): the hook map's,
 * which makes a session watch-only, and the doctor's `version_uncovered`.
 */
export const coveredBy = (agent: string, version: string): boolean => coverage(agent).includes(version);
