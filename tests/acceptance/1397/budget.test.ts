import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, brief, cardDoc, chip, cores, docId, finiteIssues, hardwareProblem, inconclusive, isObject, load, proof, requireMetal, run, scenarioOf,
  show, snapshotsOf, useBuild, useFolders,
} from './helpers.ts';

const ID = '#1397.e8a0dc87';
const LIMIT_MS = 0.2;
const BASE_CHIP = 'Apple M5 Max';
const BASE_SHA256 = 'eb92b08977dcd2393018d12e54c20a1b6e57a92bddcf6ba5d7b21ad81d71a6fb';
const bin = useBuild();
const folder = useFolders();
const DOC = docId(9);

describe(`${ID} a frame with no non-finite value settles as on the merge base, and its count is cheap`, () => {
  it(`${ID} the 1080p grey card settles with the merge base's pixel hash and a count of 0, and the count costs at most 0.2 ms of GPU on the reference Mac`, async () => {
    requireMetal('a 1080p render-back');
    const loadAtStart = load();
    const [reply] = run(bin(), scenarioOf(folder(), [DOC], {}, [show(DOC, cardDoc())]));
    const loadAtEnd = load();
    const snaps = snapshotsOf(reply!);
    proof('the settled 1080p frame', { snapshots: snaps, load: [loadAtStart, loadAtEnd], cores: cores(), chip: chip() });
    expect(snaps.length, `the render-back of the grey card returns one snapshot: ${brief(reply, 1500)}`).toBe(1);
    expect(finiteIssues(reply), 'the grey card holds no non-finite value').toEqual([]);
    const snap = snaps[0]!;
    const finite = snap['finite'];
    expect(isObject(finite) && finite['count'] === 0, `the settled frame carries its count, 0: finite ${brief(finite ?? null, 400)}`).toBe(true);
    const gpuMs = isObject(finite) ? finite['gpu_ms'] : undefined;
    expect(typeof gpuMs === 'number' && Number.isFinite(gpuMs) && gpuMs >= 0, `the settled frame carries the count's GPU time in ms: finite ${brief(finite ?? null, 400)}`).toBe(true);
    if (chip() !== BASE_CHIP) inconclusive(`the merge base's pixel hash was drawn on ${BASE_CHIP}; this GPU is ${chip()}`);
    expect(snap['sha256'], 'the frame settles with the same pixel hash as on the merge base').toBe(BASE_SHA256);
    const problem = await hardwareProblem();
    if (problem) inconclusive(`the count's GPU time is ${gpuMs as number} ms, judged only on a reference Mac: ${problem}`);
    if ((gpuMs as number) > LIMIT_MS) {
      const loaded = Math.max(loadAtStart, loadAtEnd) > cores();
      if (loaded) inconclusive(`the count's GPU time is ${gpuMs as number} ms, over ${LIMIT_MS} ms, at load ${loadAtStart.toFixed(1)} to ${loadAtEnd.toFixed(1)} on ${cores()} cores`);
    }
    expect(gpuMs as number, `the count's GPU time at 1080p, at load ${loadAtStart.toFixed(1)} to ${loadAtEnd.toFixed(1)} on ${cores()} cores`).toBeLessThanOrEqual(LIMIT_MS);
  }, TIMEOUT);
});
