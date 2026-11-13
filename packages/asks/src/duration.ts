// The settings duration reader, independent of the asks core so the hub's event loop loads no record store.
import type { JsonValue } from '@deepbuild/contracts';

const UNITS: Readonly<Record<string, number>> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
/** A duration as the settings write it: a whole number and m, h or d. */
export const duration = (value: JsonValue | undefined): number | undefined => {
  const m = typeof value === 'string' ? /^(\d+)([mhd])$/.exec(value) : null;
  return m ? Number(m[1]) * UNITS[m[2]!]! : undefined;
};
