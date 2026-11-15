// #1879 AC1 and AC2: the two starts on a real hub. One home, `deep install` of the one test package (test/safe-probe)
// on a hub without --safe, that hub stopped, then the same home started again with `deep hub run --safe` (AC1) or
// with `deep hub run` (AC2). A load is what the record shows: the sandboxed process the extension host starts for the
// package, a process.starting in a run folder of the hub's (README, Readings).
import { describe, expect, it } from 'vitest';
import { ID, SAFE_REASON, VERSION, install, installed, loads, loadsAbove, notLoadedLines, shown, startHub, stopHub, world } from './helpers.ts';

/** How long a started hub is watched for a load it shouldn't make: past the start's own loads. */
const WATCH_MS = 20_000;

describe('#1879.c42142c0 On a hub started with `deep hub run --safe` and one installed package, no package is loaded and a load is refused with the safe-mode reason. On the merge base the package loads, and the test fails naming it', () => {
  // Retired with the owner's approval on #2607's PR: it sets no timeout of its own, so the lanes' vitest default of 5 s
  // cuts its 20 s watch short; 1879-redraft-ac1/safe.test.ts is AC1's test (its README).
  it.skip('a --safe hub with test/safe-probe installed loads no package, and a load of it is refused with the safe-mode reason', async () => {
    const w = world();
    const before = await installed(w);
    const hub = await startHub(w, { safe: true });

    // No package is loaded at the start: no new load in the record while the hub is watched.
    const atStart = await loadsAbove(hub, before, WATCH_MS);
    expect(atStart - before, `${ID} loaded on a --safe hub: the record holds ${atStart - before} new load(s) of it since the hub started with deep hub run --safe; hub stderr ${JSON.stringify(hub.stderr().slice(-1500))}`).toBe(0);

    // A load is refused with the safe-mode reason: the hub's own load of the installed package at start, named on its
    // stderr, or, if the hub tried none, a load asked for by `deep install` of the same folder on this hub.
    let refusal = notLoadedLines(hub).find((l) => SAFE_REASON.test(l));
    let asked = '';
    if (!refusal) {
      const ran = await install(w);
      asked = shown(ran);
      const said = `${ran.stdout}\n${ran.stderr}`.split('\n');
      refusal = said.find((l) => /not loaded/i.test(l) && SAFE_REASON.test(l));
      expect(ran.code, `deep install of ${ID} on a --safe hub reported a load: ${asked}`).not.toBe(0);
      const after = await loadsAbove(hub, before, WATCH_MS);
      expect(after - before, `${ID} loaded on a --safe hub when deep install asked for its load: ${asked}`).toBe(0);
    }
    expect(refusal, `no load of ${ID}@${VERSION} was refused with the safe-mode reason on the --safe hub: its stderr names it ${JSON.stringify(notLoadedLines(hub))}${asked ? `; deep install said ${asked}` : ''}`).toMatch(SAFE_REASON);

    // Still nothing loaded once all of that ran.
    expect(await loads(hub) - before, `${ID} loaded on a --safe hub`).toBe(0);
    await stopHub(hub);
  });
});

describe('#1879.81f0a695 The same hub started without `--safe` loads the package', () => {
  it('the same home started with deep hub run loads test/safe-probe, and names no refusal of it', async () => {
    const w = world();
    const before = await installed(w);
    const hub = await startHub(w, { safe: false });
    const after = await loadsAbove(hub, before, 60_000);
    expect(after - before, `${ID} didn't load on a hub started without --safe: hub stderr ${JSON.stringify(hub.stderr().slice(-1500))}`).toBeGreaterThan(0);
    expect(notLoadedLines(hub), `the hub without --safe refused ${ID}`).toEqual([]);
    await stopHub(hub);
  });
});
