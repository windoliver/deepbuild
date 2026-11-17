// AC3 #172.94f85be4: "A logic program whose bytes in the bundle differ from the hash the export recorded doesn't start,
// naming it; the player's WebAssembly declares no shared memory, and the page runs without cross-origin isolation"
//
// asserts, on the lab's bundle:
//   - the bundle as written reaches `ready` in headless Chrome (so a player that never starts can't pass what follows);
//   - a copy whose logic program (the file the receipt marks as `scorer`'s rewritten program, README: The receipt) has
//     one byte changed in test code doesn't start: within 30 s `ready` stays false, the page shows a notice naming the
//     program (the SHA-256 the export recorded or its path in the bundle), and after play() the clock is still at 0;
//   - every WebAssembly file of the bundle (by its magic bytes) declares and imports no shared memory, read from its own
//     memory and import sections, and there is at least one (the player);
//   - the page is served with no cross-origin isolation headers and runs there: `crossOriginIsolated` is false,
//     `SharedArrayBuffer` is undefined, and the player is ready.
// Wrong programs: the merge base; a player that loads a file without checking its hash (it starts); a player built with
// threads or shared memory (its memory says shared, or it never starts without isolation).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, LOGIC, TIMEOUT, bundleFailures, copyBundle, done, exportLab, filesUnder, isWasm, none, play, readBundle, rewrittenProgram, scorerProgram,
  useBrowsers, useShow, useTemp, wasmMemories,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();

describe(`${AC[3]} a logic program off its hash doesn't start, no shared memory, no cross-origin isolation`, () => {
  it(`${AC[3]} the lab with its logic program one byte off its recorded hash doesn't start, naming the program; the bundle as written does`, async () => {
    const evidence = temp();
    const lab = exportLab(shows(FULL), evidence, join(temp(), 'bundle'), 'the lab exported to the web');
    none(bundleFailures(lab.out, lab.receipt, 'the lab\'s bundle'), 'the bundle holds every file its receipt names, each by its hash');
    const file = rewrittenProgram(lab.receipt, LOGIC, scorerProgram().sha, 'the lab\'s receipt');
    const program = file.sha256;

    const whole = browsers(await play(lab.out));
    await whole.tab.mustBeReady('the bundle as written');
    await done(whole);

    const copy = copyBundle(lab.out, join(temp(), 'tampered'));
    const bytes = Buffer.from(readBundle(copy, file.path));
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    writeFileSync(join(copy, file.path), bytes);
    const tampered = browsers(await play(copy));
    const s = await tampered.tab.ready(30_000);
    expect(s.ready, 'the player with its logic program off its hash never reports ready').toBe(false);
    expect(s.notices.some((n) => n.includes(program) || n.includes(file.path)), `a notice names the logic program (${program} or ${file.path}); the notices: ${JSON.stringify(s.notices)}`).toBe(true);
    const clock = await tampered.tab.evaluate<number>(`(async () => { const p = document.querySelector('deep-player'); try { p.play(); } catch {} await new Promise((d) => setTimeout(d, 1000)); return p.currentTime; })()`, 30_000, true);
    expect(clock, 'and it doesn\'t play: its clock stays at 0').toBe(0);
    await done(tampered);
  }, TIMEOUT);

  it(`${AC[3]} the player's WebAssembly declares no shared memory, and the page runs without cross-origin isolation`, async () => {
    const evidence = temp();
    const lab = exportLab(shows(FULL), evidence, join(temp(), 'bundle'), 'the lab exported to the web');
    const failures: string[] = [];
    let modules = 0;
    for (const [path, bytes] of filesUnder(lab.out)) {
      if (!isWasm(bytes)) continue;
      modules++;
      for (const m of wasmMemories(bytes)) if (m.shared) failures.push(`${path}: a${m.where === 'import' ? 'n imported' : ' defined'} memory is shared`);
    }
    expect(modules, 'the bundle holds WebAssembly: the player').toBeGreaterThan(0);
    none(failures, 'no WebAssembly of the bundle declares shared memory');

    const page = browsers(await play(lab.out));
    await page.tab.mustBeReady('the lab served without COOP or COEP');
    const iso = await page.tab.evaluate<{ isolated: boolean; sab: string }>(`({ isolated: self.crossOriginIsolated === true, sab: typeof SharedArrayBuffer })`);
    expect(iso, 'the page is not cross-origin isolated, so it has no SharedArrayBuffer, and the player runs there').toEqual({ isolated: false, sab: 'undefined' });
    await done(page);
  }, TIMEOUT);
});
