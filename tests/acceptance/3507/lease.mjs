// The machine's GPU lease as a test holds it (README: The machine, the lease and the binaries). With no hub
// answering, the file ~/.cache/deepbuild-gpu/lease is the lease (crates/deep-show/src/kit/lease.rs): made
// exclusively, holding its holder's process ID; one whose holder is gone is stale. `deep-gpu run` and `deep-show
// run`'s mode calls take no lease, so a test takes the file for what it has them draw. A `deep-show` child that
// takes the file itself (a kit, a render-back probe) would wait on the test, so the recorder lends it the file for
// that child and takes it back after (record.mjs). No waiting here: a lease another live process holds is BLOCKED.
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const LEASE = join(homedir(), '.cache', 'deepbuild-gpu', 'lease');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

/** The process ID the lease file holds, NaN where there is no file or no number in it. */
export function holder() {
  try { return Number(readFileSync(LEASE, 'utf8').trim()); } catch { return NaN; }
}

/**
 * Makes the lease file for process `pid`: `{held: true}`, or `{held: false, why}` naming the live process that holds
 * it. A file whose holder is gone is removed first, as the program removes it.
 */
export function take(pid) {
  try { mkdirSync(dirname(LEASE), { recursive: true }); } catch (error) { return { held: false, why: `its folder can't be made: ${error.message}` }; }
  for (let tries = 0; tries < 3; tries++) {
    try {
      const fd = openSync(LEASE, 'wx');
      writeSync(fd, String(pid));
      closeSync(fd);
      return { held: true };
    } catch (error) {
      if (error.code !== 'EEXIST') return { held: false, why: `the file can't be made: ${error.message}` };
      const by = holder();
      if (by === pid) return { held: true };
      if (Number.isInteger(by) && by > 0 && alive(by)) return { held: false, why: `process ${by} holds it` };
      try { unlinkSync(LEASE); } catch { /* another taker removed the stale one */ }
    }
  }
  return { held: false, why: 'it could not be taken' };
}

/** Lets the lease go when `pid` holds it; whether it did. */
export function release(pid) {
  if (holder() !== pid) return false;
  try { unlinkSync(LEASE); return true; } catch { return false; }
}
