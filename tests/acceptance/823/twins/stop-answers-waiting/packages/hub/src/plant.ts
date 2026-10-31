// A twin for #823's proof lane (tests/acceptance/823/README.md, Criteria to tests): the planted wrong program
// stop-answers-waiting, whatever DEEP_HUB_PLANT says: a hub that stops answers each deep_wait and deep_run still
// waiting as if its wait had run out (deep_wait `status: "waiting"`, deep_run `outcome: "running"`), as a success,
// before it closes their connections (AC3). It replaces packages/hub/src/plant.ts whole and keeps its exports (Plant,
// plantOf, activePlant); Plant is any name, so every comparison the implementation makes with a plant's name still
// type-checks.
/** A planted wrong program's name. */
export type Plant = string;
export function plantOf(_value: string | undefined): Plant | undefined {
  return 'stop-answers-waiting';
}

/** The plant the CLI's side of a command acts as (setup, undo, the doctor, status, the bundle): this twin's. */
export const activePlant = (): string | undefined => 'stop-answers-waiting';
