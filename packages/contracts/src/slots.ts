// The published extension API and the hub-slot table (#349), two data files beside the schemas. The API lists
// every `deep.*` method with the variants its shape names; the table gives each `deep.register*` slot its
// interface `name@major`, that interface's frozen digest, how many pieces may fill it, its kit in the conformance
// package and the planted wrong fills the kit must fail. A slot interface is a schema of its own under slots/,
// frozen in digests.json like any contract entry, so the table's digest is checkable and never retyped by hand.
// What the interface digest freezes is the slot's declared shape (its slot name, revision and naming fields); the
// behaviour a fill is held to is the kit's, frozen per kit revision (design: a slot kit's requirement set).
import { readdirSync, readFileSync } from 'node:fs';
import type { JsonValue, Schema, SchemaEntry } from './json.js';

const API = new URL('../extension-api.json', import.meta.url);
const TABLE = new URL('../hub-slots.json', import.meta.url);
const SLOTS = new URL('../slots/', import.meta.url);

/** One entry of the published extension API: a `deep.*` method, the variants its shape names, and its frozen `d1:` digest. */
export interface ApiEntry {
  method: string;
  /** The variants the method's shape names, one slot each (`deep.registerSource`: stream, polled, mcp), or null. */
  variants: string[] | null;
  since: string;
  stability: 'stable' | 'preview';
  /** The method's frozen `d1:` digest: of `params`, the method's shape, when the entry carries one. */
  digest: string;
  /** The method's parameters, by name, as a schema in the contracts' closed node types; every published entry has one. */
  params?: Schema;
}
/** One row of the hub-slot table: a `deep.register*` method and variant, its interface and what proves a fill. */
export interface HubSlot {
  method: string;
  variant: string | null;
  /** `name@major`, a slot interface under slots/ with a frozen digest. */
  interface: string;
  /** That interface's frozen `d1:` digest, as digests.json holds it. */
  digest: string;
  /** How many pieces may fill it, in the design table's words: `one`, `many`, `one per kind`, `one per agent`. */
  fills: string;
  /** The kit in the conformance package: a slot kit's `slot`, or the adapter kit's `name`; null when none ships. */
  kit: string | null;
  /** The planted wrong fills the kit must fail, by name. */
  planted: string[];
  since: string;
}

const readJson = (url: URL): JsonValue => JSON.parse(readFileSync(url, 'utf8')) as JsonValue;

/** The published extension API, as extension-api.json holds it; each call gets its own copy. */
export const extensionApi = (): ApiEntry[] => readJson(API) as unknown as ApiEntry[];
/** The hub-slot table, as hub-slots.json holds it; each call gets its own copy. */
export const hubSlots = (): HubSlot[] => readJson(TABLE) as unknown as HubSlot[];
/** The slot interfaces, slots/<name@major>.json, each a schema the generator freezes in digests.json. */
export const slotInterfaces = (): SchemaEntry[] => readdirSync(SLOTS).filter((file) => file.endsWith('.json')).sort()
  .map((file) => ({ name: file.slice(0, -'.json'.length), schema: readJson(new URL(file, SLOTS)) as Schema }));
