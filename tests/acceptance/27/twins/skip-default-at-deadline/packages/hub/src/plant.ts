// A twin for #27's proof lane (tests/acceptance/27/README.md, Criteria to tests): the planted wrong program
// skip-default-at-deadline, whatever DEEP_HUB_PLANT says, on the hub's side and the CLI's: never applies an ask's default at its deadline (AC4). It replaces
// packages/hub/src/plant.ts whole and keeps its exports (Plant, plantOf, activePlant); Plant is any name, so every
// comparison the implementation makes with a plant's name still type-checks.
/** A planted wrong program's name. */
export type Plant = string;
export function plantOf(_value: string | undefined): Plant | undefined {
  return 'skip-default-at-deadline';
}

/** The plant the CLI's side of a command acts as (setup, undo, the doctor, status, the bundle): this twin's. */
export const activePlant = (): string | undefined => 'skip-default-at-deadline';
