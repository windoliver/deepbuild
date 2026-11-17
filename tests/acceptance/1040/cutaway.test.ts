// AC5 #1040.3d1179a9: "A lab with a cutaway is exported to the web, and its receipt's gpu_needs lists WebGPU's
// clip-distances feature. Opened in headless Chrome on the reference Mac with WebGPU on but that feature withheld by a
// test shim over the browser's adapter, the index page opens the fallback page and never starts the player; with the
// feature granted, the player runs the lab live. A planted index page that tests only for WebGPU starts the player,
// which fails at device creation or draws without the cutaway, and fails this criterion, naming the feature"
//
// The lab (helpers.ts `labDoc`): its goal cut by the cutaway `cut` (cutaway@1, class document), whose planes WebGPU's
// clip_distances outputs draw (Cutaway: Cost). The shim (README: The shim adapter) offers WebGPU's spec-default limits
// and exactly the features the test names, and logs every device request. asserts, on a reference Mac:
//   - the lab's web export reads clip-distances in `gpu_needs.features`;
//   - under a shim offering gpu_needs' other features but not clip-distances: the index page opens the fallback page the
//     receipt marks, in its start state, and never starts the player (the player's file is never served, no device is
//     asked for, no `<deep-player>` reports ready);
//   - under a shim offering exactly gpu_needs' features: the player is ready, draws on WebGPU, plays the lab's recorded
//     track to `ended` with the world's step hash at its last step the app's (deep-show's `physics_bake`), and each
//     device request equals gpu_needs (#172's rule);
//   - the planted `web_index_checks_webgpu_only` (the index page starts the player wherever WebGPU is) under the
//     withholding shim fails the first judgement, naming clip-distances.
// Wrong programs: the merge base (gpu_needs lists nothing; its index page never checks the adapter); the planted page.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, LAB, TIMEOUT, appWorld, closeBundle, exportWeb, failsNaming, fallbackFailures, fallbackOf, isObject, labDoc, labTrack, liveFailures, needsReal, none,
  onReferenceMac, openBundle, shimOf, show, useBrowsers, useShow, useTemp, webReceipt,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
const FEATURE = 'clip-distances';
const PLANTED = 'web_index_checks_webgpu_only';
const anyOfFirsts = (sets: string[][]): string[] => sets.map((s) => s[0]!).filter(Boolean);

describe(`${AC[5]} the lab with a cutaway needs clip-distances: withheld, the fallback page; granted, the player live`, () => {
  it(`${AC[5]} the lab's receipt lists ${FEATURE}; with it withheld the index page opens the fallback page and never starts the player; with it granted the player runs the lab live`, async () => {
    const evidence = temp();
    const { doc } = labDoc(evidence);
    const out = join(temp(), 'bundle');
    const receipt = webReceipt(exportWeb(shows(FULL), evidence, doc, out, 'the lab exported to the web', { track: labTrack() }), 'the lab exported to the web');
    expect(receipt.gpu_needs.features, `the lab's gpu_needs lists WebGPU's ${FEATURE} feature, which its cutaway draws through`).toContain(FEATURE);
    const fb = fallbackOf(out, receipt, "the lab's bundle");
    await onReferenceMac();

    const withheld = shimOf(receipt.gpu_needs, anyOfFirsts(receipt.gpu_needs.any_of), [FEATURE]);
    const w = browsers(await openBundle(out, { webgpu: true, shim: withheld }));
    await needsReal(w.tab, [FEATURE, ...withheld.features]);
    none(await fallbackFailures(w, receipt, fb, `${FEATURE} withheld`, 'the lab'), `with ${FEATURE} withheld, the index page opens the fallback page and never starts the player`);
    await closeBundle(w);

    const steps = appWorld(shows(FULL), evidence, doc, LAB.world, labTrack(), 'the lab');
    const granted = shimOf(receipt.gpu_needs, anyOfFirsts(receipt.gpu_needs.any_of));
    const g = browsers(await openBundle(out, { webgpu: true, shim: granted }));
    const live = await liveFailures(g, receipt, fb, granted.features, `the lab with ${FEATURE} granted`);
    const hash = live.end && isObject(live.end['step_hash']) ? live.end['step_hash'][LAB.world] : null;
    if (live.end && hash !== steps[LAB.steps]) live.failures.push(`played to its end (step ${show(live.end['step'] ?? null)}), the world ${LAB.world}'s step hash is ${show(hash ?? null)} in the player, ${String(steps[LAB.steps])} in the app at step ${LAB.steps}`);
    none(live.failures, `with ${FEATURE} granted, the player runs the lab live, as the app runs it`);
    await closeBundle(g);
  }, TIMEOUT);

  it(`${AC[5]} the planted ${PLANTED}, which tests only for WebGPU, starts the player with ${FEATURE} withheld and fails, naming ${FEATURE}`, async () => {
    const evidence = temp();
    const { doc } = labDoc(evidence);
    const out = join(temp(), 'bundle');
    const receipt = webReceipt(exportWeb(shows(FULL), evidence, doc, out, `the lab (planted ${PLANTED})`, { track: labTrack(), planted: PLANTED }), `the lab (planted ${PLANTED})`);
    expect(receipt.gpu_needs.features, `the planted bundle's gpu_needs still lists ${FEATURE}`).toContain(FEATURE);
    const fb = fallbackOf(out, receipt, `the planted ${PLANTED}'s bundle`);
    await onReferenceMac();
    const withheld = shimOf(receipt.gpu_needs, anyOfFirsts(receipt.gpu_needs.any_of), [FEATURE]);
    const w = browsers(await openBundle(out, { webgpu: true, shim: withheld }));
    await needsReal(w.tab, [FEATURE]);
    failsNaming(await fallbackFailures(w, receipt, fb, `${FEATURE} withheld`, `the planted ${PLANTED}`), FEATURE, `the planted ${PLANTED}`);
    await closeBundle(w);
  }, TIMEOUT);
});
