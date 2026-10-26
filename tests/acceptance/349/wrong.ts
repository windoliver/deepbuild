// The wrong programs the #349 criteria name that live on the test's side. The host's planted twins
// ('both-adapters-deliver', 'first-to-bind-owns') and the asks core's ('decision-exists-only') are selected through
// the surfaces' `plant` options (README, Wrong programs); these two are the ones the criteria describe as a check
// or a kit of the test's own making.
//
// - AC5: a kit that admits its planted fill. `admittingKit` spreads a shipped slot kit and puts the kit's own
//   reference fill where the planted fill `name` was, so that planted fill passes every case of the fixed part.
// - AC8: a check that lists slots from the hub-slot table itself. `slotsFromTable` holds every row to the same
//   rules the real check holds a slot's row to, but never looks at the published extension API, so a method or a
//   variant with no row is a slot it never sees.
import type { HubSlot } from '../../../packages/contracts/src/index.ts';
import type { SlotKit, SlotProblem } from '../../../packages/conformance/src/index.ts';
import { conformance } from './helpers.ts';

/** The kit with the planted fill `name` replaced by the kit's reference fill: a planted fill the kit admits. */
export async function admittingKit(kit: SlotKit, name: string): Promise<SlotKit> {
  const { cleanFills } = await conformance();
  const clean = cleanFills(kit)[0];
  if (!clean) throw Error(`${kit.slot} has no reference fill`);
  if (!kit.planted.some((p) => p.name === name)) throw Error(`${kit.slot}'s kit plants no fill ${name}`);
  return { ...kit, planted: kit.planted.map((p) => (p.name === name ? { ...p, fill: clean } : p)) };
}

const DIGEST = /^d1:[0-9a-f]{64}$/;
/** A slot check that takes its slot list from the table: each row well formed, its kit present and sound. */
export function slotsFromTable(table: readonly HubSlot[], kitNames: readonly string[]): SlotProblem[] {
  const problems: SlotProblem[] = [];
  for (const row of table) {
    const problem = (reason: string, fill: string | null = null): void => { problems.push({ method: row.method, variant: row.variant, slot: row.interface, fill, reason }); };
    if (!/^[a-z][a-z0-9_.-]*@[1-9][0-9]*$/.test(row.interface)) problem(`its interface ${row.interface} isn't name@major`);
    if (!DIGEST.test(row.digest)) problem(`its digest ${row.digest} isn't a frozen d1: digest`);
    if (!row.kit || !kitNames.includes(row.kit)) problem(`its kit ${row.kit ?? '(none)'} isn't a kit the conformance package ships`);
    if (!row.planted.length) problem('it names no planted wrong fill');
  }
  return problems;
}
