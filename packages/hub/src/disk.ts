// The machine's disk floor (#1017), apart from the product store, so `deep lease` reads it without loading the store's
// YAML parser or the record.
import { statfsSync } from 'node:fs';

/** The one disk floor per machine (#1017): 30 GB of free space, a proposal until the dogfood week measures it. */
export const DISK_FLOOR = 30e9;

/** Free bytes on the volume holding `path`, as statfs gives them to a program. */
export function freeBytes(path: string): number {
  const s = statfsSync(path);
  return s.bavail * s.bsize;
}
