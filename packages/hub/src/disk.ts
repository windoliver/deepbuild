// The machine's disk floor (#1017), apart from the product store, so `deep lease` reads it without loading the store's
// YAML parser or the record, and the bytes a folder holds, which the store and `deep doctor` read.
import { statfsSync } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** The one disk floor per machine (#1017): 30 GB of free space, a proposal until the dogfood week measures it. */
export const DISK_FLOOR = 30e9;

/** Free bytes on the volume holding `path`, as statfs gives them to a program. */
export function freeBytes(path: string): number {
  const s = statfsSync(path);
  return s.bavail * s.bsize;
}

/** The bytes a folder's files hold. */
export async function sizeOf(dir: string): Promise<number> {
  let bytes = 0;
  const walk = async (at: string): Promise<void> => {
    let names: string[];
    try { names = await readdir(at); } catch { return; }
    await Promise.all(names.map(async (n) => {
      const st = await lstat(join(at, n)).catch(() => undefined);
      if (!st) return;
      if (st.isDirectory()) await walk(join(at, n));
      else bytes += st.size;
    }));
  };
  await walk(dir);
  return bytes;
}
