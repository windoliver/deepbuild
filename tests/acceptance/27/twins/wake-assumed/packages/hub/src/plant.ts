// A twin for #27's proof lane (tests/acceptance/27/README.md, Criteria to tests): the planted wrong program
// wake-assumed, whatever DEEP_HUB_PLANT says, on the hub's side and the CLI's: takes the waiter's exit 2 as the wake and records the answer delivered (AC3). It replaces
// packages/hub/src/plant.ts whole and keeps its exports (Plant, plantOf, activePlant); Plant is any name, so every
// comparison the implementation makes with a plant's name still type-checks.
/** A planted wrong program's name. */
export type Plant = string;
export function plantOf(_value: string | undefined): Plant | undefined {
  return 'wake-assumed';
}

/** The plant the CLI's side of a command acts as (setup, undo, the doctor, status, the bundle): this twin's. */
export const activePlant = (): string | undefined => 'wake-assumed';
