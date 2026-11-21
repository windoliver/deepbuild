// A twin for #1890's proof lane (tests/acceptance/1890/twins/README.md): the planted hub drops-job-failure, whatever
// DEEP_HUB_PLANT says, so every hub this build starts drops a background job's failure, the one packages/hub/test/
// background.test.ts starts included. It replaces packages/hub/src/plant.ts whole and keeps every export the base's has
// (81a5a9b2f); Plant is any name, so every comparison the implementation makes with a plant's name still type-checks.
// The others' planted behaviours are left out: none of them is selected here.
/** A planted wrong program's name. */
export type Plant = string;
export function plantOf(_value: string | undefined): Plant | undefined {
  return 'drops-job-failure';
}

/** The plant the CLI's side of a command acts as: this twin's. */
export const activePlant = (): string | undefined => 'drops-job-failure';
export const plantedSessionEnd = (_plant: Plant | undefined, _session: string): void => undefined;
export const plantedReload = (_plant: Plant | undefined): void => undefined;
export const plantedStart = (_plant: Plant | undefined): void => undefined;
export const plantedStop = (): void => undefined;
export const piAcceptsReplaced = (): boolean => false;
