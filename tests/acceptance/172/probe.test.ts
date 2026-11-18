// AC7 #172.4780d9da: "The lab's 600-step check reads every step hash and evaluated value through `probe()` from a bundle
// whose every file matches the receipt's hashes, and calling `probe()` at each of the 600 steps leaves every full-state
// hash equal to a run without the calls; a planted export that adds `probe()` only to a test variant fails the
// bundle-hash comparison, naming the player file"
//
// asserts:
//   - the app's record of the lab on its track, with `eval` at every step 1 … 600 (README: The app's side);
//   - the lab's bundle: every file the receipt's hash, and every file the page loaded one of them, by hash, the player
//     among them (there is no other build: the page loads the exact bytes the receipt names);
//   - run A, with the calls: seeking step by step from 1 to 600 and calling probe() at each, every step's world and
//     logic step hashes and its evaluated data are the app's, and at 600 every checkpoint's full-state hash is;
//   - run B, without them: a fresh page played from the start to `ended` with no probe() until one call at the end: its
//     checkpoints' full-state hashes are run A's and the app's;
//   - the bundle-hash comparison: a second clean export of the lab is byte-identical to the first (the comparison passes
//     the real program), and the planted `web_probe_test_variant` export fails it, naming the player file.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, LAB_STEPS, TIMEOUT, appRecord, bundleDifference, bundleFailures, checkpointFailures, done, exportLab, failsNaming, labDoc, labTrack, none,
  play, playerPath, prebuildPhysics, servedFailures, stepFailures, useBrowsers, useShow, useTemp,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
prebuildPhysics();
const PLANTED = 'web_probe_test_variant';
const EVERY = Array.from({ length: LAB_STEPS }, (_, i) => i + 1);

describe(`${AC[7]} the 600-step check reads through probe() from the shipped bundle, and probe() changes nothing`, () => {
  it(`${AC[7]} every step hash and evaluated value of the 600 steps read through probe() is the app's, from the receipt's files, and the calls leave every full-state hash as a run without them`, async () => {
    const evidence = temp();
    const app = appRecord(shows(FULL), evidence, labDoc(evidence), labTrack(), EVERY, 'the lab at every step');
    const lab = exportLab(shows(FULL), evidence, join(temp(), 'bundle'), 'the lab exported to the web');
    none(bundleFailures(lab.out, lab.receipt, 'the lab\'s bundle'), 'every file of the bundle matches the receipt\'s hash');

    const withCalls = browsers(await play(lab.out));
    await withCalls.tab.mustBeReady('run A');
    const failures: string[] = [];
    let last = await withCalls.tab.probe('run A at load');
    for (const k of EVERY) {
      last = await withCalls.tab.seekStep(k, `run A, step ${k}`);
      failures.push(...stepFailures(`run A, step ${k}`, last, app, k));
      if (failures.length > 20) break;
    }
    failures.push(...checkpointFailures('run A at step 600', last, app));
    failures.push(...servedFailures(withCalls.server, lab.receipt, 'run A\'s page'));
    none(failures, 'every step hash and evaluated value read through probe() is the app\'s, from the receipt\'s files');
    await done(withCalls);

    const without = browsers(await play(lab.out));
    await without.tab.mustBeReady('run B');
    await without.tab.playToEnd('run B');
    const end = await without.tab.probe('run B at its end');
    expect(end.step, 'run B ends at step 600').toBe(LAB_STEPS);
    none(checkpointFailures('run B at step 600', end, app), 'run B\'s full-state hashes are the app\'s');
    expect(end.checkpoint_hashes, 'probe() at each of the 600 steps leaves every full-state hash as the run without the calls').toEqual(last.checkpoint_hashes);
    await done(without);
  }, TIMEOUT);

  it(`${AC[7]} the planted ${PLANTED} export fails the bundle-hash comparison, naming the player file; two clean exports pass it`, () => {
    const a = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), 'the lab, first export');
    const b = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), 'the lab, second export');
    const clean = bundleDifference(a.out, b.out);
    expect(clean, `two exports of the lab are byte-identical, so the comparison passes the shipped player${clean ? `: ${clean}` : ''}`).toBeNull();
    const planted = exportLab(shows(FULL), temp(), join(temp(), 'bundle'), `the lab (planted ${PLANTED})`, PLANTED);
    const failures = [...bundleFailures(planted.out, planted.receipt, 'the planted bundle against its receipt')];
    const diff = bundleDifference(a.out, planted.out);
    if (diff) failures.push(`the planted bundle against the shipped one: ${diff}`);
    if (planted.receipt.player.hash !== a.receipt.player.hash) failures.push(`the planted receipt's player ${planted.receipt.player.hash} is not the shipped player ${a.receipt.player.hash} (${playerPath(a.receipt, 'the shipped bundle')})`);
    failsNaming(failures, playerPath(a.receipt, 'the shipped bundle'), `the planted export ${PLANTED}`);
  }, TIMEOUT);
});
