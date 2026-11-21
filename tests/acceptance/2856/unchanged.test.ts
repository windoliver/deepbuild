// AC4 #2856.f84ce6b9: "The index page's content-security policy is byte for byte the merge base's, and #172's live-play
// fixtures give the step hashes they gave there"
//
// The merge base is `git merge-base HEAD origin/main` (helpers.ts `mergeBaseShow`: its `deep-show` is this checkout's
// build when the code `deep-show` is built from is the merge base's, else built from `git archive` of the merge base).
// #172's live-play fixture, the lab with its 600-step track, is exported by both builds, each into a folder of its own.
//
// asserts:
//   - the index page's content-security policies (each `<meta http-equiv="Content-Security-Policy">` tag's content as
//     written) are the merge base's index page's, byte for byte, in number and order; a copy of the merge base's policy
//     with one byte changed is told apart, a failure naming the content-security policy (the comparison isn't blind);
//   - each bundle played live in headless Chrome on WebGPU, to `ended` and then seeked to every step 0 … 600 in turn
//     (helpers.ts `playedLive`): probe()'s step and step hashes after each seek, and its step, step hashes and
//     checkpoint hashes at the end of the play, are the merge base's bundle's; each difference names the step.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, LAB_STEPS, LOGIC, TIMEOUT, WORLD, bundleFailures, exportLab, failsNaming, isObject, mergeBaseShow, none, playedLive, policiesOf,
  policyFailures, show, usePages, useShow, useTemp, type JsonValue,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const pages = usePages();

/** JSON with every object's keys sorted, so two readings compare by value. */
const canon = (v: JsonValue | undefined): string => JSON.stringify(v ?? null, (_, x: JsonValue) =>
  (isObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

describe(`${AC[4]} the index page's content-security policy and the lab's live step hashes are the merge base's`, () => {
  it(`${AC[4]} the content-security policy is the merge base's byte for byte, and the lab played live gives the step hashes it gave there`, async () => {
    const base = mergeBaseShow(shows(FULL));
    console.log(`${AC[4]} comparing with ${base.label}`);
    const here = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), 'the lab, on this checkout');
    const there = exportLab(base.bin, temp(), join(temp(), 'bundle'), `the lab, on ${base.label}`);
    none(bundleFailures(here.out, here.receipt, 'this checkout\'s bundle'), 'this checkout\'s bundle holds every file its receipt names, each by its hash');
    none(bundleFailures(there.out, there.receipt, 'the merge base\'s bundle'), 'the merge base\'s bundle holds every file its receipt names, each by its hash');

    const failures: string[] = [];
    const policies = (out: string): string[] => policiesOf(readFileSync(join(out, 'index.html'), 'utf8'));
    const [mine, theirs] = [policies(here.out), policies(there.out)];
    console.log(`${AC[4]} content-security policies: this checkout ${JSON.stringify(mine)}; ${base.label} ${JSON.stringify(theirs)}`);
    expect(theirs.length, `${base.label}'s index page sets a content-security policy`).toBeGreaterThan(0);
    failures.push(...policyFailures(mine, theirs, 'the lab\'s index page'));
    const twin = theirs.map((p, i) => (i === 0 ? `${p.slice(0, -1)}${p.endsWith('x') ? 'y' : 'x'}` : p));
    failsNaming(policyFailures(twin, theirs, 'a policy one byte off the merge base\'s'), 'content-security policy', 'the comparison of the policies');

    const live = await playedLive(here.out, 'the lab, on this checkout', pages);
    const was = await playedLive(there.out, `the lab, on ${base.label}`, pages);
    const hashes = isObject(was.end.step_hash) ? was.end.step_hash : {};
    expect(was.end.step === LAB_STEPS && typeof hashes[WORLD] === 'string' && typeof hashes[LOGIC] === 'string',
      `${base.label}: played to ended, probe() reads step ${LAB_STEPS} with the world ${WORLD}'s and the logic item ${LOGIC}'s step hashes; it reads step ${was.end.step} with ${show(was.end.step_hash, 300)}`).toBe(true);
    if (live.end.step !== was.end.step || canon(live.end.step_hash) !== canon(was.end.step_hash)) {
      failures.push(`played to ended: step ${live.end.step} with step hashes ${canon(live.end.step_hash)} on this checkout, step ${was.end.step} with ${canon(was.end.step_hash)} on the merge base`);
    }
    if (canon(live.end.checkpoint_hashes) !== canon(was.end.checkpoint_hashes)) {
      failures.push(`played to ended (step ${live.end.step}): the checkpoint hashes are ${canon(live.end.checkpoint_hashes)} on this checkout, ${canon(was.end.checkpoint_hashes)} on the merge base`);
    }
    for (let k = 0; k <= LAB_STEPS; k += 1) {
      const a = live.steps[k]; const b = was.steps[k];
      if (!a || !b) { failures.push(`step ${k}: no reading after a seek on ${a ? 'the merge base' : 'this checkout'}`); continue; }
      if (a.step !== b.step || canon(a.step_hash) !== canon(b.step_hash)) {
        failures.push(`step ${k}: a seek reads step ${a.step} with step hashes ${canon(a.step_hash)} on this checkout, step ${b.step} with ${canon(b.step_hash)} on the merge base`);
      }
    }
    none(failures, `the content-security policy and the lab's live step hashes are ${base.label}'s`);
  }, TIMEOUT * 3);
});
