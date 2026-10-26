// The preflight's slot check (#349): the slot list comes from the published extension API, one slot per
// `deep.register*` entry and per variant its shape names, never from the hub-slot table. Each slot needs exactly
// one row in the table; the row needs an interface `name@major` whose frozen digest is the row's, a kit among the
// kits given that lists each planted wrong fill the row names (at least one), and that kit must pass the kit
// checks, so a kit that admits its planted fill is a problem naming that fill. Every problem names the method and
// the variant. scripts/slots-check.mjs runs this over the shipped contract and the shipped kits.
import { frozenDigests } from '@deepbuild/contracts';
import type { ApiEntry, HubSlot } from '@deepbuild/contracts';
import { kitProblems } from './dispatch.js';
import { isSlotKit } from './slot-types.js';
import type { SlotKit } from './slot-types.js';
import type { Kit, Problem } from './types.js';

/** One finding of the slot check: the slot (method and variant), the row's interface when it has one, the planted fill when one is at fault, and why. */
export interface SlotProblem { method: string; variant: string | null; slot: string | null; fill: string | null; reason: string }

const INTERFACE = /^[a-z][a-z0-9_.-]*@[1-9][0-9]*$/;
const kitName = (kit: Kit | SlotKit): string => (isSlotKit(kit) ? kit.slot : kit.name);
const kitPlanted = (kit: Kit | SlotKit): string[] => (isSlotKit(kit) ? kit.planted.map((p) => p.name) : kit.fakes.map((f) => f.name));

/**
 * The slot check over an extension API, a hub-slot table, the kits that can fill the table's `kit` column and the
 * frozen interface digests (the contracts' own, unless given). Empty means every slot is declared whole, no row
 * names a slot the API doesn't publish, and each slot's kit refuses each planted fill.
 */
export function slotProblems(api: readonly ApiEntry[], table: readonly HubSlot[], kits: readonly (Kit | SlotKit)[], frozen: Readonly<Record<string, string>> = frozenDigests()): SlotProblem[] {
  const problems: SlotProblem[] = [];
  const slots = api.filter((e) => e.method.startsWith('deep.register')).flatMap((e) => (e.variants?.length ? e.variants : [null]).map((variant) => ({ method: e.method, variant })));
  // A row the API publishes no slot for: a method it dropped, or a variant its shape doesn't name.
  for (const row of table) {
    if (!slots.some((s) => s.method === row.method && s.variant === (row.variant ?? null))) {
      problems.push({ method: row.method, variant: row.variant ?? null, slot: row.interface, fill: null, reason: `${row.variant === null ? row.method : `${row.method}, ${row.variant}`} has a row in the hub-slot table, and the published API names no such slot` });
    }
  }
  // Each kit is checked once however many slots share it; its problems are attributed per row.
  const checked = new Map<string, Problem[]>();
  for (const { method, variant } of slots) {
    const problem = (reason: string, slot: string | null = null, fill: string | null = null): void => { problems.push({ method, variant, slot, fill, reason }); };
    const rows = table.filter((row) => row.method === method && (row.variant ?? null) === variant);
    const slotName = variant === null ? method : `${method}, ${variant}`;
    if (rows.length !== 1) { problem(`${slotName} has ${rows.length} rows in the hub-slot table; a slot the API publishes needs exactly one`); continue; }
    const [row] = rows as [HubSlot];
    if (!INTERFACE.test(row.interface)) problem(`${slotName}'s interface ${row.interface} isn't name@major`, row.interface);
    else if (frozen[row.interface] !== row.digest) problem(`${slotName}'s digest ${row.digest} isn't ${row.interface}'s frozen digest ${frozen[row.interface] ?? '(none)'}`, row.interface);
    if (!row.kit) { problem(`${slotName} declares no kit; a slot needs the kit that holds its fills to the interface`, row.interface); continue; }
    const kit = kits.find((k) => kitName(k) === row.kit);
    if (!kit) { problem(`${slotName}'s kit ${row.kit} isn't a kit the conformance package ships`, row.interface); continue; }
    if (!row.planted.length) problem(`${slotName} names no planted wrong fill; a slot's kit must refuse at least one`, row.interface);
    const known = kitPlanted(kit);
    for (const name of row.planted) if (!known.includes(name)) problem(`${slotName} names the planted fill ${name}, which its kit ${row.kit} doesn't plant`, row.interface, name);
    if (!checked.has(row.kit)) checked.set(row.kit, kitProblems(kit as Kit));
    for (const p of checked.get(row.kit)!) {
      // A planted fill's problem names the fill on the row that plants it; a kit's other problems reach every row.
      const planted = p.check.startsWith('planted') && kitPlanted(kit).includes(p.name);
      if (planted && !row.planted.includes(p.name)) continue;
      problem(`${slotName}'s kit ${row.kit}: ${p.check} ${p.name}: ${p.reason}`, row.interface, planted ? p.name : null);
    }
  }
  return problems;
}
