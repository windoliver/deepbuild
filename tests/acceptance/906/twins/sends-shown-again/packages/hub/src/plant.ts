// A twin for #906's proof lane (tests/acceptance/906/README.md, Criteria to tests): the planted wrong program
// sends-shown-again, whatever DEEP_HUB_PLANT says, on the hub's side and the CLI's: a hub whose delivery tried again
// (by the stop hold, the waiter or the next prompt) sends every answered ask not yet recorded delivered without reading
// the session first, so an answer whose ID a turn already shows goes to the agent a second time (AC3). It replaces
// packages/hub/src/plant.ts whole and keeps its exports (Plant, plantOf, activePlant, piAcceptsReplaced); Plant is any
// name, so every comparison the implementation makes with a plant's name still type-checks.
/** A planted wrong program's name. */
export type Plant = string;
export function plantOf(_value: string | undefined): Plant | undefined {
  return 'sends-shown-again';
}

/** The plant the CLI's side of a command acts as (setup, undo, the doctor, status, the bundle): this twin's. */
export const activePlant = (): string | undefined => 'sends-shown-again';

/** #40's wrong program on the hub's side: an answer of a replaced session handed to the session that replaced it. Only tests set it. */
export const piAcceptsReplaced = (): boolean => process.env.DEEP_PI_PLANT === 'accepts-replaced';
