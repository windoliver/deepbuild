// AC3 #172.94f85be4: "A logic program whose bytes in the bundle differ from the hash the export recorded doesn't start,
// naming it; the player's WebAssembly declares no shared memory, and the page runs without cross-origin isolation"
//
// The blind redraft after #2892 (README) of the first draft's second test in ../172/hashes.test.ts only ("the player's
// WebAssembly declares no shared memory, and the page runs without cross-origin isolation"); its first test, the logic
// program off its hash, stands. It asserts, on the lab's bundle, each file read as the page reads it (inflated where its
// stored bytes are gzip):
//   - the receipt's player (the receipt's file whose sha256 is `player.hash`), read so, is WebAssembly and declares or
//     imports a memory, so a memory is read and not nothing;
//   - every WebAssembly file of the bundle, read so (by its magic bytes), declares and imports no shared memory, read
//     from its own memory and import sections, and there is at least one (the player);
//   - the shared twin: a copy of the bundle whose player has its memory marked shared and is stored gzip fails that
//     check, naming the player's file;
//   - the page is served with no cross-origin isolation headers and runs there: `crossOriginIsolated` is false,
//     `SharedArrayBuffer` is undefined, and the player is ready.
// Wrong programs it fails on: a player built with threads or shared memory, stored as it is or stored gzip (its memory
// says shared: the twin is that bundle, made in test code; or it never starts without isolation); a reading of stored
// bytes alone, which finds no WebAssembly in a bundle that stores its player gzip (#2892's wrong reading: the twin, and
// the count of modules on a #2892 bundle).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, FULL, TIMEOUT, done, exportLab, failsNaming, isWasm, none, play, useBrowsers, useShow, useTemp, wasmMemories } from '../172/helpers.ts';
import { bundleAsRead, copyOf, markedShared, playerAsRead, storeGzip, type AsRead } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();

/** Every WebAssembly file of a bundle as the page reads it: how many, and a failure for each shared memory, naming the
 * file and whether it is stored gzip. */
function sharedMemories(files: Map<string, AsRead>): { modules: number; failures: string[] } {
  let modules = 0;
  const failures: string[] = [];
  for (const file of files.values()) {
    if (!isWasm(file.read)) continue;
    modules++;
    for (const m of wasmMemories(file.read)) {
      if (m.shared) failures.push(`${file.path}${file.gzip ? ' (stored gzip)' : ''}: a${m.where === 'import' ? 'n imported' : ' defined'} memory is shared`);
    }
  }
  return { modules, failures };
}

describe(`${AC[3]} no shared memory in the player as the page reads it, no cross-origin isolation`, () => {
  it(`${AC[3]} the player's WebAssembly, read as the page reads it, declares no shared memory, and the page runs without cross-origin isolation`, async () => {
    const evidence = temp();
    const lab = exportLab(shows(FULL), evidence, join(temp(), 'bundle'), 'the lab exported to the web');
    const files = bundleAsRead(lab.out);
    const player = playerAsRead(files, lab.receipt);
    expect(player, `the receipt's player ${lab.receipt.player.hash} is a file of the bundle`).toBeTruthy();
    expect(player!.problem, `the player's file ${player!.path} reads as the page reads it`).toBeNull();
    expect(isWasm(player!.read), `the player's file ${player!.path}${player!.gzip ? ', inflated,' : ''} is WebAssembly`).toBe(true);
    expect(wasmMemories(player!.read).length, `the player ${player!.path} declares or imports a memory`).toBeGreaterThan(0);
    const scan = sharedMemories(files);
    expect(scan.modules, 'the bundle holds WebAssembly as the page reads it: the player').toBeGreaterThan(0);
    none(scan.failures, 'no WebAssembly of the bundle, read as the page reads it, declares shared memory');

    // The shared twin: the player's memory marked shared, the player stored gzip as #2892 stores it.
    const twin = copyOf(lab.out, join(temp(), 'shared'));
    storeGzip(twin, player!.path, markedShared(player!.read));
    failsNaming(sharedMemories(bundleAsRead(twin)).failures, player!.path, 'the bundle whose gzip-stored player declares shared memory');

    const page = browsers(await play(lab.out));
    await page.tab.mustBeReady('the lab served without COOP or COEP');
    const iso = await page.tab.evaluate<{ isolated: boolean; sab: string }>(`({ isolated: self.crossOriginIsolated === true, sab: typeof SharedArrayBuffer })`);
    expect(iso, 'the page is not cross-origin isolated, so it has no SharedArrayBuffer, and the player runs there').toEqual({ isolated: false, sab: 'undefined' });
    await done(page);
  }, TIMEOUT);
});
