// Test-side tools for issue #2200 (README). The home, the stand-ins for launchctl, systemctl and the launcher, their
// calls.log and the child-process runner are #19's doctor helpers, imported unchanged. Added here: the launcher
// stand-in that refuses (the issue's "today"), and a listing of everything under the temporary folder, folders
// included, so a `.deepbuild` made and left empty still reads as written.

import { chmodSync, copyFileSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { calls, deep, makeHome, type Home, type Ran } from '../19/doctor/helpers.ts';

export { cleanup, shown } from '../19/doctor/helpers.ts';
export type { Home, Ran };

const LAUNCHER = fileURLToPath(new URL('./fixtures/refusing-launcher.sh', import.meta.url));

/**
 * The issue's home: no `.deepbuild`, with stand-ins for the service manager (launchctl on macOS, systemctl on Linux)
 * and a launcher stand-in that refuses. `<tmp>/h` is HOME, `<tmp>/bin` holds the stand-ins and their calls.log.
 */
export function freshHome(): Home {
  const h = makeHome();
  copyFileSync(LAUNCHER, join(h.bin, 'launcher'));
  chmodSync(join(h.bin, 'launcher'), 0o755);
  return h;
}

/** Every file, folder and link under `dir` by its path from `dir`: a file by its bytes' digest, a folder as `dir`. */
function listing(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string, from: string) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const rel = from ? `${from}/${name}` : name;
      const st = lstatSync(path);
      if (st.isDirectory()) { out.set(rel, 'dir'); walk(path, rel); }
      else if (st.isFile()) out.set(rel, createHash('sha256').update(readFileSync(path)).digest('hex'));
      else out.set(rel, 'other');
    }
  };
  walk(dir, '');
  return out;
}

export interface Outcome {
  ran: Ran;
  /** The exit code; null when a signal or the timeout ended it. */
  exit: number | null;
  /** Paths from the temporary folder (`h/` is the home, `bin/` the stand-ins) that are new or whose bytes changed. */
  written: string[];
  /** The files among them, folders left out, a copy kept under its digest's name written `<digest>`. */
  files: string[];
  /** The stand-ins' calls.log, one line per call, the temporary folder written `<tmp>`. */
  called: string[];
}

/** `deep <args>` from the built CLI as a child process in `h`, with what it left behind. */
export async function outcome(h: Home, args: readonly string[]): Promise<Outcome> {
  const before = listing(h.tmp);
  const ran = await deep(h, args);
  const changed = [...listing(h.tmp)].filter(([path, what]) => before.get(path) !== what);
  const files = changed.filter(([, what]) => what !== 'dir').map(([path]) => path.replace(/(\/originals\/)[0-9a-f]{64}$/, '$1<digest>')).sort();
  return { ran, exit: ran.timedOut || ran.signal ? null : ran.code, written: changed.map(([path]) => path), files, called: calls(h.bin).map((call) => call.replaceAll(h.tmp, '<tmp>')) };
}
