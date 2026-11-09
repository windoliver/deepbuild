// #499.64602440 (AC5), redrafted blind (REDRAFT.md): "A test canvas module that reads an asset through the decode
// worker seals and probes its asset in a build with the media module left out; a planted test module whose probe
// calls through the media module is refused at that build's seal, naming media".
//
// The decode worker with its asset probes is ring-critical and the core's, never a canvas module and never the media
// module's (technical design: Canvas modules; canvas primitives: Decode worker, "so tables, meshes, video frames,
// sequences, chunks and recordings are probed and decoded in a build without media"). So:
// - honest half: `deep-show` built as the full set with media left out (`test-leave-out-media`) plus the test canvas
//   module `test.probe` (`test-probe`) seals; a document with a `test.probe@1` item naming a WAV asset is presented;
//   the item's arrays hold the probe's sample rate and duration; and `workers` shows that probe ran in a decode
//   worker, a process other than deep-show, on the asset's hash.
// - planted half: the same build with the twin `test-probe-via-media` in place of `test-probe` (the same module
//   `test.probe`, whose probe calls through the media module) never starts: the seal refuses it, naming `media`.
import { describe, expect, it } from 'vitest';
import {
  DURATION, FLICKS, KIND, MODULE, REGISTRY, SAMPLE_RATE, WORKERS, evalProbe, int, keep, obj, probeBoard, run, scenario, sealRefusal,
  show, showDoc, str, strs, TIMEOUT, useBuild, useTemp, wav, workersOf, type JsonObject,
} from './helpers.ts';

const AC5 = 'AC5 #499.64602440';
const honest = useBuild(['full', 'test-leave-out-media', 'test-probe']);
const planted = useBuild(['full', 'test-leave-out-media', 'test-probe-via-media']);
const temp = useTemp();

/** The fixture: 1.5 s of mono 16-bit PCM at 22,050 Hz, so its probe is 22,050 Hz and 33,075 / 22,050 s = 1,058,400,000 flicks. */
const RATE = 22_050;
const FRAMES = 33_075;
const DURATION_FLICKS = (FRAMES * FLICKS) / RATE;

/** The calls both halves drive: the sealed set, the document, the frame's read of the probe's arrays, the helper processes. */
const calls = (sha: string): JsonObject[] => [REGISTRY, showDoc(probeBoard(sha)), evalProbe(), WORKERS];

describe(`${AC5} an asset read through the decode worker in a build without media`, () => {
  it(`${AC5} honest: with media left out, ${MODULE} seals and probes its WAV asset in the decode worker`, () => {
    const root = temp();
    const sha = keep(root, wav(FRAMES, RATE));
    const { replies, pid } = run(honest(), scenario(root, calls(sha)));
    const [registry, shown, evaluated, workers] = replies as [JsonObject, JsonObject, JsonObject, JsonObject];

    // The build: sealed, without media, with test.probe.
    const modules = strs(registry['modules'], 'registry: modules');
    expect(modules, `the build leaves the media module out: ${modules.join(', ')}`).not.toContain('media');
    expect(modules, `the build holds the test canvas module ${MODULE}: ${modules.join(', ')}`).toContain(MODULE);
    expect(['sealed', 'ready'], `registry: state is sealed or ready, got ${show(registry['state'])}`).toContain(str(registry['state'], 'registry: state'));

    // The document that reads the asset is presented: nothing it needs is missing.
    expect(shown['outcome'], `the ${KIND} document is presented in the build without media: ${show(shown['issues'])}`).toBe('presented');

    // The module probed its asset: the frame reads the probe's values from its arrays.
    expect(evaluated['outcome'], `eval of the document: ${show(evaluated)}`).toBe('evaluated');
    const arrays = obj(evaluated['arrays'], 'eval: arrays');
    expect(int(arrays[SAMPLE_RATE], `eval: arrays["${SAMPLE_RATE}"]`), 'the probe\'s sample rate, Hz').toBe(RATE);
    expect(int(arrays[DURATION], `eval: arrays["${DURATION}"]`), 'the probe\'s duration, flicks').toBe(DURATION_FLICKS);

    // Through the decode worker: a helper process, not deep-show, ran a probe of the asset's bytes.
    const list = workersOf(workers);
    expect(list.map((w) => w.pid), `workers never lists deep-show's own process ${pid}`).not.toContain(pid);
    const prober = list.find((w) => w.role === 'decode_worker' && w.jobs.some((j) => j.op === 'probe' && j.file === sha));
    expect(prober, `a decode_worker ran a probe of ${sha}; workers: ${show(list)}`).toBeDefined();
  }, TIMEOUT);

  it(`${AC5} planted: ${MODULE} whose probe calls through the media module is refused at that build's seal, naming media`, () => {
    const root = temp();
    const sha = keep(root, wav(FRAMES, RATE));
    const refusal = sealRefusal(planted(), scenario(root, calls(sha)));
    expect(['missing_dependency', 'unresolved_read'], `the seal refuses the module's reach into a module the build lacks: ${show(refusal.raw)}`).toContain(refusal.reason);
    expect(refusal.modules, `the refusal names media: ${show(refusal.raw)}`).toContain('media');
    expect(refusal.modules, `the refusal names the planted module ${MODULE}: ${show(refusal.raw)}`).toContain(MODULE);
  }, TIMEOUT);
});
