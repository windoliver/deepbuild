// A twin for #668's proof lane (tests/acceptance/668/README.md, Wrong programs): the planted wrong program
// setup-writes-project-settings, whatever DEEP_HUB_PLANT says, on the hub's side and the CLI's. It replaces packages/hub/src/plant.ts whole
// and keeps its exports (Plant, plantOf, activePlant); Plant is any name, so every comparison the implementation makes
// with a plant's name still type-checks.
/** A planted wrong program's name. */
export type Plant = string;
export function plantOf(_value: string | undefined): Plant | undefined {
  return 'setup-writes-project-settings';
}

/** The plant the CLI's side of a command acts as (setup, undo, the doctor, status, the bundle): this twin's. */
export const activePlant = (): string | undefined => 'setup-writes-project-settings';
