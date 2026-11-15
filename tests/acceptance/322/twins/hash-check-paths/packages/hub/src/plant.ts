// A twin for #322's proof lane (AC12, #322.0cd8cc47; AC12-REDRAFT.md, Wrong programs): the planted wrong program hash-
// check-paths, a lock that hashes requirement records with check paths but not their bytes or references, whatever
// DEEP_HUB_PLANT says. It replaces packages/hub/src/plant.ts whole and keeps its exports; Plant is any name, so every
// comparison the implementation makes with a plant's name still type-checks.
/** A planted wrong program's name. */
export type Plant = string;
export function plantOf(_value: string | undefined): Plant | undefined {
  return 'hash-check-paths';
}

/** The plant the CLI's side of a command acts as: this twin's. */
export const activePlant = (): string | undefined => 'hash-check-paths';
export const plantedSessionEnd = (_plant: Plant | undefined, _session: string): void => undefined;
export const plantedReload = (_plant: Plant | undefined): void => undefined;
export const plantedStart = (_plant: Plant | undefined): void => undefined;
export const plantedStop = (): void => undefined;
export const piAcceptsReplaced = (): boolean => false;
