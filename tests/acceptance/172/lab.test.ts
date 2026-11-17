// AC1 #172.36bfe3c1: "A lab with a world, a logic item that keeps score and a readout, exported to the web and driven in
// headless Chrome with WebGPU by a recorded input track of 600 steps, gives physics and logic full-state hashes at each
// checkpoint, step hashes and evaluated data at 20 sampled times, equal to the app's on the reference Mac; seeking in the
// player equals playing there by the same full-state hashes"
//
// asserts, on the lab (helpers.ts `labDoc`: the world `field`, the logic item `scorer`, the readout `score_bar`) and its
// recorded track (five kicks over 600 steps):
//   - the app's record (README: The app's side): deep-show's logic replay and the world's bake on that track, the
//     world's checkpoints from deep-physics's bake of the same scene (whose step hashes must be the app's), and `eval`
//     at 20 sampled steps (seeded) and at step 600;
//   - the web export of the lab on that track writes a bundle whose every file matches the receipt's hashes;
//   - played in headless Chrome with WebGPU (the player's `backend` names WebGPU) from the start to `ended`: probe() at
//     the end reads step 600, the world's and the logic item's step hashes and evaluated data the app's at step 600,
//     and every checkpoint's full-state hash, the world's and the logic item's, the app's;
//   - in a fresh page, seeking (setting `currentTime`) to step 600 and then to each sampled step in a seeded order:
//     each step's hashes and evaluated data are the app's, and at 600 the checkpoints' full-state hashes are the app's
//     and the played run's (seeking equals playing);
//   - the page loaded only the receipt's files, each with its hash.
// Wrong programs it fails: the merge base (`unknown_target`), a player whose physics or logic drifts by a bit at any
// step (a step hash or a full-state hash differs, naming the step and the module), a seek that restores or steps
// differently from playing, evaluated data drawn from another time.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, LAB_STEPS, TIMEOUT, appRecord, bundleFailures, checkpointFailures, done, exportLab, labDoc, labTrack, none, play, prebuildPhysics, rng,
  seededSteps, servedFailures, stepFailures, useBrowsers, useShow, useTemp,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
prebuildPhysics();

/** The 20 sampled times, as steps (each t = k/60 s). */
const SAMPLED = seededSteps(172, 20, LAB_STEPS);

describe(`${AC[1]} the lab played in headless Chrome on WebGPU equals the app by step hashes, full-state hashes and evaluated data`, () => {
  it(`${AC[1]} the lab's 600-step track, played and seeked in the player, gives the app's checkpoints' full-state hashes and its step hashes and evaluated data at 20 sampled times`, async () => {
    const evidence = temp();
    const app = appRecord(shows(FULL), evidence, labDoc(evidence), labTrack(), [...SAMPLED, LAB_STEPS], 'the lab');
    const lab = exportLab(shows(FULL), evidence, join(temp(), 'bundle'), 'the lab exported to the web');
    none(bundleFailures(lab.out, lab.receipt, 'the lab\'s bundle'), 'the bundle holds every file its receipt names, each by its hash');

    const played = browsers(await play(lab.out));
    await played.tab.mustBeReady('the lab');
    const start = await played.tab.probe('the lab at load');
    expect(start.step, 'the player is at step 0 once ready').toBe(0);
    expect(/webgpu/i.test(start.backend), `the player runs on WebGPU: probe().backend is ${start.backend}`).toBe(true);
    expect(start.adapter, 'probe().adapter names the adapter').toBeTruthy();
    await played.tab.playToEnd('the lab');
    const end = await played.tab.probe('the lab played to its end');
    none([...stepFailures('played to the end', end, app, LAB_STEPS), ...checkpointFailures('played to the end', end, app)], 'played to its end, the player equals the app');
    none(servedFailures(played.server, lab.receipt, 'the played page'), 'the page loaded only the receipt\'s files, by hash');
    await done(played);

    const seeking = browsers(await play(lab.out));
    await seeking.tab.mustBeReady('the lab, for seeking');
    const failures: string[] = [];
    const last = await seeking.tab.seekStep(LAB_STEPS, 'a seek to the end');
    failures.push(...stepFailures('a seek to step 600', last, app, LAB_STEPS), ...checkpointFailures('a seek to step 600', last, app));
    if (JSON.stringify(last.checkpoint_hashes) !== JSON.stringify(end.checkpoint_hashes)) failures.push(`seeking to step 600 leaves the checkpoints ${JSON.stringify(last.checkpoint_hashes).slice(0, 600)}, playing there ${JSON.stringify(end.checkpoint_hashes).slice(0, 600)}`);
    const next = rng(1720);
    const order = [...SAMPLED].map((k) => ({ k, r: next() })).sort((a, b) => a.r - b.r).map((x) => x.k);
    for (const k of order) failures.push(...stepFailures(`a seek to step ${k}`, await seeking.tab.seekStep(k, `a seek to step ${k}`), app, k));
    none(failures, 'seeking in the player equals playing and equals the app at each sampled time');
    await done(seeking);
  }, TIMEOUT);
});
