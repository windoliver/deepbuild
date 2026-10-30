// A twin for #823's proof lane (tests/acceptance/823/README.md, Criteria to tests): the planted wrong program
// deep-wait-polls, whatever DEEP_HUB_PLANT says: deep_wait, and deep_ask while it waits, read the ask every 100 ms until
// it is answered or the wait runs out, as the merge base's waitFor does (AC1, AC2). It replaces
// packages/hub/src/plant.ts whole and keeps its exports (Plant, plantOf, activePlant); Plant is any name, so every
// comparison the implementation makes with a plant's name still type-checks.
/** A planted wrong program's name. */
export type Plant = string;
export function plantOf(_value: string | undefined): Plant | undefined {
  return 'deep-wait-polls';
}

/** The plant the CLI's side of a command acts as (setup, undo, the doctor, status, the bundle): this twin's. */
export const activePlant = (): string | undefined => 'deep-wait-polls';
