// #1879 AC1, blind redraft: a hub started with `deep hub run --safe`, with one package installed, loads no package,
// and a load is refused with the safe-mode reason. What an agent sees of a loaded package is its action in
// find_actions (deep-actions); a refusal is what the hub and `deep install` say. README: How the criterion is read.
import { describe, expect, it } from 'vitest';
import { Actions, ACTION, deep, ofPackage, openWorld, PACKAGE, probePackage, SAFE_REASON, said, shown, sleep, startHub, stopHub } from './helpers.ts';

const CRITERION = 'On a hub started with `deep hub run --safe` and one installed package, no package is loaded and a load is refused with the safe-mode reason. On the merge base the package loads, and the test fails naming it';

describe(`#1879.c42142c0 ${CRITERION}`, () => {
  it(`a hub started with deep hub run --safe, ${PACKAGE} installed, lists none of its actions, and a load of it is refused with "${SAFE_REASON}"`, async () => {
    const w = openWorld();
    const pkg = probePackage(w);

    // The one installed package: installed as you on an ordinary hub, where it loads and find_actions lists its
    // action. That shows the surface shows a loaded package; a harness that can't get here is BLOCKED, not a pass.
    const ordinary = await startHub(w, { safe: false });
    const installed = await deep(w, ['install', pkg]);
    if (installed.code !== 0) throw Error(`BLOCKED: deep install of ${PACKAGE} on an ordinary hub didn't install and load it: ${shown(installed)}`);
    const seen = await Actions.start(w);
    const listedThere = ofPackage(await seen.find());
    await seen.stop();
    await stopHub(ordinary);
    if (!listedThere.some((a) => a.action === ACTION)) throw Error(`BLOCKED: after ${PACKAGE} loaded on an ordinary hub, find_actions doesn't list ${ACTION}: ${JSON.stringify(listedThere)}`);

    // The same home, the hub started with --safe.
    const safe = await startHub(w, { safe: true });
    try {
      const actions = await Actions.start(w);
      // No package is loaded: find_actions lists nothing of it, at once and for the next few seconds.
      for (const deadline = Date.now() + 5000; ;) {
        const loaded = ofPackage(await actions.find());
        expect(loaded, `the hub started with deep hub run --safe loaded ${PACKAGE}: find_actions lists ${JSON.stringify(loaded)}`).toEqual([]);
        if (Date.now() >= deadline) break;
        await sleep(500);
      }

      // A load asked for on the safe hub: deep install of the same package, which loads what it installs.
      const asked = await deep(w, ['install', pkg]);
      const after = ofPackage(await actions.find());
      expect(after, `after deep install of ${PACKAGE} on the hub started with --safe, it is loaded: find_actions lists ${JSON.stringify(after)}`).toEqual([]);
      await actions.stop();

      // A load is refused with the safe-mode reason: the start's refusal naming the package, or the install's.
      const startRefusal = safe.output().split('\n').find((line) => line.includes(PACKAGE) && line.includes(SAFE_REASON));
      const installRefusal = said(asked).includes(SAFE_REASON) ? said(asked).trim() : undefined;
      expect(startRefusal ?? installRefusal, `no load of ${PACKAGE} was refused with "${SAFE_REASON}" on the hub started with --safe: the hub said ${JSON.stringify(safe.output().slice(-1500))}; deep install said ${shown(asked)}`).toBeDefined();
    } finally {
      await stopHub(safe);
    }
  }, 600_000);
});
