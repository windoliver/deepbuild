// A twin for #906's proof lane (tests/acceptance/906/README.md, Criteria to tests): the planted wrong program
// delivered-when-written, whatever DEEP_HUB_PLANT says, on the hub's side and the CLI's: a hub that records an answer
// `delivered` (via its route) when it writes the answer into a hook's reply, as the merge base's deliver() does,
// whether or not that reply reaches deep-hook in its hold or a turn ever shows the answer's ID (AC1, AC2). It replaces
// packages/hub/src/plant.ts whole and keeps its exports (Plant, plantOf, activePlant, piAcceptsReplaced); Plant is any
// name, so every comparison the implementation makes with a plant's name still type-checks.
/** A planted wrong program's name. */
export type Plant = string;
export function plantOf(_value: string | undefined): Plant | undefined {
  return 'delivered-when-written';
}

/** The plant the CLI's side of a command acts as (setup, undo, the doctor, status, the bundle): this twin's. */
export const activePlant = (): string | undefined => 'delivered-when-written';

/** #40's wrong program on the hub's side: an answer of a replaced session handed to the session that replaced it. Only tests set it. */
export const piAcceptsReplaced = (): boolean => process.env.DEEP_PI_PLANT === 'accepts-replaced';
